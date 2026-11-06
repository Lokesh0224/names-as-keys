import { AbiCoder, Interface, getCreateAddress, formatUnits, keccak256, toQuantity } from 'ethers';
import { BrowserJournal, DeploymentWorkflow, ReadOnlyWallet, decodePacket, digest, LIVE_EXECUTION_ALLOWED } from './workflow.mjs';
import { candidateStep, need, same } from './candidate_steps.mjs';
import { T01_AUTHORIZATION } from './t01_authorization.mjs';

export const labelABI = ['function getLabel(uint256) view returns(string)', 'event Label(bytes32 indexed labelHash,string label)'];
const events = ['accountsChanged', 'chainChanged', 'disconnect'];
const hash = value => /^0x[\da-f]{64}$/i.test(value ?? '');
const headerOK = h => h && hash(h.hash) && typeof h.number === 'string' && typeof h.timestamp === 'string';

export class CandidateReview {
  #wallet; #journal; #prepared = new Map(); #secret; #epoch = 0; #busy = false;
  #handlers; #update; #privateEstimate; #random; #state; #storage; #registrationKey;
  #provider; #t01Authorization; #t01AttemptKey; #locks; #t01Grant;
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
    this.#t01AttemptKey = 'nak-t01-attempt:11155111:' + inputs.owner.toLowerCase();
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
      try { this.#journal.write(this.#state); } catch { this.#prepared.clear(); }
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
    const entries = Object.fromEntries(Object.entries(this.#state.entries).map(([id, entry]) => [id, {
      status: entry.status, receiptHash: entry.receiptHash, reviewDigest: entry.reviewDigest,
      ...(entry.status === 'CONFIRMED' ? { evidence: entry.evidence, bindings: entry.bindings, costWei: entry.costWei } : {}),
    }]));
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
    const next = { ...this.#state, entries: { ...this.#state.entries, [id]: entry } };
    this.#journal.write(next);
    this.#state = next;
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
      const saved = this.#state.entries[prior.id];
      need(saved?.receiptHash, 'Verified prerequisite receipt required: ' + prior.id);
      await this.#verify(prior.id, saved.receiptHash);
    }
  }
  async #fresh(header, epoch) {
    const { expiry } = this.bundle.inputs;
    const [latest, canonical] = await Promise.all([
      this.read('eth_getBlockByNumber', ['latest', false]),
      this.read('eth_getBlockByNumber', [header.number, false]),
    ]);
    need(headerOK(latest) && canonical?.hash === header.hash, 'Review block lost canonicality');
    const lag = BigInt(latest.number) - BigInt(header.number);
    const age = this.now() / 1000 - Number(BigInt(header.timestamp));
    need(lag >= 0n && lag <= BigInt(expiry.maxAgeBlocks) && age >= -15 && age <= expiry.maxAgeSeconds, 'Review snapshot expired');
    await this.identity();
    need(epoch === this.#epoch, 'Wallet context changed');
    return latest;
  }
  async prepare(stepId) {
    return this.#run(async epoch => {
      const { plan } = this.bundle;
      const step = plan.transactions.find(s => s.id === stepId);
      need(step?.conditionallyIncluded, 'Step excluded or unknown');
      if (stepId === 'T01') need(!this.#storage.getItem(this.#t01AttemptKey), 'Prior T01 attempt requires manual reconciliation');
      need(!this.#state.entries[stepId]?.receiptHash, 'Existing receipt requires reconciliation');
      await this.identity();
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
      });
      const anchor = { number: header.number, hash: header.hash, estimate: estimate.toString() };
      if (stepId === 'T03') this.#storage.setItem(this.#registrationKey, JSON.stringify({
        planDigest: this.#state.planDigest, commitment: spec.args[0],
      }));
      this.#save(stepId, { status: 'PREPARED', reviewDigest: digest(review), packetDigest: digest(packet), anchor });
      this.#prepared.set(stepId, { packet, spec, review });
      return structuredClone(review);
    });
  }
  async #evaluate(step, epoch, resolvePrivateArgs = () => undefined) {
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
    const spec = await candidateStep(this, step, header, privateArgs, this.#state.entries);
    const { args } = spec;
    const { tx, creation } = this.#envelope(step, header, args);
    const fee = BigInt(tx.maxFeePerGas), tip = BigInt(tx.maxPriorityFeePerGas);
    const estimateTx = { ...tx };
    if (creation) delete estimateTx.to;
    let estimate;
    try {
      estimate = BigInt(await (stepId === 'T04' ? this.#privateEstimate(estimateTx, header) : this.read('eth_estimateGas', [estimateTx, header.number])));
    } catch { throw new Error('Exact gas estimate unavailable'); }
    const gas = (estimate * BigInt(inputs.fees.gasLimitMultiplierPercent) + 99n) / 100n;
    const reserve = gas * fee;
    const spent = Object.values(this.#state.entries).reduce((sum, entry) => sum + BigInt(entry.costWei ?? 0), 0n);
    const balance = BigInt(await this.read('eth_getBalance', [this.owner, header.number]));
    need(estimate > 0n && gas >= estimate && gas <= BigInt(inputs.fees.maxGasPerStep) &&
      reserve + spent <= BigInt(inputs.fees.maxTotalWei) && balance >= reserve, 'Gas or ETH budget exceeded');
    await checkNonce();
    const latest = await this.#fresh(header, epoch);
    need(fee >= BigInt(latest.baseFeePerGas) + tip, 'Base fee moved outside reviewed envelope');
    if (spec.revealDeadline) need(BigInt(latest.timestamp) < spec.revealDeadline, 'Commitment reveal window expired');
    if (spec.minimumRemaining) need(BigInt(args.at(-1)) - BigInt(latest.timestamp) >= spec.minimumRemaining, 'Credential margin too short');
    tx.gas = toQuantity(gas);
    const { packet, review } = await this.#packet(step, header, spec, tx, creation, estimate);
    return { header, estimate, packet, spec, review };
  }
  async #revalidateT01(displayed, confirmed, epoch) {
    need(confirmed === true && displayed?.step === 'T01', 'Explicit T01 confirmation required');
    const saved = this.#state.entries.T01;
    const prepared = this.#prepared.get('T01');
    need(saved?.status === 'PREPARED' && prepared, 'Prepare a new T01 review');
    need(saved.reviewDigest === digest(displayed) && saved.packetDigest === digest(prepared.packet), 'T01 review was modified');
    const { review, packet } = prepared;
    this.#assertT01Envelope(packet);
    await this.#fresh(review.snapshot, epoch);
    const fresh = await this.#evaluate(this.bundle.plan.transactions[0], epoch);
    need(digest(fresh.packet.tx) === digest(packet.tx) && fresh.review.estimate === review.estimate &&
      digest(fresh.review.token) === digest(review.token), 'T01 state, estimate or fee changed. Prepare a new review.');
    const latest = await this.#fresh(review.snapshot, epoch);
    need(BigInt(packet.tx.maxFeePerGas) >= BigInt(latest.baseFeePerGas) + BigInt(packet.tx.maxPriorityFeePerGas),
      'Base fee moved outside reviewed envelope');
    return { saved, packet };
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
  async #sendT01() {
    const grant = this.#t01Grant;
    this.#t01Grant = undefined;
    const auth = this.#t01Authorization;
    need(grant && grant.epoch === this.#epoch && LIVE_EXECUTION_ALLOWED && auth?.stage === 'GO' && auth.step === 'T01' &&
      this.#provider.isMetaMask === true && auth.planDigest === this.#state.planDigest &&
      auth.planDigest === digest(this.bundle) && auth.packetDigest === digest(grant.packet), 'Trusted T01 authorization required');
    this.#assertT01Envelope(grant.packet);
    const tx = structuredClone(grant.packet.tx);
    const persisted = this.#journal.read();
    const entry = persisted?.entries.T01;
    need(this.#storage.getItem(this.#t01AttemptKey) === JSON.stringify(grant.attempt) &&
      grant.attempt.transactionDigest === digest(tx) &&
      persisted?.planDigest === auth.planDigest && entry?.status === 'REQUESTING' &&
      entry.packetDigest === auth.packetDigest, 'Durable T01 attempt lock missing or changed');
    need(grant.epoch === this.#epoch, 'Wallet context changed');
    return this.#provider.request({ method: 'eth_sendTransaction', params: [tx] });
  }
  async validateT01Confirmation(displayed, confirmed) {
    return this.#run(async epoch => {
      const { saved } = await this.#revalidateT01(displayed, confirmed, epoch);
      return { execution: 'DISABLED', planDigest: this.#state.planDigest,
        reviewDigest: saved.reviewDigest, packetDigest: saved.packetDigest };
    });
  }
  canSubmitT01(displayed) {
    const auth = this.#t01Authorization;
    const saved = this.#state.entries.T01;
    return Boolean(LIVE_EXECUTION_ALLOWED && auth?.stage === 'GO' && auth.step === 'T01' &&
      auth.planDigest === this.#state.planDigest && saved?.status === 'PREPARED' &&
      auth.packetDigest === saved.packetDigest &&
      displayed?.step === 'T01' && digest(displayed) === saved.reviewDigest &&
      !this.#storage.getItem(this.#t01AttemptKey));
  }
  async submitT01(displayed, confirmed) {
    return this.#run(async epoch => {
      need(this.canSubmitT01(displayed), 'T01 execution disabled or exact owner authorization missing');
      need(this.#locks?.request, 'Exclusive browser lock unavailable');
      return this.#locks.request(this.#t01AttemptKey, { ifAvailable: true }, async lock => {
        need(lock && this.canSubmitT01(displayed), 'T01 already attempted or locked; reconcile manually');
        const { saved, packet } = await this.#revalidateT01(displayed, confirmed, epoch);
        const attempt = { nonce: packet.tx.nonce, planDigest: this.#state.planDigest, packetDigest: saved.packetDigest,
          transactionDigest: digest(packet.tx), status: 'REQUESTING' };
        this.#storage.setItem(this.#t01AttemptKey, JSON.stringify(attempt));
        this.#save('T01', { ...saved, status: 'REQUESTING' });
        let txHash;
        try {
          this.#t01Grant = { packet, attempt, epoch };
          txHash = await this.#sendT01();
          need(hash(txHash), 'Invalid transaction hash');
        } catch (error) {
          const status = error?.code === 4001 ? 'REJECTED' : 'UNCERTAIN';
          this.#storage.setItem(this.#t01AttemptKey, JSON.stringify({ ...attempt, status }));
          this.#save('T01', { ...saved, status });
          throw new Error(status === 'REJECTED' ? 'MetaMask rejected T01; manual reconciliation required' :
            'T01 submission uncertain; reconcile nonce and hash manually');
        }
        this.#storage.setItem(this.#t01AttemptKey, JSON.stringify({ ...attempt, status: 'PENDING', hash: txHash }));
        this.#save('T01', { ...saved, status: 'PENDING', receiptHash: txHash });
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
  #envelope(step, header, args) {
    const { inputs } = this.bundle;
    const iface = this.interfaces[step.abi];
    const creation = step.signature.startsWith('constructor(');
    const data = creation ? this.bundle.creation[step.abi] + iface.encodeDeploy(args).slice(2) : iface.encodeFunctionData(step.signature, args);
    need(same(step.signer.address, this.owner) && (!step.candidateCalldata || same(step.candidateCalldata, data)), 'Reviewed sender/calldata changed');
    if (creation) need(same(getCreateAddress({ from: this.owner, nonce: BigInt(step.candidateNonce) }), step.candidateCreationAddress), 'Reviewed CREATE prediction changed');
    const tip = 1n;
    const fee = 2n * BigInt(header.baseFeePerGas) + tip;
    need(fee <= BigInt(inputs.fees.maxFeePerGasWei) && tip <= BigInt(inputs.fees.maxPriorityFeePerGasWei), 'Fee exceeds approved ceiling');
    const tx = { from: this.owner, to: step.candidateDestination ?? '', data, value: '0x0', chainId: '0xaa36a7',
      nonce: step.candidateNonce, maxFeePerGas: toQuantity(fee), maxPriorityFeePerGas: toQuantity(tip) };
    return { tx, creation };
  }
  async #packet(step, header, spec, tx, creation, estimate) {
    const stepId = step.id, args = spec.args;
    const reserve = BigInt(tx.gas) * BigInt(tx.maxFeePerGas);
    const preview = await spec.receipt(header);
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
    const { tx, creation } = this.#envelope(step, header, spec.args);
    const estimate = BigInt(anchor.estimate);
    const gas = (estimate * BigInt(inputs.fees.gasLimitMultiplierPercent) + 99n) / 100n;
    need(gas >= estimate && gas <= BigInt(inputs.fees.maxGasPerStep) &&
      gas * BigInt(tx.maxFeePerGas) <= BigInt(inputs.fees.maxTotalWei), 'Recovered gas budget exceeds policy');
    tx.gas = toQuantity(gas);
    const item = { ...await this.#packet(step, header, spec, tx, creation, estimate), spec };
    need(saved.reviewDigest === digest(item.review) && saved.packetDigest === digest(item.packet), 'Recovered packet digest mismatch');
    need((await this.read('eth_getBlockByNumber', [header.number, false]))?.hash === header.hash, 'Recovery anchor changed');
    return item;
  }
  async reconcile(stepId, txHash) {
    return this.#run(async () => {
      const step = this.bundle.plan.transactions.find(s => s.id === stepId);
      need(step?.conditionallyIncluded, 'Step excluded or unknown');
      await this.#prerequisites(step);
      return this.#verify(stepId, txHash);
    });
  }
  async #verify(stepId, txHash) {
    const saved = this.#state.entries[stepId];
    try { return await this.#verifyBoundReceipt(stepId, txHash); }
    catch (error) {
      if (saved?.receiptHash) this.#save(stepId, { ...saved, status: 'RECHECK_REQUIRED' });
      throw error;
    }
  }
  async #verifyBoundReceipt(stepId, txHash) {
    const saved = this.#state.entries[stepId];
    const attempt = stepId === 'T01' && JSON.parse(this.#storage.getItem(this.#t01AttemptKey) ?? 'null');
    if (attempt) {
      need(attempt.packetDigest === saved?.packetDigest, 'T01 attempt differs from saved packet');
      need(!attempt.hash || same(attempt.hash, txHash), 'Different T01 hash; possible replacement requires manual reconciliation');
    }
    need(saved?.anchor && hash(txHash) && (!saved.receiptHash || same(saved.receiptHash, txHash)), 'Prepared review and matching receipt hash required');
    const epoch = this.#epoch;
    await this.identity();
    const receipt = await this.read('eth_getTransactionReceipt', [txHash]);
    if (!receipt && attempt) {
      const latestNonce = await this.read('eth_getTransactionCount', [this.owner, 'latest']);
      need(BigInt(latestNonce) <= BigInt(attempt.nonce), 'T01 nonce consumed without this receipt; possible replacement');
    }
    need(receipt, 'Receipt pending');
    const header = await this.read('eth_getBlockByNumber', [receipt.blockNumber, false]);
    need(header?.hash === receipt.blockHash && same(receipt.transactionHash, txHash) &&
      receipt.status === '0x1' && BigInt(header.number) >= BigInt(saved.anchor.number), 'Receipt block or status invalid');
    const mined = await this.read('eth_getTransactionByHash', [txHash]);
    const item = this.#prepared.get(stepId) ?? await this.#recover(stepId, saved, mined, receipt);
    const { packet, spec } = item;
    need(saved.packetDigest === digest(packet), 'Receipt differs from journal binding');
    need(['gas','maxFeePerGas','maxPriorityFeePerGas'].every(field => mined?.[field] != null && BigInt(mined[field]) === BigInt(packet.tx[field])), 'Mined gas or fee differs from reviewed envelope');
    const bound = await spec.receipt(header);
    const frozen = { ...packet, expectedEvents: bound.events, postconditions: bound.post, currentPostconditions: bound.current };
    let journal;
    const engine = new DeploymentWorkflow({ provider: this.#wallet, owner: this.owner,
      policy: { confirmations: this.bundle.inputs.confirmations.count, finalityTag: this.bundle.inputs.confirmations.finalityTag },
      steps: [{ id: stepId, packet: frozen, packetDigest: digest(frozen) }],
      journal: { read: () => null, write: value => { journal = value; } } });
    try {
      need(await engine.verifyReceipt(stepId, txHash), 'Receipt failed or lacks confirmations/finality');
      need(epoch === this.#epoch, 'Wallet context changed');
      const costWei = (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)).toString();
      const entry = { ...saved, status: 'CONFIRMED', receiptHash: txHash, evidence: journal.entries[stepId].receiptEvidence,
        bindings: bound.bindings ?? {}, costWei };
      this.#save(stepId, entry);
      this.#prepared.set(stepId, item);
      if (stepId === 'T04') this.#clearSecret();
      return structuredClone(entry);
    } finally { engine.close(); }
  }
}
