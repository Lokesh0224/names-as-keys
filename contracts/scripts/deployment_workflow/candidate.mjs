import { AbiCoder, Interface, getCreateAddress, formatUnits, keccak256, toQuantity } from 'ethers';
import { BrowserJournal, DeploymentWorkflow, ReadOnlyWallet, decodePacket, digest, LIVE_EXECUTION_ALLOWED } from './workflow.mjs';
import { candidateStep, need, same } from './candidate_steps.mjs';
import { isT01IntentAuthorization, t01IntentDigest } from './t01_intent.mjs';
import { T01_AUTHORIZATION } from './t01_authorization.mjs';

export const labelABI = ['function getLabel(uint256) view returns(string)', 'event Label(bytes32 indexed labelHash,string label)'];
const events = ['accountsChanged', 'chainChanged', 'disconnect'];
const hash = value => /^0x[\da-f]{64}$/i.test(value ?? '');
const headerOK = h => h && hash(h.hash) && typeof h.number === 'string' && typeof h.timestamp === 'string';

const eventType = Object.getOwnPropertyDescriptor(Event.prototype, 'type').get;
const eventCurrentTarget = Object.getOwnPropertyDescriptor(Event.prototype, 'currentTarget').get;
const eventIsTrusted = (Object.getOwnPropertyDescriptor(new Event('click'), 'isTrusted') ??
  Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted')).get;
const usedClicks = new WeakSet();
const revealBlocked = 'T04 execution blocked until the wallet and RPC reveal boundary is verified';

function consumeConfirmationClick(event, buttonId = 't01-validate') {
  try {
    const button = document.getElementById(buttonId);
    if (!button || eventType.call(event) !== 'click' || eventCurrentTarget.call(event) !== button ||
        eventIsTrusted.call(event) !== true || usedClicks.has(event)) return false;
    usedClicks.add(event);
    return true;
  } catch { return false; }
}

export class CandidateReview {
  #wallet; #journal; #prepared = new Map(); #secret; #epoch = 0; #busy = false;
  #handlers; #update; #privateEstimate; #random; #state; #storage; #registrationKey;
  #provider; #t01Authorization; #locks; #grant; #authorization; #lockKey; #validatedIntentReview;
  #recoveryReview; #recoveryPermission;
  constructor({ provider, bundle, storage, update = () => {}, privateEstimate, random = bytes => crypto.getRandomValues(bytes), now = () => Date.now(),
    locks = globalThis.navigator?.locks }) {
    const { plan, inputs, observation, abis, addresses } = bundle;
    need(plan.liveExecutionAllowed === false && plan.stage3F === 'NO_GO', 'Reviewed NO-GO candidate required');
    need(plan.candidateApproval === inputs.classification && same(plan.owner, inputs.owner) && same(plan.mira, inputs.mira), 'Candidate identity mismatch');
    need(plan.snapshot.hash === observation.blockHash && same(plan.snapshot.nonce, observation.nonce), 'Snapshot binding mismatch');
    need(plan.transactions.map(s => s.id).join(',') === Array.from({ length: 15 }, (_, i) => 'T' + String(i + 1).padStart(2, '0')).join(','), 'Unexpected step inventory');
    this.bundle = bundle;
    this.addresses = { ...addresses, ...plan.futureAddresses, Mira: inputs.mira, Owner: inputs.owner };
    this.abis = { ...abis, LabelStore: labelABI, R1: abis.UserRegistryImpl, R2: abis.UserRegistryImpl };
    this.interfaces = Object.fromEntries(Object.entries(this.abis).map(([name, abi]) => [name, new Interface(abi)]));
    this.owner = inputs.owner;
    this.now = now;
    this.#wallet = new ReadOnlyWallet(provider);
    this.#provider = provider;
    this.#update = update;
    this.#privateEstimate = privateEstimate;
    this.#random = random;
    const planDigest = digest(bundle);
    this.#storage = storage;
    this.#t01Authorization = T01_AUTHORIZATION && Object.freeze({ ...T01_AUTHORIZATION });
    // Share the legacy T01 lock with older tabs as well as the sequential runner.
    this.#lockKey = this.#attemptKey('T01');
    this.#locks = locks;
    this.#registrationKey = 'nak-registration:' + inputs.owner.toLowerCase() + ':' + inputs.root;
    this.#journal = new BrowserJournal(storage, 'nak-candidate:' + planDigest);
    this.#state = this.#journal.read() ?? { schema: 1, planDigest, entries: {}, history: [] };
    need(this.#state.schema === 1 && this.#state.planDigest === planDigest, 'Journal plan mismatch');
    for (const [id, entry] of Object.entries(this.#state.entries)) {
      need(plan.transactions.some(step => step.id === id && step.conditionallyIncluded) &&
        hash(entry.reviewDigest) && hash(entry.packetDigest), 'Invalid recovery record');
      // Only safe identifiers are presented from storage. Chain evidence is rebuilt.
      if (entry.receiptHash) need(hash(entry.receiptHash), 'Invalid recovery receipt hash');
      entry.status = 'RECHECK_REQUIRED';
    }
    this.#handlers = Object.fromEntries(events.map(name => [name, () => {
      this.#epoch++;
      this.#clearSecret();
      for (const [id, entry] of Object.entries(this.#state.entries)) {
        entry.status = 'RECHECK_REQUIRED';
        if (!entry.receiptHash) this.#prepared.delete(id);
      }
      this.#update(name);
    }]));
    for (const name of events) this.#wallet.on(name, this.#handlers[name]);
  }
  close() {
    this.#epoch++;
    this.#clearSecret();
    this.#prepared.clear();
    for (const name of events) this.#wallet.removeListener(name, this.#handlers[name]);
  }
  #clearSecret() { this.#secret?.fill(0); this.#secret = undefined; }
  journal() {
    const entries = Object.fromEntries(Object.entries(this.#state.entries).map(([id, entry]) => {
      const attempt = this.#attempt(id);
      const matching = attempt?.planDigest === this.#state.planDigest && attempt.packetDigest === entry.packetDigest;
      const status = entry.status === 'RECHECK_REQUIRED' && matching
        ? ({ REQUESTING: 'UNCERTAIN', REJECTED: 'REJECTED', UNCERTAIN: 'UNCERTAIN', PENDING: 'PENDING',
             REVERTED: 'REVERTED' })[attempt.status] ?? entry.status : entry.status;
      return [id, {
        status, receiptHash: this.#receiptHash(id, attempt), reviewDigest: entry.reviewDigest,
        ...(entry.status === 'CONFIRMED' ? { evidence: entry.evidence, bindings: entry.bindings, costWei: entry.costWei } : {}),
      }];
    }));
    return { schema: 1, planDigest: this.#state.planDigest, entries };
  }
  async read(method, params) {
    try { return await this.#wallet.request({ method, params }); }
    catch { throw new Error('Read unavailable: ' + method); }
  }
  async identity() {
    const [accounts, chain] = await Promise.all([this.read('eth_accounts', []), this.read('eth_chainId', [])]);
    need(same(accounts[0], this.owner) && BigInt(chain) === 11155111n, 'Selected owner and Sepolia required');
  }
  async #run(fn) {
    need(!this.#busy, 'Review already in progress');
    this.#busy = true;
    try { return await fn(this.#epoch); } finally { this.#busy = false; }
  }
  #save(id, entry) {
    const retry = id === 'T01' ? JSON.parse(this.#storage.getItem(this.#retryKey()) ?? 'null') : null;
    const history = retry ? [...this.#state.history, { kind: 'T01_RETRY_' + entry.status,
      attemptId: retry.attemptId, recoveryDigest: retry.recoveryDigest,
      packetDigest: entry.packetDigest, ...(entry.receiptHash ? { hash: entry.receiptHash } : {}) }] : this.#state.history;
    const next = { ...this.#state, history, entries: { ...this.#state.entries, [id]: entry } };
    this.#journal.write(next);
    this.#state = next;
  }
  #attemptKey(id) { return 'nak-' + id.toLowerCase() + '-attempt:11155111:' + this.owner.toLowerCase(); }
  #recoveryKey() { return this.#attemptKey('T01') + ':recovery'; }
  #retryKey() { return this.#attemptKey('T01') + ':retry'; }
  #transactionEvidenceKey() { return this.#recoveryKey() + ':transaction-evidence'; }
  #originalAttempt() { return JSON.parse(this.#storage.getItem(this.#attemptKey('T01')) ?? 'null'); }
  #recoveryRecord() {
    const record = JSON.parse(this.#storage.getItem(this.#recoveryKey()) ?? 'null');
    if (record) {
      const { recoveryDigest, ...review } = record;
      need(recoveryDigest === digest(review) && review.kind === 'T01_HASHLESS_REJECTION_V1' &&
        review.rejectedAttemptDigest === digest(this.#originalAttempt()) &&
        review.planDigest === this.#state.planDigest, 'T01 recovery record inconsistent; manual reconciliation required');
    }
    return record;
  }
  #attemptStorageKey(id) {
    if (id === 'T01' && this.#recoveryRecord()) return this.#retryKey();
    return this.#attemptKey(id);
  }
  #attempt(id) {
    if (id === 'T01') {
      const retry = JSON.parse(this.#storage.getItem(this.#retryKey()) ?? 'null');
      if (retry) {
        const recovery = this.#recoveryRecord();
        need(recovery && retry.recoveryDigest === recovery.recoveryDigest &&
          retry.parentAttemptDigest === recovery.rejectedAttemptDigest, 'T01 retry linkage missing or changed');
        return retry;
      }
      this.#recoveryRecord();
    }
    return JSON.parse(this.#storage.getItem(this.#attemptKey(id)) ?? 'null');
  }
  #retryAllowed() {
    const record = this.#recoveryRecord();
    return Boolean(record && this.#recoveryPermission?.epoch === this.#epoch &&
      this.#recoveryPermission.digest === record.recoveryDigest && !this.#storage.getItem(this.#retryKey()) &&
      !this.#storage.getItem(this.#transactionEvidenceKey()));
  }
  #attemptAvailable(id) {
    return !this.#attempt(id) || (id === 'T01' && this.#retryAllowed());
  }
  #rejectedT01() {
    need(!this.#storage.getItem(this.#transactionEvidenceKey()), 'Transaction evidence blocks T01 recovery');
    need(!this.#storage.getItem(this.#recoveryKey()) && !this.#storage.getItem(this.#retryKey()),
      'T01 recovery already recorded; manual reconciliation required');
    const attempt = this.#originalAttempt();
    const journal = this.#journal.read();
    const entry = journal?.entries.T01;
    need(attempt?.status === 'REJECTED' && !Object.hasOwn(attempt, 'hash') &&
      !entry?.receiptHash && entry?.anchor && attempt.planDigest === this.#state.planDigest &&
      attempt.packetDigest === entry.packetDigest && hash(attempt.transactionDigest) &&
      attempt.nonce === this.bundle.plan.transactions[0].candidateNonce,
    'Explicit hashless T01 rejection and matching journal required');
    for (const step of this.bundle.plan.transactions.slice(1)) {
      const other = this.#attempt(step.id);
      need(!other || (typeof other.nonce === 'string' && BigInt(other.nonce) !== BigInt(attempt.nonce)),
        'Conflicting attempt evidence blocks T01 recovery');
    }
    return { attempt, journal };
  }
  async inspectT01Recovery(attestation) {
    this.#recoveryReview = undefined;
    return this.#run(epoch => this.#exclusive(async () => {
      need(this.#locks?.request, 'Exclusive browser lock unavailable');
      need(attestation?.walletActivityChecked === true && attestation.noKnownTransaction === true &&
        attestation.knownHashes?.length === 0, 'Owner wallet inspection and no known transaction evidence required');
      const { attempt, journal } = this.#rejectedT01();
      await this.identity();
      await this.refreshAuthorization();
      const original = await this.#recover('T01', journal.entries.T01);
      this.#assertT01Envelope(original.packet);
      need(digest(original.packet.tx) === attempt.transactionDigest, 'Rejected transaction binding mismatch');
      const fresh = await this.#evaluate(this.bundle.plan.transactions[0], epoch);
      const auth = this.#auth('T01');
      need(isT01IntentAuthorization(auth) && auth.intentDigest === t01IntentDigest(this.bundle, original.packet) &&
        auth.intentDigest === t01IntentDigest(this.bundle, fresh.packet), 'Approved durable T01 authorization required');
      const review = {
        kind: 'T01_HASHLESS_REJECTION_V1', step: 'T01', chainId: '11155111', owner: this.owner,
        planDigest: this.#state.planDigest, intentDigest: auth.intentDigest,
        rejectedAttemptDigest: digest(attempt), rejectedAttempt: attempt, originalJournal: journal,
        evidence: { snapshot: fresh.review.snapshot, nonce: fresh.packet.tx.nonce,
          latestNonce: fresh.packet.tx.nonce, pendingNonce: fresh.packet.tx.nonce,
          token: fresh.packet.tokenReview, packetDigest: digest(fresh.packet), estimate: fresh.review.estimate,
          walletActivityChecked: true, knownHashes: [], observedAt: this.now() },
        limitations: 'REJECTED records wallet rejection under the existing runner. No historical error code was separately persisted. Unchanged nonces and wallet Activity cannot prove absence from all transaction pools.',
      };
      this.#recoveryReview = { digest: digest(review), epoch, fresh, journalDigest: digest(journal) };
      return structuredClone({ ...review, recoveryDigest: digest(review) });
    }));
  }
  async approveT01Recovery(displayed, confirmed, event) {
    return this.#run(epoch => {
      need(this.#locks?.request, 'Exclusive browser lock unavailable');
      need(confirmed === true && consumeConfirmationClick(event, 't01-recovery-approve'),
        'Explicit owner recovery approval through the dedicated button required');
      return this.#exclusive(async () => {
        const pending = this.#recoveryReview;
        this.#recoveryReview = undefined;
        const { recoveryDigest, ...review } = structuredClone(displayed ?? {});
        need(pending?.epoch === epoch && pending.digest === recoveryDigest && digest(review) === recoveryDigest,
          'Recovery review missing, changed or invalidated');
        const { attempt, journal } = this.#rejectedT01();
        need(digest(attempt) === review.rejectedAttemptDigest && digest(journal) === pending.journalDigest,
          'Rejected attempt or journal changed during recovery');
        await this.refreshAuthorization();
        const auth = this.#auth('T01');
        need(isT01IntentAuthorization(auth) && auth.intentDigest === review.intentDigest,
          'Approved durable T01 authorization required');
        const fresh = await this.#evaluate(this.bundle.plan.transactions[0], epoch,
          undefined, undefined, undefined, pending.fresh.packet.tx);
        need(digest(fresh.packet) === review.evidence.packetDigest && fresh.review.estimate === review.evidence.estimate,
          'T01 recovery evidence changed; inspect again');
        // Human approval stays bound to the inspected evidence. Only the new
        // observation must be recent, but the inspected block must remain canonical.
        const inspected = await this.read('eth_getBlockByNumber', [review.evidence.snapshot.number, false]);
        need(headerOK(inspected) && inspected.number === review.evidence.snapshot.number &&
          inspected.hash === review.evidence.snapshot.hash, 'Inspected recovery block lost canonicality');
        const [, latest, pendingNonce] = await Promise.all([this.identity(),
          this.read('eth_getTransactionCount', [this.owner, 'latest']),
          this.read('eth_getTransactionCount', [this.owner, 'pending'])]);
        need([latest, pendingNonce].every(n => BigInt(n) === BigInt(attempt.nonce)), 'T01 recovery nonce changed');
        await this.#checkSnapshotFreshness(fresh.header, epoch, true);
        const current = this.#rejectedT01();
        need(digest(current.journal) === pending.journalDigest &&
          digest(current.attempt) === review.rejectedAttemptDigest, 'Recovery evidence changed during verification');
        const record = JSON.stringify({ ...review, recoveryDigest });
        this.#storage.setItem(this.#recoveryKey(), record);
        need(this.#storage.getItem(this.#recoveryKey()) === record, 'Recovery persistence failed');
        this.#state.history.push({ kind: 'T01_RECOVERY_APPROVED', recoveryDigest, rejectedAttemptDigest: review.rejectedAttemptDigest });
        this.#journal.write(this.#state);
        need(digest(this.#journal.read()) === digest(this.#state), 'Recovery audit persistence failed');
        this.#recoveryPermission = { digest: recoveryDigest, epoch };
        this.#validatedIntentReview = undefined;
        this.#prepared.delete('T01');
        return { status: 'RECOVERY_APPROVED', recoveryDigest };
      });
    });
  }
  #receiptHash(id, attempt = this.#attempt(id)) {
    const entry = this.#state.entries[id];
    return entry?.receiptHash ?? (entry && attempt?.planDigest === this.#state.planDigest &&
      attempt.packetDigest === entry.packetDigest && hash(attempt.hash) ? attempt.hash : undefined);
  }
  #exclusive(fn) {
    const run = () => {
      const persisted = this.#journal.read();
      for (const [id, entry] of Object.entries(persisted?.entries ?? {})) {
        const local = this.#state.entries[id];
        if (local?.packetDigest === entry.packetDigest && local?.receiptHash === entry.receiptHash) continue;
        need(this.bundle.plan.transactions.some(step => step.id === id && step.conditionallyIncluded) &&
          hash(entry.packetDigest) && hash(entry.reviewDigest) && (!entry.receiptHash || hash(entry.receiptHash)),
        'Invalid recovery record');
        this.#prepared.delete(id);
        this.#state.entries[id] = { ...entry, status: 'RECHECK_REQUIRED' };
      }
      return fn();
    };
    if (!this.#locks?.request) return run();
    return this.#locks.request(this.#lockKey, { ifAvailable: true }, lock => {
      need(lock, 'Deployment review locked in another tab; retry the review manually');
      return run();
    });
  }
  #revealArgs() {
    need(this.#secret, 'Registration session unavailable. A lost commitment must expire before a new attempt.');
    const args = [...this.bundle.plan.transactions[3].candidateArguments];
    args[2] = '0x' + Array.from(this.#secret, byte => byte.toString(16).padStart(2, '0')).join('');
    return args;
  }
  formatAmount(value) { return formatUnits(value, this.bundle.inputs.spending.decimals); }
  commitmentForReview(args) {
    return keccak256(AbiCoder.defaultAbiCoder().encode(['string','address','bytes32','address','address','uint64','bytes32'], [...args.slice(0, 6), args[7]]));
  }
  async #prerequisites(step) {
    const preceding = this.bundle.plan.transactions.slice(0, this.bundle.plan.transactions.indexOf(step));
    for (const prior of preceding.filter(s => s.conditionallyIncluded)) {
      const receiptHash = this.#receiptHash(prior.id);
      need(receiptHash, 'Verified prerequisite receipt required: ' + prior.id);
      await this.#verify(prior.id, receiptHash);
    }
  }
  async #checkSnapshotFreshness(header, epoch, requireStableHead = false) {
    const { expiry } = this.bundle.inputs;
    const readLatest = () => this.read('eth_getBlockByNumber', ['latest', false]);
    const readAnchor = () => this.read('eth_getBlockByNumber', [header.number, false]);
    const before = requireStableHead ? await readLatest() : undefined;
    const anchor = requireStableHead ? await readAnchor() : undefined;
    const [latest, canonical] = await Promise.all([readLatest(), requireStableHead ? anchor : readAnchor()]);
    need(headerOK(latest) && canonical?.hash === header.hash, 'Review block lost canonicality');
    // A head change during the canonical lookup invalidates this handoff observation.
    if (requireStableHead) {
      need(before?.hash === latest.hash && before.number === latest.number, 'Head changed during final verification. Revalidate T01.');
      need(latest.number !== header.number || latest.hash === header.hash, 'Review block lost canonicality');
    }
    const lag = BigInt(latest.number) - BigInt(header.number);
    const age = this.now() / 1000 - Number(BigInt(header.timestamp));
    need(lag >= 0n && lag <= BigInt(expiry.maxAgeBlocks) && age >= -15 && age <= expiry.maxAgeSeconds, 'Review snapshot expired');
    need(epoch === this.#epoch, 'Wallet context changed');
    return latest;
  }
  async #fresh(header, epoch) {
    await this.identity();
    return this.#checkSnapshotFreshness(header, epoch);
  }
  #t02ReviewedCaps(caps) {
    const keys = ['gas', 'maxFeePerGas', 'maxPriorityFeePerGas'];
    need(caps && Object.keys(caps).length === keys.length &&
      keys.every(key => typeof caps[key] === 'string' && /^(?:[0-9]+|0x[0-9a-f]+)$/i.test(caps[key])),
    'Explicit T02 gas and fee fields required');
    const retained = Object.fromEntries(keys.map(key => [key, toQuantity(BigInt(caps[key]))]));
    const gas = BigInt(retained.gas), fee = BigInt(retained.maxFeePerGas), tip = BigInt(retained.maxPriorityFeePerGas);
    const { fees } = this.bundle.inputs;
    need(gas > 0n && gas <= BigInt(fees.maxGasPerStep) && fee > 0n &&
      fee <= BigInt(fees.maxFeePerGasWei) && tip <= fee && tip <= BigInt(fees.maxPriorityFeePerGasWei) &&
      gas * fee <= BigInt(fees.maxTotalWei), 'T02 retained envelope exceeds approved ceilings');
    return retained;
  }
  async prepare(stepId, reviewedCaps) {
    need(reviewedCaps === undefined || stepId === 'T02', 'Retained preparation fields are T02-only');
    const retained = reviewedCaps === undefined ? undefined : this.#t02ReviewedCaps(reviewedCaps);
    this.#validatedIntentReview = undefined;
    return this.#run(epoch => this.#exclusive(async () => {
      const { plan } = this.bundle;
      const step = plan.transactions.find(s => s.id === stepId);
      need(step?.conditionallyIncluded, 'Step excluded or unknown');
      need(this.#attemptAvailable(stepId), 'Prior ' + stepId + ' attempt requires manual reconciliation');
      need(!this.#state.entries[stepId]?.receiptHash, 'Existing receipt requires reconciliation');
      await this.identity();
      if (retained) {
        await this.refreshAuthorization();
        need(LIVE_EXECUTION_ALLOWED && this.#auth('T02')?.stage === 'GO' &&
          this.#auth('T02').planDigest === this.#state.planDigest, 'Exact T02 authorization required for retained preparation');
      }
      await this.#prerequisites(step);
      if (stepId === 'T03' && !this.#secret) await this.#checkLostCommitment();
      const saved = this.#state.entries[stepId];
      if (saved && !this.#prepared.has(stepId) && stepId !== 'T03' && stepId !== 'T04') {
        await this.#recover(stepId, saved);
      }
      if (stepId === 'T04') need(this.#privateEstimate, 'Private reveal estimate requires an isolated transport');
      const { header, estimate, packet, spec, review } = await this.#evaluate(step, epoch, () => {
        if (stepId === 'T03' && !this.#secret) this.#secret = this.#random(new Uint8Array(32));
        return stepId === 'T03' ? [this.commitmentForReview(this.#revealArgs())] : stepId === 'T04' ? this.#revealArgs() : undefined;
      }, undefined, undefined, retained);
      if (retained) {
        need(BigInt(retained.gas) === (estimate * BigInt(this.bundle.inputs.fees.gasLimitMultiplierPercent) + 99n) / 100n,
          'T02 gas estimate changed from reviewed limit; new owner review required');
        need(this.#matchesAuthorization(this.#auth('T02'), 'T02', packet, { packetDigest: digest(packet) }),
          'Prepared T02 packet differs from existing authorization; new owner review required');
      }
      const anchor = { number: header.number, hash: header.hash, estimate: estimate.toString() };
      if (retained) anchor.reviewedCaps = retained;
      if (stepId === 'T03') this.#storage.setItem(this.#registrationKey, JSON.stringify({
        planDigest: this.#state.planDigest, commitment: spec.args[0],
      }));
      this.#save(stepId, { status: 'PREPARED', reviewDigest: digest(review), packetDigest: digest(packet), anchor });
      this.#prepared.set(stepId, { packet, spec, review });
      return structuredClone(review);
    }));
  }
  async #evaluate(step, epoch, resolvePrivateArgs = () => undefined, reviewedExpiry, previewHeader, reviewedTx) {
    const { inputs } = this.bundle;
    const stepId = step.id;
    const header = await this.read('eth_getBlockByNumber', ['latest', false]);
    need(headerOK(header), 'Latest header unavailable');
    const checkNonce = async () => {
      const tags = [header.number, 'latest', 'pending'];
      const nonces = await Promise.all(tags.map(tag => this.read('eth_getTransactionCount', [this.owner, tag])));
      need(nonces.every(n => BigInt(n) === BigInt(step.candidateNonce)), 'Owner nonce or reviewed prefix changed');
    };
    await checkNonce();
    const privateArgs = resolvePrivateArgs();
    const spec = await candidateStep(this, step, header, privateArgs, this.#state.entries, reviewedExpiry);
    const { args } = spec;
    const { tx, creation } = this.#envelope(step, header, args, reviewedTx);
    const fee = BigInt(tx.maxFeePerGas), tip = BigInt(tx.maxPriorityFeePerGas);
    if (reviewedTx) {
      need(fee >= BigInt(header.baseFeePerGas) + tip, 'Base fee moved outside reviewed envelope');
      tx.gas = reviewedTx.gas;
    }
    const estimateTx = { ...tx };
    if (creation) delete estimateTx.to;
    let estimate;
    try {
      estimate = BigInt(await (stepId === 'T04' ? this.#privateEstimate(estimateTx, header) : this.read('eth_estimateGas', [estimateTx, header.number])));
    } catch { throw new Error('Exact gas estimate unavailable'); }
    const gas = reviewedTx ? BigInt(reviewedTx.gas) :
      (estimate * BigInt(inputs.fees.gasLimitMultiplierPercent) + 99n) / 100n;
    const reserve = gas * fee;
    const spent = this.bundle.plan.transactions.slice(0, this.bundle.plan.transactions.indexOf(step))
      .reduce((sum, prior) => sum + BigInt(this.#state.entries[prior.id]?.costWei ?? 0), 0n);
    const balance = BigInt(await this.read('eth_getBalance', [this.owner, header.number]));
    need(estimate > 0n && gas >= estimate && gas <= BigInt(inputs.fees.maxGasPerStep) &&
      reserve + spent <= BigInt(inputs.fees.maxTotalWei) && balance >= reserve, 'Gas or ETH budget exceeded');
    await checkNonce();
    const latest = await this.#fresh(header, epoch);
    need(fee >= BigInt(latest.baseFeePerGas) + tip, 'Base fee moved outside reviewed envelope');
    if (spec.revealDeadline) need(BigInt(latest.timestamp) < spec.revealDeadline, 'Commitment reveal window expired');
    if (spec.minimumRemaining) need(BigInt(args.at(-1)) - BigInt(latest.timestamp) >= spec.minimumRemaining, 'Credential margin too short');
    tx.gas = toQuantity(gas);
    const { packet, review } = await this.#packet(step, header, spec, tx, creation, estimate, previewHeader);
    return { header, estimate, packet, spec, review };
  }
  async #revalidate(stepId, displayed, confirmed, epoch) {
    need(confirmed === true && displayed?.step === stepId, 'Explicit ' + stepId + ' confirmation required');
    const step = this.bundle.plan.transactions.find(item => item.id === stepId);
    const saved = this.#state.entries[stepId];
    const prepared = this.#prepared.get(stepId);
    need(step?.conditionallyIncluded && saved?.status === 'PREPARED' && prepared, 'Prepare a new ' + stepId + ' review');
    need(saved.reviewDigest === digest(displayed) && saved.packetDigest === digest(prepared.packet), stepId + ' review was modified');
    const { review, packet } = prepared;
    if (stepId === 'T01') this.#assertT01Envelope(packet);
    const auth = this.#auth(stepId);
    const durable = LIVE_EXECUTION_ALLOWED && stepId === 'T01' && isT01IntentAuthorization(auth) &&
      auth.intentDigest === t01IntentDigest(this.bundle, packet);
    const exactT02 = LIVE_EXECUTION_ALLOWED && stepId === 'T02' && this.#matchesAuthorization(auth, stepId, packet, saved);
    const refreshReviewed = durable || exactT02;
    if (!refreshReviewed) await this.#fresh(review.snapshot, epoch);
    await this.#prerequisites(step);
    const fresh = await this.#evaluate(step, epoch,
      () => stepId === 'T03' || stepId === 'T04' ? packet.arguments : undefined,
      stepId === 'T08' || stepId === 'T15' ? packet.arguments.at(-1) : undefined,
      refreshReviewed ? undefined : review.snapshot, refreshReviewed ? packet.tx : undefined);
    need(digest(fresh.packet) === saved.packetDigest && fresh.review.estimate === review.estimate,
      stepId + ' state, estimate or fee changed. Prepare a new review.');
    if (refreshReviewed && fresh.header.number !== review.snapshot.number) {
      // The displayed block still anchors receipt recovery, even after it ages out.
      const anchor = await this.read('eth_getBlockByNumber', [review.snapshot.number, false]);
      need(anchor?.hash === review.snapshot.hash, 'Review block lost canonicality');
    } else if (refreshReviewed) {
      need(fresh.header.hash === review.snapshot.hash, 'Review block lost canonicality');
    }
    const [, latestNonce, pendingNonce] = await Promise.all([
      this.identity(),
      this.read('eth_getTransactionCount', [this.owner, 'latest']),
      this.read('eth_getTransactionCount', [this.owner, 'pending']),
    ]);
    need(epoch === this.#epoch && [latestNonce, pendingNonce].every(n => BigInt(n) === BigInt(packet.tx.nonce)),
      'Wallet context or owner nonce changed during confirmation');
    // Finish wallet and nonce reads before the last chain snapshot check.
    // Submission persists the attempt and calls the wallet without another RPC read.
    const latest = await this.#checkSnapshotFreshness(refreshReviewed ? fresh.header : review.snapshot, epoch, refreshReviewed);
    need(BigInt(packet.tx.maxFeePerGas) >= BigInt(latest.baseFeePerGas) + BigInt(packet.tx.maxPriorityFeePerGas),
      'Base fee moved outside reviewed envelope');
    return { saved, packet, durable };
  }
  #assertT01Envelope(packet) {
    const { tx } = packet;
    const [recipient, amount] = packet.arguments;
    const step = this.bundle.plan.transactions[0];
    const { fees } = this.bundle.inputs;
    decodePacket(packet);
    need(step.id === 'T01' && packet.signature === 'mint(address,uint256)' && same(recipient, this.owner) &&
      BigInt(amount) === 8000021n && same(tx.from, this.owner) && tx.chainId === '0xaa36a7' && tx.value === '0x0' &&
      same(tx.to, '0x240b0316df57887dbbe58b586508b19e633a14aa') && same(tx.data, step.candidateCalldata) &&
      tx.nonce === step.candidateNonce, 'T01 mint is outside the approved scope');
    const gas = BigInt(tx.gas), fee = BigInt(tx.maxFeePerGas), tip = BigInt(tx.maxPriorityFeePerGas);
    need(gas > 0n && gas <= BigInt(fees.maxGasPerStep) && fee > 0n && fee <= BigInt(fees.maxFeePerGasWei) &&
      tip <= fee && tip <= BigInt(fees.maxPriorityFeePerGasWei) &&
      gas * fee <= BigInt(fees.maxTotalWei), 'T01 envelope exceeds approved ceilings');
  }
  async refreshAuthorization() {
    this.#authorization = undefined;
    if (!LIVE_EXECUTION_ALLOWED) return;
    try {
      const response = await fetch('/step-authorization.json', { cache: 'no-store', redirect: 'error', mode: 'same-origin' });
      const auth = response.ok ? await response.json() : null;
      if (isT01IntentAuthorization(auth) || (auth?.stage === 'GO' && /^T(0[1-9]|1[0-5])$/.test(auth.step) &&
          Object.keys(auth).length === 4 && hash(auth.planDigest) && hash(auth.packetDigest))) this.#authorization = Object.freeze(auth);
    } catch { /* A missing authorization cannot open a gate. */ }
  }
  #auth(stepId) {
    return this.#authorization?.step === stepId ? this.#authorization
      : stepId === 'T01' ? this.#t01Authorization : undefined;
  }
  #matchesAuthorization(auth, stepId, packet, entry) {
    if (auth?.stage !== 'GO' || auth.step !== stepId || !packet || !entry ||
        entry.packetDigest !== digest(packet)) return false;
    if (isT01IntentAuthorization(auth)) {
      return this.#validatedIntentReview?.durable === true &&
        this.#validatedIntentReview.epoch === this.#epoch &&
        this.#validatedIntentReview.reviewDigest === entry.reviewDigest &&
        auth.intentDigest === t01IntentDigest(this.bundle, packet);
    }
    return auth.planDigest === this.#state.planDigest && auth.packetDigest === entry.packetDigest;
  }
  async #send() {
    const grant = this.#grant;
    this.#grant = undefined;
    need(grant, 'Missing one-use wallet grant');
    const { stepId, packet, attempt, epoch } = grant;
    need(stepId !== 'T04', revealBlocked);
    const auth = this.#auth(stepId);
    need(epoch === this.#epoch && LIVE_EXECUTION_ALLOWED && this.#provider.isMetaMask === true &&
      this.#state.planDigest === digest(this.bundle) &&
      this.#matchesAuthorization(auth, stepId, packet, this.#state.entries[stepId]),
    'Trusted ' + stepId + ' authorization required');
    if (stepId === 'T01') this.#assertT01Envelope(packet);
    const tx = structuredClone(packet.tx);
    const persisted = this.#journal.read();
    const entry = persisted?.entries[stepId];
    need(this.#storage.getItem(this.#attemptStorageKey(stepId)) === JSON.stringify(attempt) &&
      attempt.transactionDigest === digest(tx) &&
      persisted?.planDigest === attempt.planDigest && entry?.status === 'REQUESTING' &&
      entry.packetDigest === attempt.packetDigest, 'Durable ' + stepId + ' attempt lock missing or changed');
    need(epoch === this.#epoch, 'Wallet context changed');
    if (packet.creation) delete tx.to;
    return this.#provider.request({ method: 'eth_sendTransaction', params: [tx] });
  }
  async validateConfirmation(displayed, confirmed) {
    return this.#validate(displayed?.step, displayed, confirmed);
  }
  async validateT01Confirmation(displayed, confirmed) {
    return this.#validate('T01', displayed, confirmed);
  }
  async #validate(stepId, displayed, confirmed) {
    return this.#run(epoch => this.#exclusive(async () => {
      this.#validatedIntentReview = undefined;
      const { saved, packet, durable } = await this.#revalidate(stepId, displayed, confirmed, epoch);
      const result = { execution: 'DISABLED', step: stepId, planDigest: this.#state.planDigest,
        reviewDigest: saved.reviewDigest, packetDigest: saved.packetDigest };
      if (stepId === 'T01') {
        this.#validatedIntentReview = { epoch, reviewDigest: saved.reviewDigest, durable };
        result.intentDigest = t01IntentDigest(this.bundle, packet);
        result.intentFeePolicy = { ...this.bundle.inputs.fees };
      }
      return result;
    }));
  }
  canSubmit(displayed) {
    const stepId = displayed?.step;
    const auth = this.#auth(stepId);
    const saved = this.#state.entries[stepId];
    return Boolean(stepId !== 'T04' && LIVE_EXECUTION_ALLOWED && saved?.status === 'PREPARED' &&
      this.#matchesAuthorization(auth, stepId, this.#prepared.get(stepId)?.packet, saved) &&
      digest(displayed) === saved.reviewDigest && this.#attemptAvailable(stepId));
  }
  canSubmitT01(displayed) { return displayed?.step === 'T01' && this.canSubmit(displayed); }
  async submitT01(displayed, confirmed, event) {
    need(displayed?.step === 'T01', 'T01 execution disabled or exact owner authorization missing');
    return this.submitStep(displayed, confirmed, event);
  }
  async submitStep(displayed, confirmed, event) {
    const stepId = displayed?.step;
    return this.#run(async epoch => {
      need(stepId !== 'T04', revealBlocked);
      const authorized = () => need(this.canSubmit(displayed), stepId + ' execution disabled or exact owner authorization missing');
      authorized();
      need(confirmed === true, 'Explicit ' + stepId + ' confirmation required');
      need(consumeConfirmationClick(event), 'Use the ' + stepId + ' confirmation button directly');
      need(this.#locks?.request, 'Exclusive browser lock unavailable');
      return this.#exclusive(async () => {
        await this.refreshAuthorization();
        authorized();
        const { saved, packet } = await this.#revalidate(stepId, displayed, confirmed, epoch).catch(error => {
          if (stepId === 'T01') this.#validatedIntentReview = undefined;
          throw error;
        });
        authorized();
        for (const prior of this.bundle.plan.transactions) {
          if (prior.id === 'T01' && stepId === 'T01' && this.#retryAllowed()) continue;
          const outstanding = this.#attempt(prior.id);
          need(!outstanding || BigInt(outstanding.nonce) !== BigInt(packet.tx.nonce),
            'Owner nonce already has a durable attempt for ' + prior.id);
        }
        const key = this.#attemptStorageKey(stepId);
        const attempt = { nonce: packet.tx.nonce, planDigest: this.#state.planDigest, packetDigest: saved.packetDigest,
          transactionDigest: digest(packet.tx), status: 'REQUESTING' };
        if (key === this.#retryKey()) {
          const recovery = this.#recoveryRecord();
          attempt.recoveryDigest = recovery.recoveryDigest;
          attempt.parentAttemptDigest = recovery.rejectedAttemptDigest;
          attempt.attemptId = digest({ recoveryDigest: recovery.recoveryDigest, transactionDigest: attempt.transactionDigest });
          this.#recoveryPermission = undefined;
        }
        this.#storage.setItem(key, JSON.stringify(attempt));
        if (key === this.#retryKey()) {
          need(this.#storage.getItem(key) === JSON.stringify(attempt), 'Attempt persistence failed');
        }
        this.#save(stepId, { ...saved, status: 'REQUESTING' });
        let txHash;
        try {
          this.#update('REQUESTING');
          this.#grant = { stepId, packet, attempt, epoch };
          txHash = await this.#send();
          need(hash(txHash), 'Invalid transaction hash');
        } catch (error) {
          const status = error?.code === 4001 ? 'REJECTED' : 'UNCERTAIN';
          this.#storage.setItem(key, JSON.stringify({ ...attempt, status }));
          this.#save(stepId, { ...saved, status });
          throw new Error(status === 'REJECTED' ? 'MetaMask rejected ' + stepId + '; manual reconciliation required' :
            stepId + ' submission uncertain; reconcile nonce and hash manually');
        }
        this.#storage.setItem(key, JSON.stringify({ ...attempt, status: 'PENDING', hash: txHash }));
        this.#save(stepId, { ...saved, status: 'PENDING', receiptHash: txHash });
        return txHash;
      });
    });
  }
  async #checkLostCommitment() {
    const raw = this.#storage.getItem(this.#registrationKey);
    if (!raw && !this.#state.entries.T03) return;
    const previous = raw ? JSON.parse(raw) : null;
    const blocked = 'Registration preimage lost. Reconcile the commit and wait for expiry before reviewing a new plan.';
    need(previous && hash(previous.planDigest) && hash(previous.commitment) &&
      previous.planDigest !== this.#state.planDigest && !this.#state.entries.T03, blocked);
    const header = await this.read('eth_getBlockByNumber', ['latest', false]);
    need(headerOK(header), blocked);
    const iface = this.interfaces.ETHRegistrar;
    const read = async (name, args) => iface.decodeFunctionResult(name, await this.read('eth_call', [{
      to: this.addresses.ETHRegistrar, data: iface.encodeFunctionData(name, args),
    }, header.number]))[0];
    const original = new BrowserJournal(this.#storage, 'nak-candidate:' + previous.planDigest).read();
    const receiptHash = original?.entries?.T03?.receiptHash;
    need(hash(receiptHash), blocked);
    const [receipt, mined, finalized] = await Promise.all([
      this.read('eth_getTransactionReceipt', [receiptHash]),
      this.read('eth_getTransactionByHash', [receiptHash]),
      this.read('eth_getBlockByNumber', [this.bundle.inputs.confirmations.finalityTag, false]),
    ]);
    need(receipt?.status === '0x1' && same(receipt.transactionHash, receiptHash) &&
      mined?.blockHash === receipt.blockHash && same(mined.hash, receiptHash) &&
      same(mined.from, this.owner) && same(mined.to, this.addresses.ETHRegistrar) &&
      same(mined.input, iface.encodeFunctionData('commit', [previous.commitment])) &&
      headerOK(finalized) && BigInt(finalized.number) >= BigInt(receipt.blockNumber), blocked);
    const commitBlock = await this.read('eth_getBlockByNumber', [receipt.blockNumber, false]);
    need(headerOK(commitBlock) && commitBlock.hash === receipt.blockHash, blocked);
    const at = await read('commitmentAt', [previous.commitment]);
    const max = await read('MAX_COMMITMENT_AGE', []);
    need(at > 0n && at === BigInt(commitBlock.timestamp) && BigInt(header.timestamp) >= at + max &&
      (await this.read('eth_getBlockByNumber', [header.number, false]))?.hash === header.hash, blocked);
  }
  #envelope(step, header, args, reviewedTx) {
    const { inputs } = this.bundle;
    const iface = this.interfaces[step.abi];
    const creation = step.signature.startsWith('constructor(');
    const data = creation ? this.bundle.creation[step.abi] + iface.encodeDeploy(args).slice(2) : iface.encodeFunctionData(step.signature, args);
    need(same(step.signer.address, this.owner) && (!step.candidateCalldata || same(step.candidateCalldata, data)), 'Reviewed sender/calldata changed');
    if (creation) need(same(getCreateAddress({ from: this.owner, nonce: BigInt(step.candidateNonce) }), step.candidateCreationAddress), 'Reviewed CREATE prediction changed');
    const tip = reviewedTx ? BigInt(reviewedTx.maxPriorityFeePerGas) : 1n;
    const fee = reviewedTx ? BigInt(reviewedTx.maxFeePerGas) : 2n * BigInt(header.baseFeePerGas) + tip;
    need(fee <= BigInt(inputs.fees.maxFeePerGasWei) && tip <= BigInt(inputs.fees.maxPriorityFeePerGasWei), 'Fee exceeds approved ceiling');
    const tx = { from: this.owner, to: step.candidateDestination ?? '', data, value: '0x0', chainId: '0xaa36a7',
      nonce: step.candidateNonce, maxFeePerGas: toQuantity(fee), maxPriorityFeePerGas: toQuantity(tip) };
    return { tx, creation };
  }
  async #packet(step, header, spec, tx, creation, estimate, previewHeader = header) {
    const stepId = step.id, args = spec.args;
    const reserve = BigInt(tx.gas) * BigInt(tx.maxFeePerGas);
    const preview = await spec.receipt(previewHeader);
    const packet = { tx, arguments: args, signature: step.signature, abi: this.abis[step.abi], creation,
      creationBytecode: creation ? this.bundle.creation[step.abi] : null,
      expectedAddress: step.candidateCreationAddress, expectedTarget: step.candidateDestination,
      tokenReview: spec.tokenReview, inputClass: 'UNSIGNED_CANDIDATE', expectedEvents: preview.events, postconditions: preview.post };
    const review = { ...decodePacket(packet), step: stepId, execution: 'DISABLED', snapshot: { number: header.number, hash: header.hash, timestamp: header.timestamp },
      estimate: estimate.toString(), reservedWei: reserve.toString(), prerequisiteReads: spec.checks,
      expectedEventSignatures: preview.events.map(({ address, signature }) => ({ address, signature })),
      unsignedTransaction: stepId === 'T04' ? { ...tx, data: '[PRIVATE REVEAL]' } : tx };
    return { packet, review };
  }
  async #recover(stepId, saved, mined, receipt) {
    const { plan, inputs } = this.bundle;
    const step = plan.transactions.find(s => s.id === stepId);
    const anchor = saved?.anchor;
    need(step?.conditionallyIncluded && anchor && /^0x[0-9a-f]+$/.test(anchor.number) &&
      hash(anchor.hash) && typeof anchor.estimate === 'string' && /^[1-9][0-9]{0,15}$/.test(anchor.estimate), 'Missing or invalid recovery anchor');
    const header = await this.read('eth_getBlockByNumber', [anchor.number, false]);
    need(headerOK(header) && header.number === anchor.number && header.hash === anchor.hash &&
      (!receipt || BigInt(receipt.blockNumber) >= BigInt(header.number)), 'Recovery anchor is no longer canonical');
    need(BigInt(await this.read('eth_getTransactionCount', [this.owner, header.number])) === BigInt(step.candidateNonce), 'Recovery nonce differs from plan');
    let privateArgs;
    if (stepId === 'T03' || stepId === 'T04') {
      // The input is public only after a successful canonical receipt. Keep it in memory.
      need(mined?.blockHash === receipt.blockHash && same(mined.from, this.owner) &&
        same(mined.to, step.candidateDestination) && same(mined.hash, receipt.transactionHash), 'Invalid mined registration input');
      privateArgs = Array.from(this.interfaces.ETHRegistrar.decodeFunctionData(step.signature, mined.input));
      need(step.candidateArguments.every((value, index) => value === null || same(value, privateArgs[index])), 'Mined reveal differs from plan');
      // Canonicalize ABI integers exactly as in the original plan.
      if (stepId === 'T04') privateArgs = step.candidateArguments.map((value, index) => value ?? privateArgs[index]);
    }
    const spec = await candidateStep(this, step, header, privateArgs, this.#state.entries);
    const retained = stepId === 'T02' && anchor.reviewedCaps ? this.#t02ReviewedCaps(anchor.reviewedCaps) : undefined;
    const { tx, creation } = this.#envelope(step, header, spec.args, retained);
    const estimate = BigInt(anchor.estimate);
    const gas = retained ? BigInt(retained.gas) :
      (estimate * BigInt(inputs.fees.gasLimitMultiplierPercent) + 99n) / 100n;
    need(gas >= estimate && gas <= BigInt(inputs.fees.maxGasPerStep) &&
      gas * BigInt(tx.maxFeePerGas) <= BigInt(inputs.fees.maxTotalWei), 'Recovered gas budget exceeds policy');
    tx.gas = toQuantity(gas);
    const item = { ...await this.#packet(step, header, spec, tx, creation, estimate), spec };
    need(saved.reviewDigest === digest(item.review) && saved.packetDigest === digest(item.packet), 'Recovered packet digest mismatch');
    need((await this.read('eth_getBlockByNumber', [header.number, false]))?.hash === header.hash, 'Recovery anchor changed');
    return item;
  }
  async reconcile(stepId, txHash) {
    return this.#run(() => this.#exclusive(async () => {
      const step = this.bundle.plan.transactions.find(s => s.id === stepId);
      need(step?.conditionallyIncluded, 'Step excluded or unknown');
      const original = stepId === 'T01' ? this.#originalAttempt() : null;
      if (original?.status === 'REJECTED' && !Object.hasOwn(original, 'hash') &&
          !this.#storage.getItem(this.#retryKey()) && hash(txHash)) {
        this.#recoveryPermission = undefined;
        this.#validatedIntentReview = undefined;
        const key = this.#transactionEvidenceKey();
        if (!this.#storage.getItem(key)) {
          this.#storage.setItem(key, JSON.stringify({ hash: txHash, observedAt: this.now() }));
        }
        need(this.#storage.getItem(key), 'Transaction evidence persistence failed; stop all deployment tabs');
        throw new Error('Transaction evidence appeared for rejected T01; manual reconciliation required');
      }
      await this.#prerequisites(step);
      return this.#verify(stepId, txHash ?? this.#receiptHash(stepId));
    }));
  }
  async #verify(stepId, txHash) {
    const saved = this.#state.entries[stepId];
    try { return await this.#verifyBoundReceipt(stepId, txHash); }
    catch (error) {
      if (saved?.receiptHash && this.#state.entries[stepId] === saved &&
          (saved.status !== 'PENDING' || error.message !== 'Receipt pending')) {
        this.#save(stepId, { ...saved, status: 'RECHECK_REQUIRED' });
      }
      throw error;
    }
  }
  async #verifyBoundReceipt(stepId, txHash) {
    const saved = this.#state.entries[stepId];
    const attempt = this.#attempt(stepId);
    if (attempt) {
      need(attempt.planDigest === this.#state.planDigest && attempt.packetDigest === saved?.packetDigest, stepId + ' attempt differs from saved packet');
      need(!attempt.hash || same(attempt.hash, txHash), stepId + ' hash differs; possible replacement requires manual reconciliation');
    }
    need(saved?.anchor && hash(txHash) && (!saved.receiptHash || same(saved.receiptHash, txHash)), 'Prepared review and matching receipt hash required');
    const epoch = this.#epoch;
    await this.identity();
    const receipt = await this.read('eth_getTransactionReceipt', [txHash]);
    if (!receipt && attempt) {
      const latestNonce = await this.read('eth_getTransactionCount', [this.owner, 'latest']);
      need(BigInt(latestNonce) <= BigInt(attempt.nonce), stepId + ' nonce consumed without this receipt; possible replacement');
    }
    need(receipt, 'Receipt pending');
    const header = await this.read('eth_getBlockByNumber', [receipt.blockNumber, false]);
    need(header?.hash === receipt.blockHash && same(receipt.transactionHash, txHash) &&
      ['0x0', '0x1'].includes(receipt.status) && BigInt(header.number) >= BigInt(saved.anchor.number), 'Receipt block or status invalid');
    const mined = await this.read('eth_getTransactionByHash', [txHash]);
    const item = this.#prepared.get(stepId) ?? await this.#recover(stepId, saved, mined, receipt);
    const { packet, spec } = item;
    need(saved.packetDigest === digest(packet), 'Receipt differs from journal binding');
    need(['gas','maxFeePerGas','maxPriorityFeePerGas'].every(field => mined?.[field] != null && BigInt(mined[field]) === BigInt(packet.tx[field])), 'Mined gas or fee differs from reviewed envelope');
    if (receipt.status === '0x0') {
      const tx = packet.tx;
      need(mined.blockHash === receipt.blockHash && same(mined.hash, txHash) && same(mined.from, this.owner) &&
        same(receipt.from, this.owner) && same(mined.input, tx.data) && BigInt(mined.nonce) === BigInt(tx.nonce) &&
        BigInt(mined.value) === 0n && BigInt(mined.chainId) === 11155111n &&
        (packet.creation ? mined.to === null && receipt.to === null : same(mined.to, tx.to) && same(receipt.to, tx.to)),
      'Reverted transaction differs from reviewed packet');
      await this.identity();
      need(epoch === this.#epoch, 'Wallet context changed');
      if (attempt) this.#storage.setItem(this.#attemptStorageKey(stepId), JSON.stringify({ ...attempt, hash: txHash, status: 'REVERTED' }));
      this.#save(stepId, { ...saved, status: 'REVERTED', receiptHash: txHash });
      throw new Error(stepId + ' reverted; dependent steps remain blocked');
    }
    const bound = await spec.receipt(header);
    const frozen = { ...packet, expectedEvents: bound.events, postconditions: bound.post, currentPostconditions: bound.current };
    let journal;
    const engine = new DeploymentWorkflow({ provider: this.#wallet, owner: this.owner,
      policy: { confirmations: this.bundle.inputs.confirmations.count, finalityTag: this.bundle.inputs.confirmations.finalityTag },
      steps: [{ id: stepId, packet: frozen, packetDigest: digest(frozen) }],
      journal: { read: () => null, write: value => { journal = value; } } });
    try {
      if (!await engine.verifyReceipt(stepId, txHash)) {
        need(epoch === this.#epoch, 'Wallet context changed');
        this.#save(stepId, { ...saved, status: 'PENDING', receiptHash: txHash });
        throw new Error('Receipt lacks confirmations/finality');
      }
      need(epoch === this.#epoch, 'Wallet context changed');
      const costWei = (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)).toString();
      const entry = { ...saved, status: 'CONFIRMED', receiptHash: txHash, evidence: journal.entries[stepId].receiptEvidence,
        bindings: bound.bindings ?? {}, costWei };
      if (attempt) this.#storage.setItem(this.#attemptStorageKey(stepId), JSON.stringify({ ...attempt, hash: txHash, status: 'CONFIRMED' }));
      this.#save(stepId, entry);
      this.#prepared.set(stepId, item);
      if (stepId === 'T04') this.#clearSecret();
      return structuredClone(entry);
    } finally { engine.close(); }
  }
}
