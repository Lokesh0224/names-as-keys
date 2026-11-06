import { Interface, getAddress, getCreateAddress, formatUnits, keccak256, sha256, toUtf8Bytes } from 'ethers';

export const LIVE_EXECUTION_ALLOWED = false;
export const CHAIN = 11155111n;
export const stable = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() :
  v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const digest = (value) => sha256(toUtf8Bytes(stable(value)));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const need = (condition, message) => { if (!condition) throw new Error(message); };
const hash = (x) => /^0x[0-9a-fA-F]{64}$/.test(x ?? '');
const clone = (x) => JSON.parse(stable(x));
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const hasNull = (x) => x === null || x === undefined || (typeof x === 'object' && Object.values(x).some(hasNull));
const READS = new Set(['eth_accounts', 'eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionCount',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getCode', 'eth_call', 'eth_getBalance', 'eth_estimateGas']);

/** Shipped adapter never exposes signing, account-permission prompts or submission. */
export class ReadOnlyWallet {
  testOnly = false;
  constructor(provider) { this.provider = provider; }
  request(args) { need(READS.has(args.method), 'Live execution and permission/signature requests disabled'); return this.provider.request(args); }
  async submitReviewed(tx, authorization) {
    need(LIVE_EXECUTION_ALLOWED && authorization?.stage === 'GO' && hash(authorization.planDigest) && hash(authorization.packetDigest), 'Live execution disabled; independent approval required');
    return this.provider.request({ method: 'eth_sendTransaction', params: [tx] });
  }
  on(name, handler) { this.provider.on?.(name, handler); }
  removeListener(name, handler) { this.provider.removeListener?.(name, handler); }
}

export function decodePacket(packet) {
  need(!hasNull(packet.tx) && !hasNull(packet.arguments), 'Unresolved transaction inputs');
  const keys = ['from','to','data','chainId','value','nonce','gas','maxFeePerGas','maxPriorityFeePerGas'];
  need(Object.keys(packet.tx).length === keys.length && keys.every(key => key in packet.tx), 'Unexpected/missing transaction fields');
  for (const key of ['chainId','value','nonce','gas','maxFeePerGas','maxPriorityFeePerGas']) need(/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(packet.tx[key]), 'Noncanonical RPC quantity');
  const iface = new Interface(packet.abi);
  let encoded;
  if (packet.creation) {
    need(/^0x(?:[0-9a-f]{2})+$/i.test(packet.creationBytecode ?? ''), 'Missing approved creation bytecode');
    encoded = packet.creationBytecode + iface.encodeDeploy(packet.arguments).slice(2);
    need(packet.tx.to === '', 'Creation destination must be explicitly absent');
    need(same(getCreateAddress({from:packet.tx.from,nonce:BigInt(packet.tx.nonce)}),packet.expectedAddress), 'Wrong predicted CREATE address');
    need(packet.signature === 'constructor(' + iface.deploy.inputs.map(x => x.format('sighash')).join(',') + ')', 'Wrong constructor signature');
  } else {
    encoded = iface.encodeFunctionData(packet.signature, packet.arguments);
    need(iface.getFunction(packet.signature).format('sighash') === packet.signature, 'Noncanonical signature');
    getAddress(packet.tx.to); getAddress(packet.expectedTarget);
    need(same(packet.tx.to, packet.expectedTarget), 'Unexpected destination binding');
  }
  need(same(encoded, packet.tx.data), 'Calldata differs from ABI-decoded review');
  need(BigInt(packet.tx.value) === 0n, 'Unexpected ETH value');
  need(BigInt(packet.tx.chainId) === CHAIN, 'Packet wrong network');
  need(packet.tokenReview && packet.inputClass && packet.expectedEvents && packet.postconditions?.length,
    'Missing token/event/state review');
  need(!hasNull(packet.expectedEvents) && !hasNull(packet.postconditions), 'Unresolved receipt verification inputs');
  for (const event of packet.expectedEvents) { const eventInterface = new Interface(event.abi); eventInterface.encodeEventLog(eventInterface.getEvent(event.signature), event.arguments); getAddress(event.address); }
  if (['mint(address,uint256)','approve(address,uint256)'].includes(packet.signature)) {
    need(same(packet.tokenReview.token,packet.expectedTarget) && BigInt(packet.tokenReview.units) === BigInt(packet.arguments[1]), 'Token summary differs from decoded amount');
    need(packet.tokenReview.amount === formatUnits(packet.arguments[1],packet.tokenReview.decimals), 'Token display amount/decimals mismatch');
    if (packet.signature === 'approve(address,uint256)') need(same(packet.tokenReview.spender,packet.arguments[0]), 'Allowance spender display mismatch');
  }
  const privateIndices = new Set(packet.privateArgumentIndices ?? []);
  if (['register(string,address,bytes32,address,address,uint64,address,bytes32)', 'makeCommitment(string,address,bytes32,address,address,uint64,bytes32)'].includes(packet.signature)) privateIndices.add(2);
  return { signature: packet.signature, argumentTypes: (packet.creation ? iface.deploy : iface.getFunction(packet.signature)).inputs.map(x => x.format('sighash')),
    arguments: packet.arguments.map((arg, i) => privateIndices.has(i) ? '[PRIVATE PREIMAGE: local memory only]' : arg),
    account: packet.tx.from, chain: String(CHAIN), destination: packet.creation ? '[CREATE: ' + packet.expectedAddress + ']' : packet.tx.to,
    calldataDigest: keccak256(packet.tx.data), nonce: packet.tx.nonce, token: packet.tokenReview,
    ethValueWei: packet.tx.value, gasLimit: packet.tx.gas, maxFeePerGasWei: packet.tx.maxFeePerGas,
    maxPriorityFeePerGasWei: packet.tx.maxPriorityFeePerGas, inputClass: packet.inputClass };
}

/** Exact ordered logs, including emitter, topics, all ABI arguments and no extras. */
export function verifyEvents(receipt, expected) {
  const logs = receipt.logs ?? [];
  need(logs.length === expected.length, 'Unexpected/missing receipt logs');
  let previousIndex = -1n;
  expected.forEach((event, i) => {
    const actual = logs[i];
    need(actual.removed !== true && BigInt(actual.logIndex) > previousIndex, 'Removed/duplicate/misordered log'); previousIndex = BigInt(actual.logIndex);
    if (actual.transactionHash) need(same(actual.transactionHash, receipt.transactionHash), 'Wrong log transaction');
    if (actual.blockHash) need(same(actual.blockHash, receipt.blockHash), 'Wrong log block');
    need(same(actual.address, event.address), 'Wrong event emitter');
    const iface = new Interface(event.abi);
    const encoded = iface.encodeEventLog(iface.getEvent(event.signature), event.arguments);
    need(stable(actual.topics.map(x => x.toLowerCase())) === stable(encoded.topics.map(x => x.toLowerCase())) && same(actual.data, encoded.data), 'Wrong event values/order');
    const decoded = iface.parseLog(actual);
    need(decoded?.signature === event.signature, 'Wrong event ABI signature');
  });
}

export class BrowserJournal {
  constructor(storage, key) { this.storage = storage; this.key = key; }
  read() { const text = this.storage.getItem(this.key); return text ? JSON.parse(text) : null; }
  write(value) {
    need(value.schema === 1 && hash(value.planDigest) && value.entries && value.history, 'Malformed public journal');
    const text = stable(value);
    // Journal API accepts the public state machine only, never review packets or raw calldata.
    need(!/"(?:arguments|data|privateArgumentIndices|registrationSecret|creationBytecode)"\s*:/.test(text), 'Private/raw packet material forbidden in public journal');
    this.storage.setItem(this.key, text);
  }
}

export class DeploymentWorkflow {
  constructor({ provider, owner, policy, steps, journal, testSubmission = false, executionEnabled = false, now = () => Date.now() }) {
    this.provider = provider; this.owner = getAddress(owner); this.policy = freeze(clone(policy)); this.steps = freeze(clone(steps));
    need(Number.isInteger(policy.confirmations) && policy.confirmations > 0 && policy.finalityTag === 'finalized', 'Invalid finality policy');
    this.planDigest = digest({ owner: this.owner, policy, steps }); this.journal = journal; this.now = now;
    this.testSubmission = testSubmission && provider.testOnly === true; this.executionEnabled = executionEnabled === true; this.epoch = 0; this.busy = false;
    this.packets = new Map(); this.reviewed = new Map(); this.history = [];
    this.entries = Object.fromEntries(steps.map(s => [s.id, { status: 'BLOCKED', attempts: [] }]));
    const restored = journal.read();
    if (restored) {
      need(restored.planDigest === this.planDigest, 'Recovery journal belongs to different plan');
      need(stable(Object.keys(restored.entries).sort()) === stable(Object.keys(this.entries).sort()), 'Invalid recovery inventory');
      this.entries = clone(restored.entries); this.history = clone(restored.history ?? []);
      for (const entry of Object.values(this.entries)) {
        entry.status = entry.attempts.length ? 'RECHECK_REQUIRED' : 'BLOCKED';
      }
    }
    this.handlers = Object.fromEntries(['chainChanged', 'accountsChanged', 'disconnect'].map(event => [event, () => this.invalidate(event)]));
    for (const [event, listener] of Object.entries(this.handlers)) provider.on?.(event, listener);
  }
  close() { for (const [event, listener] of Object.entries(this.handlers)) this.provider.removeListener?.(event, listener); }
  save() { this.journal.write({ schema: 1, planDigest: this.planDigest, entries: this.entries, history: this.history }); }
  entry(id) { need(this.entries[id], 'Unknown step'); return this.entries[id]; }
  state(id) { return clone(this.entry(id)); }
  invalidate(reason) {
    ++this.epoch; this.packets.clear(); this.reviewed.clear();
    for (const entry of Object.values(this.entries)) {
      if (entry.status === 'CONFIRMED') entry.status = 'RECHECK_REQUIRED';
      else if (entry.status === 'REQUESTING') entry.status = 'UNCERTAIN';
      else if (!['PENDING', 'RECHECK_REQUIRED', 'UNCERTAIN'].includes(entry.status)) entry.status = 'BLOCKED';
    }
    this.history.push({ kind: 'CONTEXT_INVALIDATED', reason, time: this.now() });
    try { this.save(); } catch { this.storageBroken = true; }
  }
  async read(method, params = []) { need(READS.has(method), 'Non-read RPC rejected'); return this.provider.request({ method, params }); }
  async identity() {
    const chain = await this.read('eth_chainId'); const accounts = await this.read('eth_accounts');
    need(BigInt(chain) === CHAIN, 'Wrong network'); need(accounts.length && same(accounts[0], this.owner), 'Wrong selected account');
  }
  async checks(checks, block) {
    need(checks.length > 0, 'No prerequisite/state checks');
    const observations = [];
    for (const check of checks) {
      need(check.id && check.to, 'Malformed read check');
      let actual;
      if (check.kind === 'call') {
        need(/^0x[0-9a-f]+$/i.test(check.data ?? '') && check.expected !== undefined, 'Unresolved ENS read');
        actual = await this.read('eth_call', [{ to: check.to, data: check.data }, block]);
        need(same(actual, check.expected), 'State mismatch: ' + check.id);
      } else if (check.kind === 'code') {
        need(hash(check.expectedHash), 'Unverified runtime hash');
        const code = await this.read('eth_getCode', [check.to, block]); actual = keccak256(code);
        need(same(actual, check.expectedHash), 'Code mismatch: ' + check.id);
      } else if (check.kind === 'balance') {
        actual = await this.read('eth_getBalance', [check.to, block]);
        need(BigInt(actual) >= BigInt(check.minimumWei), 'Insufficient ETH: ' + check.id);
        actual = 'minimum-satisfied';
      } else throw new Error('Unknown check kind');
      observations.push({ id: check.id, actual });
    }
    return observations;
  }
  async ancestors(id) {
    const index = this.steps.findIndex(s => s.id === id); need(index >= 0, 'Unknown step');
    for (const preceding of this.steps.slice(0, index)) {
      need(this.entry(preceding.id).status === 'CONFIRMED', 'Unverified preceding receipt: ' + preceding.id);
      need(await this.verifyReceipt(preceding.id, this.entry(preceding.id).receiptHash, true), 'Preceding receipt lost/unfinalized: ' + preceding.id);
    }
  }
  async evaluate(id, packet) {
    const epoch = this.epoch; await this.identity();
    need(same(packet.tx.from, this.owner), 'Wrong packet owner');
    need(this.policy.gates.length > 0 && this.policy.gates.every(g => g.status === 'PASS'), 'Failed/unresolved deployment gate');
    need(this.testSubmission ? packet.inputClass === 'TEST_ONLY' : packet.inputClass === 'DEPLOYMENT_APPROVED', 'Unapproved or mixed test inputs');
    const step = this.steps.find(s => s.id === id);
    need(step && packet.id === id && digest(packet) === step.packetDigest, 'Packet not bound to frozen reviewed plan');
    const review = decodePacket(packet);
    need(BigInt(packet.tx.gas) > 0n && BigInt(packet.tx.gas) <= BigInt(this.policy.maxGasPerStep), 'Gas limit exceeds policy');
    const fee = BigInt(packet.tx.maxFeePerGas), tip = BigInt(packet.tx.maxPriorityFeePerGas);
    need(fee > 0n && fee <= BigInt(this.policy.maxFeePerGas) && tip >= 0n && tip <= fee && tip <= BigInt(this.policy.maxPriorityFeePerGas), 'Fee ceiling exceeded');
    const total = this.steps.reduce((sum, s) => sum + BigInt(s.maxCostWei), 0n);
    need(total <= BigInt(this.policy.maxTotalWei), 'Total deployment budget exceeded');
    need(BigInt(packet.tx.gas) * fee <= BigInt(step.maxCostWei), 'Step budget exceeded');
    await this.ancestors(id);
    const header = await this.read('eth_getBlockByNumber', ['latest', false]);
    need(header && hash(header.hash), 'Missing latest header');
    need(this.now() / 1000 - Number(BigInt(header.timestamp)) <= this.policy.maxAgeSeconds && Number(BigInt(header.timestamp)) <= this.now() / 1000 + 15, 'Stale/future block');
    need(fee >= BigInt(header.baseFeePerGas) + tip, 'Fee does not cover base fee');
    const remaining = this.steps.slice(this.steps.findIndex(s => s.id === id)).reduce((sum,s) => sum + BigInt(s.maxCostWei),0n);
    const balance = BigInt(await this.read('eth_getBalance',[this.owner,header.number]));
    need(balance >= remaining, 'Insufficient ETH for remaining reviewed gas budget');
    const pending = await this.read('eth_getTransactionCount', [this.owner, 'pending']);
    need(BigInt(pending) === BigInt(packet.tx.nonce), 'Pending nonce changed');
    for (const window of packet.timeWindows ?? []) {
      const timestamp = BigInt(header.timestamp);
      need(timestamp >= BigInt(window.minimum) && timestamp < BigInt(window.maximum), 'Commitment/expiry time window violated');
    }
    const observations = await this.checks(packet.prerequisites, header.number);
    const tx = { ...packet.tx }; if (packet.creation) delete tx.to;
    const estimate = BigInt(await this.read('eth_estimateGas', [tx, header.number]));
    need(estimate > 0n && estimate <= BigInt(tx.gas), 'Gas estimate exceeds reviewed limit');
    await this.identity(); need(epoch === this.epoch, 'Account/chain changed during preflight');
    return { review, epoch, header, preparedAt: this.now(), fingerprint: digest({ observations, estimate: estimate.toString(), review }) };
  }
  async prepare(id, packet) {
    need(!this.busy && !this.storageBroken, 'Workflow busy/storage unavailable');
    const entry = this.entry(id);
    need(!entry.attempts.length || ['REJECTED'].includes(entry.status), 'Existing transaction requires reconciliation; no retry');
    this.busy = true; this.packets.delete(id); this.reviewed.delete(id); entry.status = 'BLOCKED';
    try {
      const frozen = clone(packet); const evaluated = await this.evaluate(id, frozen);
      this.packets.set(id, { packet: frozen, evaluated }); this.reviewed.delete(id);
      entry.status = 'PREPARED'; this.save(); return clone(evaluated.review);
    } finally { this.busy = false; }
  }
  reviewDigest(id) { const item = this.packets.get(id); need(item, 'Not prepared'); return digest(item.evaluated.review); }
  acknowledge(id, displayedDigest) {
    const current = this.packets.get(id); need(current && this.entry(id).status === 'PREPARED', 'Not prepared');
    need(displayedDigest === digest(current.evaluated.review), 'Displayed review differs');
    this.reviewed.set(id, displayedDigest); this.entry(id).status = 'REVIEWED'; this.save();
  }
  async submitTestOnly(id) { need(this.testSubmission, 'Execution disabled: test transport required'); return this.submitReviewed(id); }
  async submitReviewed(id) {
    const live = this.executionEnabled && LIVE_EXECUTION_ALLOWED && this.policy.liveAuthorization?.stage === 'GO' && this.policy.liveAuthorization?.transactionPlanDigest === digest(this.steps);
    need(this.testSubmission || live, 'Execution disabled; no live request authorized');
    need(!this.busy && !this.storageBroken, 'Workflow busy/storage unavailable');
    const current = this.packets.get(id); need(current && this.entry(id).status === 'REVIEWED' && this.reviewed.has(id), 'Explicit review acknowledgement required');
    this.busy = true;
    try {
      need(this.now() - current.evaluated.preparedAt <= this.policy.maxAgeSeconds * 1000, 'Review expired');
      const canonical = await this.read('eth_getBlockByNumber', [current.evaluated.header.number, false]);
      need(canonical?.hash === current.evaluated.header.hash, 'Review block reorganized');
      const fresh = await this.evaluate(id, current.packet);
      need(BigInt(fresh.header.number) - BigInt(current.evaluated.header.number) <= BigInt(this.policy.maxAgeBlocks), 'Review too many blocks old');
      need(fresh.fingerprint === current.evaluated.fingerprint, 'Prerequisite/estimate changed; review again');
      const entry = this.entry(id);
      const attempt = { nonce: current.packet.tx.nonce, calldataDigest: keccak256(current.packet.tx.data), packetDigest: digest(current.packet), hash: null, status: 'REQUESTING' };
      entry.attempts.push(attempt); entry.status = 'REQUESTING'; this.reviewed.delete(id);
      this.save(); // Durable nonce lock BEFORE any provider request.
      const tx = { ...current.packet.tx }; if (current.packet.creation) delete tx.to;
      try {
        const result = this.testSubmission ? await this.provider.request({ method: 'eth_sendTransaction', params: [tx] }) :
          await this.provider.submitReviewed(tx, { stage: 'GO', planDigest: this.planDigest, packetDigest: digest(current.packet) });
        need(hash(result), 'Provider returned no valid hash');
        attempt.hash = result; attempt.status = 'PENDING'; entry.status = 'PENDING'; entry.receiptHash = result; this.save();
        return result;
      } catch (error) {
        const rejected = error.code === 4001;
        attempt.status = rejected ? 'REJECTED' : 'UNCERTAIN'; entry.status = attempt.status;
        this.history.push({ kind: attempt.status, id, code: error.code ?? null }); // No raw provider error/secret data.
        try { this.save(); } catch { this.storageBroken = true; }
        throw new Error(rejected ? 'User rejected request; manual review required' : 'Submission uncertain; reconcile nonce/hash, never auto-retry');
      }
    } catch (error) {
      const entry = this.entry(id);
      if (entry.attempts.length === 0 || !['REQUESTING', 'PENDING', 'UNCERTAIN', 'REJECTED'].includes(entry.status)) {
        entry.status = 'BLOCKED'; this.packets.delete(id); this.reviewed.delete(id);
        try { this.save(); } catch { this.storageBroken = true; }
      }
      throw error;
    } finally { this.busy = false; }
  }
  async verifyReceipt(id, txHash, ancestor = false) {
    const step = this.steps.find(s => s.id === id); need(step, 'Unknown step');
    const packet = step.packet; need(packet && digest(packet) === step.packetDigest, 'Missing frozen recovery packet');
    const epoch = this.epoch; await this.identity(); need(hash(txHash), 'Missing transaction hash; manual nonce investigation required');
    const receipt = await this.read('eth_getTransactionReceipt', [txHash]);
    if (!receipt) {
      if (this.entry(id).status === 'CONFIRMED') { this.entry(id).status = 'RECHECK_REQUIRED'; this.save(); }
      return false; // Timeout/pending does not authorize retry.
    }
    const entry = this.entry(id);
    const block = await this.read('eth_getBlockByNumber', [receipt.blockNumber, false]);
    const tx = await this.read('eth_getTransactionByHash', [txHash]);
    const fail = (message) => { entry.status = 'RECHECK_REQUIRED'; this.reviewed.clear(); this.history.push({ kind: 'RECEIPT_BLOCKED', id, reason: message }); this.save(); throw new Error(message); };
    if (block?.hash !== receipt.blockHash || !same(receipt.transactionHash, txHash)) return fail('Receipt reorg/hash mismatch');
    const quantities = [receipt.blockNumber,receipt.status,receipt.gasUsed,receipt.effectiveGasPrice,tx?.nonce,tx?.value,tx?.chainId,tx?.gas,tx?.maxFeePerGas,tx?.maxPriorityFeePerGas];
    if (!quantities.every(value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))) return fail('Missing/malformed receipt or transaction quantity');
    if (!tx || BigInt(tx.gas) > BigInt(packet.tx.gas) || BigInt(tx.maxFeePerGas) > BigInt(packet.tx.maxFeePerGas) || BigInt(tx.maxPriorityFeePerGas) > BigInt(packet.tx.maxPriorityFeePerGas) || BigInt(receipt.gasUsed) > BigInt(packet.tx.gas) || BigInt(receipt.effectiveGasPrice) > BigInt(packet.tx.maxFeePerGas) || !same(tx.hash, txHash) || !same(tx.from, this.owner) || BigInt(tx.nonce) !== BigInt(packet.tx.nonce) ||
        !same(tx.input, packet.tx.data) || BigInt(tx.value) !== 0n || BigInt(tx.chainId) !== CHAIN ||
        tx.blockHash !== receipt.blockHash || !same(receipt.from, this.owner) ||
        (packet.creation ? tx.to !== null || receipt.to !== null || !same(receipt.contractAddress, packet.expectedAddress) : !same(tx.to, packet.expectedTarget) || !same(receipt.to, packet.expectedTarget))) return fail('Receipt/transaction identity differs from reviewed packet');
    if (BigInt(receipt.status) !== 1n) {
      entry.status = 'FAILED'; for (const attempt of entry.attempts) if (same(attempt.hash,txHash)) attempt.status = 'FAILED'; this.history.push({ kind: 'FAILED_RECEIPT', id, hash: txHash, blockHash: receipt.blockHash }); this.save(); return false;
    }
    const head = await this.read('eth_getBlockByNumber', [this.policy.finalityTag, false]);
    if (!head || BigInt(head.number) < BigInt(receipt.blockNumber) + BigInt(this.policy.confirmations) - 1n) { if (entry.status === 'CONFIRMED') { entry.status = 'RECHECK_REQUIRED'; this.save(); } return false; }
    try { verifyEvents(receipt, packet.expectedEvents); await this.checks(packet.postconditions, receipt.blockNumber); const persistent = packet.currentPostconditions ?? packet.postconditions; if (persistent.length) await this.checks(persistent, head.number); }
    catch (error) { return fail(error.message); }
    const again = await this.read('eth_getBlockByNumber', [receipt.blockNumber, false]);
    if (again?.hash !== receipt.blockHash) return fail('Receipt changed while verifying');
    await this.identity(); if (epoch !== this.epoch) return fail('Account/chain changed during receipt verification');
    entry.status = 'CONFIRMED'; entry.receiptHash = txHash;
    for (const attempt of entry.attempts) if (same(attempt.hash,txHash)) attempt.status = 'CONFIRMED'; else if (attempt.status === 'PENDING') attempt.status = 'REPLACED';
    entry.receiptEvidence = { hash: txHash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber,
      eventDigest: digest(receipt.logs), postconditionsDigest: digest(packet.postconditions) };
    this.save(); return true;
  }
  async reconcile(id) {
    const entry = this.entry(id); need(entry.attempts.length, 'No prior request');
    return this.verifyReceipt(id, entry.receiptHash ?? entry.attempts.at(-1).hash);
  }
  async recordCancellation(id, txHash) {
    const entry = this.entry(id); need(entry.attempts.length && entry.status !== 'CONFIRMED', 'No outstanding request');
    const epoch = this.epoch; await this.identity(); const step = this.steps.find(s => s.id === id);
    const tx = await this.read('eth_getTransactionByHash', [txHash]);
    const receipt = await this.read('eth_getTransactionReceipt', [txHash]);
    need(tx && receipt && same(tx.hash, txHash) && same(receipt.transactionHash, txHash) &&
      same(tx.from, this.owner) && same(tx.to, this.owner) && BigInt(tx.nonce) === BigInt(step.packet.tx.nonce) &&
      BigInt(tx.chainId) === CHAIN && BigInt(tx.value) === 0n && tx.input === '0x' && BigInt(receipt.status) === 1n && tx.blockHash === receipt.blockHash && same(receipt.from,this.owner) && same(receipt.to,this.owner) && receipt.logs.length === 0,
      'Unverified cancellation');
    const header = await this.read('eth_getBlockByNumber', [receipt.blockNumber, false]);
    const finalized = await this.read('eth_getBlockByNumber', [this.policy.finalityTag, false]);
    need(header?.hash === receipt.blockHash && finalized && BigInt(finalized.number) >= BigInt(receipt.blockNumber) + BigInt(this.policy.confirmations) - 1n, 'Unconfirmed/reorged cancellation');
    await this.identity(); need(epoch === this.epoch, 'Context changed during cancellation verification');
    entry.attempts.push({ hash: txHash, nonce: tx.nonce, status: 'CANCELLED' });
    entry.status = 'CANCELLED'; entry.receiptHash = txHash; this.packets.delete(id); this.reviewed.delete(id);
    this.history.push({ kind: 'CANCELLED', id, hash: txHash }); this.save(); return true;
  }
  async adoptReplacement(id, txHash) {
    const entry = this.entry(id); need(entry.attempts.length && hash(txHash), 'No pending attempt/replacement hash');
    await this.identity(); const replacement = await this.read('eth_getTransactionByHash', [txHash]);
    const step = this.steps.find(s => s.id === id); const packet = step.packet;
    need(replacement && same(replacement.from, this.owner) && BigInt(replacement.nonce) === BigInt(packet.tx.nonce), 'Replacement belongs to different sender/nonce');
    need(BigInt(replacement.chainId) === CHAIN, 'Wrong replacement chain');
    // Only exactly same intent/fees is adoptable. Changed-fee replacements need a new reviewed plan.
    need(same(replacement.input, packet.tx.data) && same(replacement.to ?? '', packet.tx.to) && BigInt(replacement.value) === 0n &&
      BigInt(replacement.maxFeePerGas) <= BigInt(packet.tx.maxFeePerGas) && BigInt(replacement.maxPriorityFeePerGas) <= BigInt(packet.tx.maxPriorityFeePerGas), 'Changed/cancelled/over-fee replacement requires independent review');
    entry.attempts.push({ hash: txHash, replaces: entry.receiptHash, nonce: packet.tx.nonce, calldataDigest: keccak256(packet.tx.data), status: 'PENDING' });
    entry.receiptHash = txHash; entry.status = 'PENDING'; this.save(); return this.reconcile(id);
  }
}
