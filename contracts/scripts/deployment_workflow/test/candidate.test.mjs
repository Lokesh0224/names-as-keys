import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, keccak256 } from 'ethers';
import { CandidateReview } from '../candidate.mjs';
import { loadCandidateBundle } from '../candidate_bundle.mjs';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { digest } from '../workflow.mjs';
import { isT01IntentAuthorization, t01IntentDigest } from '../t01_intent.mjs';

const bundle = await loadCandidateBundle();
const { inputs, addresses, abis } = bundle;
const token = new Interface(abis.MockUSDC);
const block = { number: '0x64', timestamp: '0x6553f100', baseFeePerGas: '0x10', hash: '0x' + '11'.repeat(32) };
const txHash = '0x' + '22'.repeat(32);
const zero = '0x' + '00'.repeat(20);

function fixture() {
  const data = structuredClone(bundle);
  const calls = [];
  const listeners = new Map();
  const records = new Map();
  let nonce = data.plan.snapshot.nonce;
  let accounts = [inputs.owner];
  let chain = '0xaa36a7';
  let estimate = '0xc350';
  let mined, receipt, advance = false;
  const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const answers = {
    getSubregistry: [addresses.ETHRegistry], ETH_REGISTRY: [addresses.ETHRegistry],
    rentPriceOracle: [addresses.StandardRentPriceOracle], isAvailable: [true],
    getRegisterPrice: [8000021, 0], allowance: [0], balanceOf: [0],
  };
  const provider = {
    isMetaMask: true, testOnly: true,
    on: (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
    removeListener: (event, fn) => listeners.get(event)?.delete(fn),
    async request({ method, params = [] }) {
      calls.push({ method, params });
      await provider.hook?.(method);
      switch (method) {
        case 'eth_accounts': return accounts;
        case 'eth_chainId': return chain;
        case 'eth_getBlockByNumber':
          if (params[0] === 'latest' && advance) return { ...block, number: '0x70' };
          return params[0] === '0x70' ? { ...block, number: '0x70' } : block;
        case 'eth_getTransactionCount': return nonce;
        case 'eth_getBalance': return '0xffffffffffffffff';
        case 'eth_getCode': return params[0] === inputs.owner ? '0x' : '0x6000';
        case 'eth_estimateGas': return estimate;
        case 'eth_getTransactionReceipt': return receipt;
        case 'eth_getTransactionByHash': return mined;
        case 'eth_call': {
          const abi = Object.entries(addresses).find(([, address]) => address.toLowerCase() === params[0].to.toLowerCase())[0];
          const iface = new Interface(abis[abi]);
          const fn = iface.parseTransaction({ data: params[0].data }).fragment;
          const result = fn.name === 'balanceOf' && params[1] === block.number && receipt?.blockNumber !== block.number ? [0] : answers[fn.name];
          return iface.encodeFunctionResult(fn, result);
        }
        default: throw new Error('Unexpected wallet method: ' + method);
      }
    },
  };
  for (const key of Object.keys(data.runtimeHashes)) data.runtimeHashes[key] = keccak256('0x6000');
  return { data, provider, storage, calls, records, answers,
    now: () => Number(BigInt(block.timestamp)) * 1000,
    emit: event => listeners.get(event)?.forEach(fn => fn()),
    setChain: value => { chain = value; },
    setEstimate: value => { estimate = value; },
    setNonce: value => { nonce = value; }, setAccounts: value => { accounts = value; },
    confirm(receiptBlock = block.number) {
      advance = true;
      answers.balanceOf = [8000021];
      const estimated = calls.find(x => x.method === 'eth_estimateGas').params[0];
      mined = { ...estimated, input: estimated.data, gas: '0xea60', hash: txHash, blockHash: block.hash };
      const encoded = token.encodeEventLog(token.getEvent('Transfer'), [zero, inputs.owner, 8000021]);
      receipt = { from: inputs.owner, to: addresses.MockUSDC, transactionHash: txHash, blockHash: block.hash,
        blockNumber: receiptBlock, status: '0x1', effectiveGasPrice: '0x11', gasUsed: '0xc350',
        logs: [{ ...encoded, address: addresses.MockUSDC, logIndex: '0x0' }] };
    },
  };
}
const open = f => new CandidateReview({ provider: f.provider, bundle: f.data, storage: f.storage, now: f.now });

test('real candidate prepares only the first ready step and binds its confirmed receipt and budget', async () => {
  const f = fixture();
  const review = open(f);
  await assert.rejects(review.prepare('T02'), /prerequisite receipt/);
  assert.equal(f.calls.some(x => x.method === 'eth_estimateGas'), false);
  const first = await review.prepare('T01');
  assert.equal(first.token.units, '8000021');
  assert.equal(first.token.allowanceUnits, '0');
  assert.equal(first.estimate, '50000');
  assert.equal(first.gasLimit, '0xea60');
  assert.equal(first.execution, 'DISABLED');
  await assert.rejects(review.reconcile('T01', txHash), /pending/);
  f.confirm();
  const entry = await review.reconcile('T01', txHash);
  assert.equal(entry.status, 'CONFIRMED');
  assert.equal(entry.costWei, '850000');
  assert.equal(entry.evidence.finalizedBlockNumber, block.number);
  assert.ok(![...f.records.values()][0].includes(f.data.plan.transactions[0].candidateCalldata));
  f.setNonce('0x33');
  assert.equal((await review.prepare('T02')).token.spender, addresses.ETHRegistrar);
  review.close();
});

test('pending nonce, owner and account changes block before or invalidate exact review', async () => {
  const f = fixture();
  const review = open(f);
  f.setNonce('0x33');
  await assert.rejects(review.prepare('T01'), /nonce/);
  f.setNonce('0x32');
  f.setAccounts([inputs.mira]);
  await assert.rejects(review.prepare('T01'), /owner/);
  f.setAccounts([inputs.owner]);
  f.provider.hook = method => { if (method === 'eth_estimateGas') f.emit('chainChanged'); };
  await assert.rejects(review.prepare('T01'), /context changed/);
  delete f.provider.hook;
  await review.prepare('T01');
  f.emit('accountsChanged');
  assert.equal(review.journal().entries.T01.status, 'RECHECK_REQUIRED');
  await assert.rejects(review.reconcile('T01', txHash), /pending/);
  review.close();
});

test('T01 confirmation is exact, T01-only and read-only', async () => {
  const f = fixture();
  const candidate = open(f);
  try {
    const prepared = await candidate.prepare('T01');
    const before = f.calls.length;
    await assert.rejects(candidate.validateT01Confirmation(prepared, false), /Explicit T01/);
    await assert.rejects(candidate.validateT01Confirmation({ ...prepared, step: 'T02' }, true), /Explicit T01/);
    const modified = structuredClone(prepared);
    modified.unsignedTransaction.data += '00';
    await assert.rejects(candidate.validateT01Confirmation(modified, true), /modified/);
    assert.equal(f.calls.length, before);

    const result = await candidate.validateT01Confirmation(prepared, true);
    assert.equal(result.execution, 'DISABLED');
    assert.equal(candidate.journal().entries.T01.status, 'PREPARED');
    assert.equal(result.packetDigest, JSON.parse([...f.records.values()][0]).entries.T01.packetDigest);
    assert.equal(f.calls.filter(call => call.method === 'eth_estimateGas').length, 2);
    assert.equal(f.calls.some(call => /sign|send|requestAccounts/i.test(call.method)), false);
  } finally { candidate.close(); }
});

test('T01 confirmation rechecks wallet, nonce, quote and freshness', async () => {
  const f = fixture();
  let now = f.now();
  const candidate = new CandidateReview({ provider: f.provider, bundle: f.data, storage: f.storage, now: () => now });
  try {
    const prepared = await candidate.prepare('T01');
    f.setAccounts([inputs.mira]);
    await assert.rejects(candidate.validateT01Confirmation(prepared, true), /Selected owner and Sepolia/);
    f.setAccounts([inputs.owner]);
    f.setChain('0x1');
    await assert.rejects(candidate.validateT01Confirmation(prepared, true), /Selected owner and Sepolia/);
    f.setChain('0xaa36a7');
    f.setNonce('0x33');
    await assert.rejects(candidate.validateT01Confirmation(prepared, true), /nonce/);
    f.setNonce('0x32');
    f.answers.getRegisterPrice = [8000022, 0];
    await assert.rejects(candidate.validateT01Confirmation(prepared, true), /quote changed/);
    f.answers.getRegisterPrice = [8000021, 0];
    f.setEstimate('0xc351');
    await assert.rejects(candidate.validateT01Confirmation(prepared, true), /estimate or fee changed/);
    f.setEstimate('0xc350');
    now += (inputs.expiry.maxAgeSeconds + 1) * 1000;
    await assert.rejects(candidate.validateT01Confirmation(prepared, true), /snapshot expired/);
    assert.equal(f.calls.some(call => /sign|send|requestAccounts/i.test(call.method)), false);
  } finally { candidate.close(); }
});

// Exercise the actual guarded path with a mock provider. Only this in-memory
// test bundle has the compile-time global switched on.
async function activatedBuild(authorization = null, entry = "export * from './candidate.mjs'; export { ReadOnlyWallet } from './workflow.mjs';", sourceOnly = false) {
  const result = await build({
    stdin: { contents: entry,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent',
    plugins: [{ name: 'test-only-activation', setup(builder) {
      builder.onLoad({ filter: /[\\/]deployment_workflow[\\/]workflow\.mjs$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        assert.match(source, /export const LIVE_EXECUTION_ALLOWED = false;/);
        return { contents: source.replace('export const LIVE_EXECUTION_ALLOWED = false;', 'export const LIVE_EXECUTION_ALLOWED = true;') };
      });
      builder.onLoad({ filter: /[\\/]deployment_workflow[\\/]candidate\.mjs$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const declaration = "function consumeConfirmationClick(event, buttonId = 't01-validate') {";
        assert.ok(source.includes(declaration));
        return { contents: source.replace(declaration, declaration + "\n  if (typeof window === 'undefined') return true;") };
      });
      builder.onLoad({ filter: /t01_authorization\.mjs$/ }, () => ({
        contents: 'export const T01_AUTHORIZATION = ' + JSON.stringify(authorization),
      }));
    } }],
  });
  return sourceOnly ? result.outputFiles[0].text :
    import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

test('T01 MetaMask submission requires both gates and sends the exact envelope once', async () => {
  const f = fixture();
  const args = { provider: f.provider, bundle: f.data, storage: f.storage, now: f.now };
  const inactive = new CandidateReview(args);
  const initial = await inactive.prepare('T01');
  const { planDigest, packetDigest } = await inactive.validateT01Confirmation(initial, true);
  inactive.close();
  const authorization = { stage: 'GO', step: 'T01', planDigest, packetDigest };
  const defaultBuild = new CandidateReview({ ...args, t01Authorization: authorization });
  const defaultReview = await defaultBuild.prepare('T01');
  await assert.rejects(defaultBuild.submitT01(defaultReview, true), /execution disabled/);
  defaultBuild.close();

  const locks = { request: async (_key, options, callback) => {
    assert.equal(options.ifAvailable, true);
    return callback({});
  } };
  const { CandidateReview: UnauthorizedCandidate } = await activatedBuild();
  const unauthorized = new UnauthorizedCandidate({ ...args, locks, t01Authorization: authorization });
  const unauthorizedReview = await unauthorized.prepare('T01');
  await assert.rejects(unauthorized.submitT01(unauthorizedReview, true), /authorization missing/);
  unauthorized.close();

  const { CandidateReview: WrongPacketCandidate } = await activatedBuild({ ...authorization, packetDigest: txHash });
  const wrongPacket = new WrongPacketCandidate({ ...args, locks });
  const wrongPacketReview = await wrongPacket.prepare('T01');
  await assert.rejects(wrongPacket.submitT01(wrongPacketReview, true), /authorization missing/);
  wrongPacket.close();

  const { CandidateReview: ActiveCandidate, ReadOnlyWallet } = await activatedBuild(authorization);
  const active = new ActiveCandidate({ ...args, locks });
  const review = await active.prepare('T01');
  await assert.rejects(active.submitT01(review, false), /Explicit T01 confirmation/);
  const adapter = new ReadOnlyWallet(f.provider);
  assert.equal(adapter.provider, undefined);
  await assert.rejects(adapter.submitReviewed(review.unsignedTransaction, authorization), /disabled/);
  const t02 = { ...review.unsignedTransaction, data: bundle.plan.transactions[1].candidateCalldata };
  const fabricated = { stage: 'GO', step: 'T01', planDigest: txHash, packetDigest: txHash, transactionDigest: digest(t02) };
  await assert.rejects(adapter.submitReviewed(t02, fabricated), /disabled/);
  for (const step of bundle.plan.transactions.slice(1)) {
    await assert.rejects(active.submitT01({ ...review, step: step.id }, true), /authorization missing/);
  }
  const altered = structuredClone(review);
  altered.unsignedTransaction.gas = '0x1';
  await assert.rejects(active.submitT01(altered, true), /authorization missing/);
  f.setAccounts([inputs.mira]);
  await assert.rejects(active.submitT01(review, true), /Selected owner and Sepolia/);
  f.setAccounts([inputs.owner]);
  f.setChain('0x1');
  await assert.rejects(active.submitT01(review, true), /Selected owner and Sepolia/);
  f.setChain('0xaa36a7');
  f.setNonce('0x33');
  await assert.rejects(active.submitT01(review, true), /nonce/);
  f.setNonce('0x32');
  const request = f.provider.request.bind(f.provider);
  let sends = 0;
  f.provider.request = async input => {
    if (input.method !== 'eth_sendTransaction') return request(input);
    sends++;
    const lock = [...f.records].find(([key]) => key.startsWith('nak-t01-attempt:'));
    assert.deepEqual(JSON.parse(lock[1]), { nonce: review.nonce, planDigest, packetDigest,
      transactionDigest: digest(review.unsignedTransaction), status: 'REQUESTING' });
    assert.deepEqual(input.params, [review.unsignedTransaction]);
    return txHash;
  };
  assert.equal(await active.submitT01(review, true), txHash);
  assert.equal(active.journal().entries.T01.status, 'PENDING');
  await assert.rejects(active.submitT01(review, true), /execution disabled/);
  await assert.rejects(active.reconcile('T01', txHash), /Receipt pending/);
  await assert.rejects(active.reconcile('T01', '0x' + '33'.repeat(32)), /possible replacement/);
  f.setNonce('0x33');
  await assert.rejects(active.reconcile('T01', txHash), /possible replacement/);
  f.confirm();
  assert.equal((await active.reconcile('T01', txHash)).status, 'CONFIRMED');
  assert.equal(sends, 1);
  active.close();

  const reload = new ActiveCandidate({ ...args, locks });
  await assert.rejects(reload.prepare('T01'), /Prior T01 attempt/);
  reload.close();
});

test('MetaMask rejection, uncertain replies and persistence failure never auto-retry', async () => {
  for (const outcome of ['reject', 'invalid hash', 'storage failure', 'missing lock', 'forged lock']) {
    const f = fixture();
    const args = { provider: f.provider, bundle: f.data, storage: f.storage, now: f.now };
    const draft = new CandidateReview(args);
    const initial = await draft.prepare('T01');
    const { planDigest, packetDigest } = await draft.validateT01Confirmation(initial, true);
    draft.close();
    const { CandidateReview: ActiveCandidate } = await activatedBuild({ stage: 'GO', step: 'T01', planDigest, packetDigest });
    const active = new ActiveCandidate({ ...args, locks: { request: (_key, _options, callback) => callback({}) } });
    const review = await active.prepare('T01');
    const request = f.provider.request.bind(f.provider);
    let sends = 0;
    f.provider.request = async input => {
      if (input.method !== 'eth_sendTransaction') return request(input);
      sends++;
      if (outcome === 'reject') throw Object.assign(new Error('rejected'), { code: 4001 });
      return 'invalid';
    };
    if (outcome === 'storage failure') f.storage.setItem = () => { throw new Error('Storage unavailable'); };
    if (outcome.endsWith('lock')) {
      const write = f.storage.setItem;
      f.storage.setItem = (key, value) => {
        if (key.startsWith('nak-t01-attempt:') && JSON.parse(value).status === 'REQUESTING') {
          if (outcome === 'forged lock') write(key, JSON.stringify({ ...JSON.parse(value), transactionDigest: txHash }));
        } else write(key, value);
      };
    }
    await assert.rejects(active.submitT01(review, true), /rejected|uncertain|Storage unavailable/);
    if (outcome !== 'storage failure') {
      assert.equal(active.journal().entries.T01.status, outcome === 'reject' ? 'REJECTED' : 'UNCERTAIN');
      await assert.rejects(active.submitT01(review, true), /execution disabled/);
    }
    assert.equal(sends, ['reject', 'invalid hash'].includes(outcome) ? 1 : 0);
    active.close();
  }
});

test('fabricated browser confirmation cannot reach the activated T01 wallet transport', async () => {
  const f = fixture();
  const draft = open(f);
  const review = await draft.prepare('T01');
  const { planDigest, packetDigest } = await draft.validateT01Confirmation(review, true);
  draft.close();
  f.records.clear();

  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { value: id === 'step' ? 'T01' : '', append() {} });
    return nodes.get(id);
  };
  const backup = Object.fromEntries(['document', 'window', 'fetch', 'localStorage', 'navigator']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const request = f.provider.request.bind(f.provider);
  let sends = 0;
  f.provider.request = async args => {
    if (args.method === 'eth_sendTransaction') {
      sends++;
      return txHash;
    }
    const response = await request(args);
    return args.method === 'eth_getBlockByNumber'
      ? { ...response, timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) }
      : response;
  };
  try {
    Object.assign(globalThis, {
      document: { getElementById: element, createElement: () => ({}) },
      window: { ethereum: f.provider, addEventListener() {} },
      fetch: async () => ({ ok: true, json: async () => f.data }),
      localStorage: f.storage,
    });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      locks: { request: (_key, _options, callback) => callback({}) },
    } });
    await activatedBuild({ stage: 'GO', step: 'T01', planDigest, packetDigest }, "import './browser.mjs';");
    await new Promise(resolve => setImmediate(resolve));
    await element('prepare').onclick();
    const button = element('t01-validate');
    assert.equal(button.textContent, 'Request T01 in MetaMask');

    for (const event of [{ isTrusted: true }, new Event('click')]) {
      element('t01-confirmed').checked = true;
      element('t01-confirmed').onchange();
      await button.onclick(event);
      assert.equal(sends, 0);
      assert.match(element('status').textContent, /Use the T01 confirmation button directly/);
      assert.equal([...f.records.keys()].some(key => key.startsWith('nak-t01-attempt:')), false);
    }
  } finally {
    for (const [key, descriptor] of Object.entries(backup)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('real browser entry uses existing account access and exposes only unsigned read actions', async () => {
  const f = fixture();
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { value: id === 'step' ? 'T01' : '', append() {} });
    return nodes.get(id);
  };
  const backup = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  Object.assign(globalThis, {
    document: { getElementById: element, createElement: () => ({}) },
    window: { ethereum: f.provider, addEventListener() {} },
    fetch: async () => ({ ok: true, json: async () => f.data }),
    localStorage: f.storage,
  });
  // Browser real clock is used. Return a fresh timestamp from the provider.
  f.provider.hook = () => {};
  const request = f.provider.request.bind(f.provider);
  f.provider.request = async args => {
    const response = await request(args);
    return args.method === 'eth_getBlockByNumber' ? { ...response, timestamp: '0x' + Math.floor(Date.now()/1000).toString(16) } : response;
  };
  try {
    await import('../browser.mjs');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 0);
    await element('prepare').onclick();
    assert.match(element('review').textContent, /UNSIGNED_CANDIDATE/);
    assert.equal(element('t01-validate').disabled, true);
    element('t01-confirmed').checked = true;
    element('t01-confirmed').onchange();
    assert.equal(element('t01-validate').disabled, false);
    await element('t01-validate').onclick();
    assert.match(element('status').textContent, /Separate execution authorization required/);
    assert.equal(element('t01-confirmed').checked, false);
    f.emit('chainChanged');
    assert.match(element('review').textContent, /context changed/);
    await element('receipt').onclick();
    assert.equal(f.calls.some(x => /sign|send|requestAccounts|switchEthereumChain/i.test(x.method)), false);
  } finally {
    Object.assign(globalThis, backup);
  }
});

test('reload validates an unsigned public anchor and creates a fresh review', async () => {
  const f = fixture();
  const first = open(f);
  const original = await first.prepare('T01');
  first.close();
  const reloaded = open(f);
  assert.deepEqual(await reloaded.prepare('T01'), original);
  assert.equal(f.calls.filter(call => call.method === 'eth_estimateGas').length, 2);
  reloaded.close();
});

test('reload reconciles a public receipt and rechecks it before the dependent step', async () => {
  const f = fixture();
  const first = open(f);
  await first.prepare('T01');
  f.confirm('0x65');
  // Provide the distinct receipt block and enough confirmation depth.
  const request = f.provider.request.bind(f.provider);
  f.provider.request = async args => {
    const response = await request(args);
    if (args.method === 'eth_getBlockByNumber') {
      if (args.params[0] === '0x65' || args.params[0] === 'finalized') return { ...block, number: '0x65' };
      if (args.params[0] === 'latest' || args.params[0] === '0x72') return { ...block, number: '0x72' };
    }
    if (args.method === 'eth_getTransactionCount' && args.params[1] !== block.number) return '0x33';
    return response;
  };
  first.close();
  const reloaded = open(f);
  assert.equal((await reloaded.reconcile('T01', txHash)).status, 'CONFIRMED');
  const later = await reloaded.prepare('T02');
  assert.equal(later.step, 'T02');
  reloaded.close();
});

test('reload rejects tampered digest, header and estimate before producing a public review', async () => {
  for (const tamper of [
    e => { e.packetDigest = '0x' + '77'.repeat(32); },
    e => { e.anchor.hash = '0x' + '77'.repeat(32); },
    e => { e.anchor.estimate = '51000'; },
  ]) {
    const f = fixture();
    const first = open(f);
    await first.prepare('T01');
    first.close();
    const [key, text] = [...f.records.entries()][0];
    const saved = JSON.parse(text);
    tamper(saved.entries.T01);
    f.records.set(key, JSON.stringify(saved));
    const reloaded = open(f);
    await assert.rejects(reloaded.prepare('T01'), /digest mismatch|no longer canonical/);
    assert.equal(f.calls.filter(call => call.method === 'eth_estimateGas').length, 1);
    reloaded.close();
  }
});

test('a lost registration record blocks a new commitment across candidate keys without verified expiry', async () => {
  const f = fixture();
  // The prerequisite prefix is empty in this test fixture. Registration guards
  // must still stop before generating or estimating a new commitment.
  f.data.plan.transactions[0].conditionallyIncluded = false;
  f.data.plan.transactions[1].conditionallyIncluded = false;
  const key = 'nak-registration:' + inputs.owner.toLowerCase() + ':' + inputs.root;
  f.records.set(key, JSON.stringify({ planDigest: '0x' + '77'.repeat(32), commitment: '0x' + '88'.repeat(32) }));
  const reloaded = open(f);
  await assert.rejects(reloaded.prepare('T03'), /preimage lost.*expiry/);
  assert.equal(f.calls.some(call => call.method === 'eth_estimateGas'), false);
  reloaded.close();
});

test('generic T02 runner binds exact approval, rechecks T01 and recovers a reverted request', async t => {
  const f = fixture();
  const draft = open(f);
  await assert.rejects(draft.prepare('T15'), /Verified prerequisite receipt required: T01/);
  await draft.prepare('T01');
  f.confirm('0x65');
  const initialRequest = f.provider.request.bind(f.provider);
  f.provider.request = async input => input.method === 'eth_getBlockByNumber' &&
    ['0x65', 'finalized'].includes(input.params[0]) ? { ...block, number: '0x65' } : initialRequest(input);
  await draft.reconcile('T01', txHash);
  f.setNonce('0x33');
  const unsigned = await draft.prepare('T02');
  const { planDigest, packetDigest } = await draft.validateConfirmation(unsigned, true);
  draft.close();

  const originalRequest = f.provider.request.bind(f.provider);
  f.provider.request = async input => input.method === 'eth_getTransactionCount' && input.params[1] === block.number
    ? '0x32' : originalRequest(input);

  const auth = { stage: 'GO', step: 'T02', planDigest, packetDigest };
  let served = { ...auth, planDigest: txHash };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async path => {
    assert.equal(path, '/step-authorization.json');
    return { ok: true, json: async () => served };
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { CandidateReview: ActiveCandidate } = await activatedBuild();
  const args = { provider: f.provider, bundle: f.data, storage: f.storage, now: f.now,
    locks: { request: (_key, _options, callback) => callback({}) } };
  const active = new ActiveCandidate(args);
  const review = await active.prepare('T02');
  await active.refreshAuthorization();
  await assert.rejects(active.submitStep(review, true), /authorization missing/);
  served = { ...auth, step: 'T03' };
  await active.refreshAuthorization();
  assert.equal(active.canSubmit(review), false);
  served = { ...auth, packetDigest: txHash };
  await active.refreshAuthorization();
  assert.equal(active.canSubmit(review), false);
  served = auth;
  await active.refreshAuthorization();
  assert.equal(active.canSubmit(review), true);

  const nextHash = '0x' + '34'.repeat(32);
  let sends = 0, priorMissing = false, reverted = false;
  const request = f.provider.request.bind(f.provider);
  f.provider.request = async input => {
    const { method, params } = input;
    if (method === 'eth_sendTransaction') {
      sends++;
      assert.deepEqual(params, [review.unsignedTransaction]);
      const attempt = [...f.records].find(([key]) => key.startsWith('nak-t02-attempt:'));
      assert.equal(JSON.parse(attempt[1]).status, 'REQUESTING');
      return nextHash;
    }
    if (method === 'eth_getTransactionReceipt' && params[0] === txHash && priorMissing) return null;
    if (params?.[0] === nextHash) {
      if (method === 'eth_getTransactionReceipt') return reverted ? {
        status: '0x0', transactionHash: nextHash, blockNumber: '0x70', blockHash: block.hash,
        from: inputs.owner, to: addresses.MockUSDC,
      } : null;
      if (method === 'eth_getTransactionByHash') return {
        ...review.unsignedTransaction, hash: nextHash, blockHash: block.hash, input: review.unsignedTransaction.data,
      };
    }
    return request(input);
  };

  globalThis.window = {};
  try {
    for (const event of [{ isTrusted: true }, new Event('click')]) {
      await assert.rejects(active.submitStep(review, true, event), /Use the T02 confirmation button directly/);
    }
  } finally { delete globalThis.window; }
  served = null;
  await assert.rejects(active.submitStep(review, true), /authorization missing/);
  served = auth;
  await active.refreshAuthorization();
  priorMissing = true;
  await assert.rejects(active.submitStep(review, true), /Receipt pending/);
  priorMissing = false;
  assert.equal(sends, 0);
  const conflictingKey = 'nak-t03-attempt:11155111:' + inputs.owner.toLowerCase();
  f.records.set(conflictingKey, JSON.stringify({ nonce: review.nonce, status: 'UNCERTAIN' }));
  await assert.rejects(active.submitStep(review, true), /Owner nonce already has a durable attempt for T03/);
  f.records.delete(conflictingKey);
  assert.equal(await active.submitStep(review, true), nextHash);
  assert.equal(active.journal().entries.T02.status, 'PENDING');
  active.close();

  // A reload must recover the hash even if only the attempt record was written.
  const journalKey = 'nak-candidate:' + planDigest;
  const interrupted = JSON.parse(f.records.get(journalKey));
  delete interrupted.entries.T02.receiptHash;
  interrupted.entries.T02.status = 'REQUESTING';
  f.records.set(journalKey, JSON.stringify(interrupted));
  const reload = new ActiveCandidate(args);
  assert.equal(reload.journal().entries.T02.receiptHash, nextHash);
  await assert.rejects(reload.prepare('T02'), /Prior T02 attempt/);
  await assert.rejects(reload.prepare('T03'), /Receipt pending/);
  reverted = true;
  await assert.rejects(reload.reconcile('T02'), /T02 reverted/);
  assert.equal(reload.journal().entries.T02.status, 'REVERTED');
  await assert.rejects(reload.prepare('T03'), /T02 reverted/);
  assert.equal(sends, 1);
  reload.close();
});

test('T04 privacy block applies even in the activated wallet build', async t => {
  const f = fixture();
  const { CandidateReview: ActiveCandidate } = await activatedBuild();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({
    stage: 'GO', step: 'T04', planDigest: digest(f.data), packetDigest: txHash,
  }) });
  t.after(() => { globalThis.fetch = originalFetch; });
  const active = new ActiveCandidate({ provider: f.provider, bundle: f.data, storage: f.storage, now: f.now });
  t.after(() => active.close());
  await active.refreshAuthorization();
  assert.equal(active.canSubmit({ step: 'T04' }), false);
  await assert.rejects(active.submitStep({ step: 'T04' }, true), /T04 execution blocked.*reveal boundary/);
  assert.deepEqual(f.calls, []);
  assert.equal(f.records.size, 0);
});

test('T01 intent retains every fixed transaction field and fee policy across observation changes', () => {
  const { data } = fixture();
  const step = data.plan.transactions[0];
  const packet = { tx: { from: inputs.owner, to: step.candidateDestination, chainId: '0xaa36a7',
    data: step.candidateCalldata, value: '0x0', nonce: '0x32', gas: '0x100', maxFeePerGas: '0x10',
    maxPriorityFeePerGas: '0x1' }, arguments: step.candidateArguments };
  const approved = t01IntentDigest(data, packet);
  const refreshed = structuredClone(data);
  refreshed.plan.snapshot.hash = txHash;
  refreshed.plan.snapshot.number = '0x65';
  refreshed.observation.blockHash = txHash;
  refreshed.observation.reviewContext = { latest: { hash: txHash }, observedAtSeconds: 20 };
  assert.notEqual(digest(refreshed), digest(data));
  assert.equal(t01IntentDigest(refreshed, { ...packet,
    tx: { ...packet.tx, gas: '0x120', maxFeePerGas: '0x20' } }), approved);
  for (const field of ['from', 'to', 'chainId', 'data', 'value', 'nonce', 'maxPriorityFeePerGas']) {
    assert.notEqual(t01IntentDigest(data, { ...packet, tx: { ...packet.tx, [field]: '0x99' } }), approved, field);
  }
  for (const field of ['maxFeePerGasWei', 'maxPriorityFeePerGasWei', 'maxGasPerStep',
    'maxTotalWei', 'gasLimitMultiplierPercent']) {
    const changed = structuredClone(data);
    changed.inputs.fees[field] = '999';
    assert.notEqual(t01IntentDigest(changed, packet), approved, field);
  }
  const changed = structuredClone(data);
  changed.plan.snapshot.nonce = '0x33';
  assert.notEqual(t01IntentDigest(changed, packet), approved);
  changed.plan.snapshot.nonce = data.plan.snapshot.nonce;
  changed.plan.transactions[1].candidateCalldata = '0xab';
  assert.notEqual(t01IntentDigest(changed, packet), approved);
  const auth = { stage: 'GO', step: 'T01', kind: 'T01_INTENT_V1', intentDigest: approved };
  assert.equal(isT01IntentAuthorization(auth), true);
  assert.equal(isT01IntentAuthorization({ ...auth, step: 'T02' }), false);
});

test('durable T01 intent requires fresh local confirmation and permits one request after observation refresh', async t => {
  const f = fixture();
  const draft = open(f);
  const initial = await draft.prepare('T01');
  const approved = await draft.validateT01Confirmation(initial, true);
  draft.close();

  const auth = { stage: 'GO', step: 'T01', kind: 'T01_INTENT_V1', intentDigest: approved.intentDigest };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => auth });
  t.after(() => { globalThis.fetch = originalFetch; });
  const { CandidateReview: ActiveCandidate } = await activatedBuild();
  f.data.plan.snapshot.hash = txHash;
  f.data.observation.blockHash = txHash;

  let head = { ...block, baseFeePerGas: '0x11' };
  let sends = 0;
  const request = f.provider.request.bind(f.provider);
  f.provider.request = async input => {
    if (input.method === 'eth_getBlockByNumber') {
      return input.params[0] === 'latest' || input.params[0] === head.number ? head : block;
    }
    if (input.method === 'eth_sendTransaction') {
      sends++;
      assert.deepEqual(input.params[0], review.unsignedTransaction);
      return txHash;
    }
    return request(input);
  };
  let now = f.now();
  const args = { provider: f.provider, bundle: f.data, storage: f.storage, now: () => now,
    locks: { request: (_key, _options, callback) => callback({}) } };
  const active = new ActiveCandidate(args);
  t.after(() => active.close());
  await active.refreshAuthorization();
  const review = await active.prepare('T01');
  const savedReview = active.journal().entries.T01;
  const originalHead = head;
  const advanceHead = number => {
    now += 121_000;
    head = { ...head, number, hash: txHash, timestamp: '0x' + (now / 1000).toString(16) };
  };
  // Keep the original recovery anchor available while moving both freshness limits.
  const readHead = f.provider.request;
  f.provider.request = input => input.method === 'eth_getBlockByNumber' && input.params[0] === originalHead.number
    ? Promise.resolve(originalHead) : readHead(input);
  advanceHead('0x67');
  head.baseFeePerGas = '0x12';
  assert.equal(active.canSubmit(review), false);
  f.answers.allowance = [1];
  await assert.rejects(active.validateT01Confirmation(review, true), /state, estimate or fee changed/);
  assert.equal(active.canSubmit(review), false);
  f.answers.allowance = [0];
  const refreshed = await active.validateT01Confirmation(review, true);
  const simulation = f.calls.filter(call => call.method === 'eth_estimateGas').at(-1);
  assert.deepEqual(simulation.params, [review.unsignedTransaction, '0x67']);
  assert.equal(review.unsignedTransaction.maxFeePerGas, '0x23');
  assert.notEqual(refreshed.planDigest, approved.planDigest);
  assert.notEqual(refreshed.packetDigest, approved.packetDigest);
  assert.equal(refreshed.intentDigest, approved.intentDigest);
  assert.deepEqual(active.journal().entries.T01, savedReview);
  assert.equal(active.canSubmit(review), true);
  head.baseFeePerGas = '0x22';
  assert.equal((await active.validateT01Confirmation(review, true)).packetDigest, refreshed.packetDigest);
  head.baseFeePerGas = '0x23';
  await assert.rejects(active.validateT01Confirmation(review, true), /Base fee moved outside reviewed envelope/);
  assert.equal(active.canSubmit(review), false);
  head.baseFeePerGas = '0x22';
  await active.validateT01Confirmation(review, true);

  for (const [change, restore, error] of [
    [() => f.setAccounts([inputs.mira]), () => f.setAccounts([inputs.owner]), /Selected owner and Sepolia/],
    [() => f.setChain('0x1'), () => f.setChain('0xaa36a7'), /Selected owner and Sepolia/],
    [() => f.setNonce('0x33'), () => f.setNonce('0x32'), /nonce/],
    [() => f.setEstimate('0xc351'), () => f.setEstimate('0xc350'), /state, estimate or fee changed/],
    [() => { head.baseFeePerGas = '0x23'; }, () => { head.baseFeePerGas = '0x22'; }, /Base fee moved outside reviewed envelope/],
    [() => { f.answers.allowance = [1]; }, () => { f.answers.allowance = [0]; }, /state, estimate or fee changed/],
  ]) {
    change();
    await assert.rejects(active.submitT01(review, true), error);
    assert.equal(active.canSubmit(review), false);
    assert.equal([...f.records.keys()].some(key => key.startsWith('nak-t01-attempt:')), false);
    restore();
    await active.validateT01Confirmation(review, true);
  }
  const modified = structuredClone(review);
  modified.unsignedTransaction.data += '00';
  await assert.rejects(active.validateT01Confirmation(modified, true), /review was modified/);
  modified.unsignedTransaction = { ...review.unsignedTransaction, maxFeePerGas: '0x25' };
  await assert.rejects(active.validateT01Confirmation(modified, true), /review was modified/);
  assert.equal(sends, 0);

  const beforeSendReload = new ActiveCandidate(args);
  t.after(() => beforeSendReload.close());
  await beforeSendReload.refreshAuthorization();
  assert.equal(beforeSendReload.canSubmit(review), false);
  await active.validateT01Confirmation(review, true);
  advanceHead('0x6a');
  assert.equal(active.canSubmit(review), true);
  const submission = active.submitT01(review, true);
  await assert.rejects(active.submitT01(review, true), /Review already in progress/);
  assert.equal(await submission, txHash);
  await assert.rejects(active.submitT01(review, true), /execution disabled/);
  const reload = new ActiveCandidate(args);
  t.after(() => reload.close());
  await assert.rejects(reload.prepare('T01'), /Prior T01 attempt/);
  assert.equal(sends, 1);
});

for (const { change, expectedError } of [
  { change: 'head advances', expectedError: /Review snapshot expired/ },
  { change: 'anchor reorgs', expectedError: /Review block lost canonicality/ },
  { change: 'time expires during nonce reads', expectedError: /Review snapshot expired/ },
  { change: 'head advances during recovery anchor read', expectedError: /Review snapshot expired/ },
  { change: 'base fee rises during wallet reads', expectedError: /Base fee moved outside reviewed envelope/ },
  { change: 'base fee rises during nonce reads', expectedError: /Base fee moved outside reviewed envelope/ },
  { change: 'base fee rises during final canonical lookup', expectedError: /Head changed during final verification/ },
]) {
  test('T01 blocks wallet handoff when ' + change + ' at final verification', async t => {
    const f = fixture();
    const draft = open(f);
    const initial = await draft.prepare('T01');
    const { intentDigest } = await draft.validateT01Confirmation(initial, true);
    draft.close();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      stage: 'GO', step: 'T01', kind: 'T01_INTENT_V1', intentDigest,
    }) });
    t.after(() => { globalThis.fetch = originalFetch; });
    const { CandidateReview: ActiveCandidate } = await activatedBuild();
    let now = f.now();
    const active = new ActiveCandidate({ provider: f.provider, bundle: f.data, storage: f.storage, now: () => now,
      locks: { request: (_key, _options, callback) => callback({}) } });
    t.after(() => active.close());
    await active.refreshAuthorization();
    const review = await active.prepare('T01');
    await active.validateT01Confirmation(review, true);
    assert.equal(review.snapshot.number, '0x64');
    assert.equal(active.canSubmit(review), true);

    let head = '0x66', anchorHash = block.hash, accountReads = 0, nonceReads = 0, sends = 0;
    let canonicalReads = 0;
    let latestBaseFee = block.baseFeePerGas;
    const request = f.provider.request.bind(f.provider);
    f.provider.request = async input => {
      if (input.method === 'eth_getBlockByNumber') {
        if (input.params[0] === 'latest') return { ...block, number: head, baseFeePerGas: latestBaseFee };
        if (input.params[0] === '0x66') {
          if (++canonicalReads === 2 && change === 'base fee rises during final canonical lookup') {
            await Promise.resolve();
            head = '0x67';
            latestBaseFee = '0x21';
          }
          return { ...block, number: '0x66', hash: anchorHash };
        }
        if (input.params[0] === block.number && change === 'head advances during recovery anchor read') {
          await Promise.resolve();
          head = '0x69';
        }
      }
      if (input.method === 'eth_accounts' && ++accountReads === 2) {
        await Promise.resolve();
        if (change === 'head advances') head = '0x69';
        if (change === 'anchor reorgs') anchorHash = txHash;
        if (change === 'base fee rises during wallet reads') {
          head = '0x67';
          latestBaseFee = '0x21';
        }
      }
      if (input.method === 'eth_getTransactionCount' && ++nonceReads === 8) {
        await Promise.resolve();
        if (change === 'time expires during nonce reads') now += 121_000;
        if (change === 'base fee rises during nonce reads') {
          head = '0x67';
          latestBaseFee = '0x21';
        }
      }
      if (input.method === 'eth_sendTransaction') {
        sends++;
        return txHash;
      }
      return request(input);
    };
    await assert.rejects(active.submitT01(review, true), expectedError);
    assert.equal(accountReads, 2);
    assert.equal(sends, 0);
    assert.equal(active.journal().entries.T01.status, 'PREPARED');
    assert.equal([...f.records.keys()].some(key => key.startsWith('nak-t01-attempt:')), false);
  });
}

const recoveryAttestation = { walletActivityChecked: true, noKnownTransaction: true, knownHashes: [] };

async function recoveryFixture(t) {
  const f = fixture();
  const draft = open(f);
  const reviewed = await draft.prepare('T01');
  const approval = await draft.validateT01Confirmation(reviewed, true);
  draft.close();
  const attemptKey = 'nak-t01-attempt:11155111:' + inputs.owner.toLowerCase();
  const journalKey = 'nak-candidate:' + approval.planDigest;
  const journal = JSON.parse(f.records.get(journalKey));
  const rejected = { nonce: reviewed.nonce, planDigest: approval.planDigest, packetDigest: approval.packetDigest,
    transactionDigest: digest(reviewed.unsignedTransaction), status: 'REJECTED' };
  journal.entries.T01.status = 'REJECTED';
  journal.history.push({ kind: 'AVAILABLE_PRIOR_AUDIT', step: 'T01' });
  f.records.set(attemptKey, JSON.stringify(rejected));
  f.records.set(journalKey, JSON.stringify(journal));
  const originalFetch = globalThis.fetch;
  let auth = { stage: 'GO', step: 'T01', kind: 'T01_INTENT_V1', intentDigest: approval.intentDigest };
  globalThis.fetch = async () => ({ ok: true, json: async () => auth });
  t.after(() => { globalThis.fetch = originalFetch; });
  const { CandidateReview: Active } = await activatedBuild();
  let held = false;
  const locks = { async request(_key, _options, callback) {
    if (held) return callback(null);
    held = true;
    try { return await callback({}); } finally { held = false; }
  } };
  const args = { provider: f.provider, bundle: f.data, storage: f.storage, now: f.now, locks };
  const candidate = new Active(args);
  t.after(() => candidate.close());
  await candidate.refreshAuthorization();
  return { ...f, candidate, Active, args, attemptKey, journalKey, rejected, journal,
    intentDigest: approval.intentDigest,
    recoveryKey: attemptKey + ':recovery', retryKey: attemptKey + ':retry',
    setAuthorization: value => { auth = value; } };
}

test('hashless T01 recovery preserves the original and audits a distinct single-use retry through receipt recovery', async t => {
  const f = await recoveryFixture(t);
  const original = f.records.get(f.attemptKey);
  await assert.rejects(f.candidate.prepare('T01'), /Prior T01 attempt/);
  const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
  assert.equal(review.rejectedAttemptDigest, digest(f.rejected));
  assert.deepEqual(review.originalJournal, f.journal);
  assert.equal(review.evidence.latestNonce, '0x32');
  assert.equal(review.evidence.pendingNonce, '0x32');
  assert.equal(review.evidence.token.balanceUnits, '0');
  assert.equal(review.evidence.token.quoteUnits, '8000021');
  assert.equal(f.records.has(f.recoveryKey), false);
  assert.equal(f.calls.some(x => /send|sign|requestAccounts/i.test(x.method)), false);
  await f.candidate.approveT01Recovery(review, true);
  const recovery = f.records.get(f.recoveryKey);
  assert.equal(f.records.get(f.attemptKey), original);
  assert.equal(f.records.has(f.retryKey), false);
  await assert.rejects(f.candidate.approveT01Recovery(review, true), /Recovery review missing/);
  const retryReview = await f.candidate.prepare('T01');
  await f.candidate.validateT01Confirmation(retryReview, true);
  let sends = 0;
  const request = f.provider.request.bind(f.provider);
  f.provider.request = async input => {
    assert.doesNotMatch(input.method, /sign|requestAccounts/i);
    if (input.method !== 'eth_sendTransaction') return request(input);
    sends++;
    assert.deepEqual(input.params, [retryReview.unsignedTransaction]);
    assert.equal(f.records.get(f.attemptKey), original);
    assert.equal(f.records.get(f.recoveryKey), recovery);
    const retry = JSON.parse(f.records.get(f.retryKey));
    assert.equal(retry.status, 'REQUESTING');
    assert.equal(retry.parentAttemptDigest, digest(f.rejected));
    assert.equal(retry.recoveryDigest, review.recoveryDigest);
    assert.ok(hashValue(retry.attemptId));
    return txHash;
  };
  assert.equal(await f.candidate.submitT01(retryReview, true), txHash);
  await assert.rejects(f.candidate.submitT01(retryReview, true), /execution disabled/);
  const reload = new f.Active(f.args);
  t.after(() => reload.close());
  await assert.rejects(reload.prepare('T01'), /Prior T01 attempt/);
  // Exercise receipt recovery after the retry attempt persisted but its journal hash did not.
  const interrupted = JSON.parse(f.records.get(f.journalKey));
  delete interrupted.entries.T01.receiptHash;
  interrupted.entries.T01.status = 'REQUESTING';
  f.records.set(f.journalKey, JSON.stringify(interrupted));
  const receiptRecovery = new f.Active(f.args);
  t.after(() => receiptRecovery.close());
  f.confirm('0x65');
  const receiptRequest = f.provider.request.bind(f.provider);
  f.provider.request = input => {
    if (input.method === 'eth_getBlockByNumber' && ['0x65', 'finalized'].includes(input.params[0])) {
      return Promise.resolve({ ...block, number: input.params[0] === 'finalized' ? '0x70' : '0x65' });
    }
    return receiptRequest(input);
  };
  assert.equal((await receiptRecovery.reconcile('T01')).status, 'CONFIRMED');
  assert.equal(JSON.parse(f.records.get(f.retryKey)).status, 'CONFIRMED');
  assert.equal(f.records.get(f.attemptKey), original);
  assert.equal(f.records.get(f.recoveryKey), recovery);
  const history = JSON.parse(f.records.get(f.journalKey)).history;
  assert.ok(history.some(x => x.kind === 'AVAILABLE_PRIOR_AUDIT'));
  assert.ok(history.some(x => x.kind === 'T01_RECOVERY_APPROVED'));
  assert.ok(history.some(x => x.kind === 'T01_RETRY_CONFIRMED'));
  assert.equal(sends, 1);
});

function hashValue(value) { return /^0x[\da-f]{64}$/.test(value); }

for (const state of ['REQUESTING', 'UNCERTAIN', 'PENDING', 'REVERTED']) {
  test('T01 recovery refuses ' + state + ' without inventing rejection evidence', async t => {
    const f = await recoveryFixture(t);
    f.records.set(f.attemptKey, JSON.stringify({ ...f.rejected, status: state }));
    await assert.rejects(f.candidate.inspectT01Recovery(recoveryAttestation), /Explicit hashless/);
    assert.equal(f.records.has(f.recoveryKey), false);
  });
}

test('T01 recovery rejects missing, conflicting and altered records or owner evidence', async t => {
  const f = await recoveryFixture(t);
  for (const attestation of [undefined, {}, { ...recoveryAttestation, walletActivityChecked: false },
    { ...recoveryAttestation, noKnownTransaction: false }, { ...recoveryAttestation, knownHashes: [txHash] }]) {
    await assert.rejects(f.candidate.inspectT01Recovery(attestation), /Owner wallet inspection/);
  }
  f.records.set(f.attemptKey, JSON.stringify({ ...f.rejected, hash: txHash }));
  await assert.rejects(f.candidate.inspectT01Recovery(recoveryAttestation), /Explicit hashless/);
  f.records.set(f.attemptKey, JSON.stringify({ ...f.rejected, transactionDigest: txHash }));
  await assert.rejects(f.candidate.inspectT01Recovery(recoveryAttestation), /transaction binding/);
  f.records.set(f.attemptKey, JSON.stringify(f.rejected));
  const alteredJournal = structuredClone(f.journal);
  alteredJournal.entries.T01.receiptHash = txHash;
  f.records.set(f.journalKey, JSON.stringify(alteredJournal));
  await assert.rejects(f.candidate.inspectT01Recovery(recoveryAttestation), /Explicit hashless/);
  assert.equal(f.records.has(f.recoveryKey), false);
});

test('other-step attempt evidence blocks T01 recovery before approval', async t => {
  const f = await recoveryFixture(t);
  const key = f.attemptKey.replace('t01', 't02');
  f.records.set(key, JSON.stringify({ nonce: '0x32', status: 'UNCERTAIN', hash: txHash }));
  await assert.rejects(f.candidate.inspectT01Recovery(recoveryAttestation), /Conflicting attempt/);
  f.records.delete(key);
  const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
  f.records.set(key, JSON.stringify({ nonce: '0x32', status: 'PENDING', hash: txHash }));
  await assert.rejects(f.candidate.approveT01Recovery(review, true), /Conflicting attempt/);
  assert.equal(f.records.has(f.recoveryKey), false);
});

test('T01 recovery approval requires the exact review and explicit dedicated trusted click', async t => {
  const f = await recoveryFixture(t);
  let review = await f.candidate.inspectT01Recovery(recoveryAttestation);
  await assert.rejects(f.candidate.approveT01Recovery(review, false), /Explicit owner recovery/);
  const altered = structuredClone(review);
  altered.evidence.token.balanceUnits = '1';
  await assert.rejects(f.candidate.approveT01Recovery(altered, true), /Recovery review missing/);
  review = await f.candidate.inspectT01Recovery(recoveryAttestation);
  globalThis.window = {};
  try {
    await assert.rejects(f.candidate.approveT01Recovery(review, true, new Event('click')), /dedicated button/);
  } finally { delete globalThis.window; }
  assert.equal(f.records.has(f.recoveryKey), false);
});

for (const change of ['owner', 'chain', 'nonce', 'pending nonce', 'balance', 'allowance', 'quote', 'canonical', 'expired', 'RPC', 'authorization']) {
  test('T01 recovery refuses changed ' + change + ' at owner approval', async t => {
    const f = await recoveryFixture(t);
    const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
    const request = f.provider.request.bind(f.provider);
    if (change === 'owner') f.setAccounts([inputs.mira]);
    if (change === 'chain') f.setChain('0x1');
    if (change === 'nonce') f.setNonce('0x33');
    if (change === 'allowance') f.answers.allowance = [1];
    if (change === 'quote') f.answers.getRegisterPrice = [8000022, 0];
    if (change === 'authorization') f.setAuthorization(null);
    let latestReads = 0;
    f.provider.request = async input => {
      if (change === 'RPC' && input.method === 'eth_getBlockByNumber') throw Error('Unavailable');
      if (change === 'pending nonce' && input.method === 'eth_getTransactionCount' && input.params[1] === 'pending') return '0x33';
      if (change === 'canonical' && input.method === 'eth_getBlockByNumber' && input.params[0] !== 'latest') return { ...block, hash: txHash };
      if (change === 'expired' && input.method === 'eth_getBlockByNumber' && input.params[0] === 'latest') {
        return { ...block, number: ++latestReads === 1 ? block.number : '0x70' };
      }
      if (change === 'balance' && input.method === 'eth_call' &&
        input.params[0].data.startsWith(token.getFunction('balanceOf').selector)) return token.encodeFunctionResult('balanceOf', [1]);
      return request(input);
    };
    await assert.rejects(f.candidate.approveT01Recovery(review, true));
    assert.equal(f.records.has(f.recoveryKey), false);
    assert.deepEqual(JSON.parse(f.records.get(f.attemptKey)), f.rejected);
    assert.equal(f.calls.some(x => /send|sign|requestAccounts/i.test(x.method)), false);
  });
}

test('T01 recovery is invalidated by wallet-context changes and reloads', async t => {
  const f = await recoveryFixture(t);
  const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
  f.emit('accountsChanged');
  await assert.rejects(f.candidate.approveT01Recovery(review, true), /Recovery review missing/);
  const reload = new f.Active(f.args);
  t.after(() => reload.close());
  await assert.rejects(reload.approveT01Recovery(review, true), /Recovery review missing/);
  const current = await f.candidate.inspectT01Recovery(recoveryAttestation);
  await f.candidate.approveT01Recovery(current, true);
  const afterApproval = new f.Active(f.args);
  t.after(() => afterApproval.close());
  await assert.rejects(afterApproval.prepare('T01'), /Prior T01 attempt/);
  await assert.rejects(afterApproval.inspectT01Recovery(recoveryAttestation), /already recorded/);
});

test('T01 recovery rejects replay and concurrent tabs under the shared lock', async t => {
  const f = await recoveryFixture(t);
  const other = new f.Active(f.args);
  t.after(() => other.close());
  const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
  const otherReview = await other.inspectT01Recovery(recoveryAttestation);
  const approving = f.candidate.approveT01Recovery(review, true);
  await assert.rejects(other.approveT01Recovery(otherReview, true), /locked in another tab/);
  await approving;
  await assert.rejects(other.approveT01Recovery(otherReview, true), /already recorded/);
  await assert.rejects(other.prepare('T01'), /Prior T01 attempt/);
  const original = f.records.get(f.attemptKey);
  const retryReview = await f.candidate.prepare('T01');
  await f.candidate.validateT01Confirmation(retryReview, true);
  let sends = 0;
  const request = f.provider.request.bind(f.provider);
  f.provider.request = async input => {
    if (input.method === 'eth_sendTransaction') { sends++; return txHash; }
    return request(input);
  };
  const submission = f.candidate.submitT01(retryReview, true);
  await assert.rejects(f.candidate.submitT01(retryReview, true), /already in progress/);
  await assert.rejects(other.prepare('T01'), /locked in another tab/);
  await submission;
  assert.equal(sends, 1);
  assert.equal(f.records.get(f.attemptKey), original);
});

for (const failAt of ['recovery before write', 'recovery after write', 'approval journal', 'retry before write', 'retry after write', 'retry journal']) {
  test('T01 recovery fails closed on interrupted ' + failAt, async t => {
    const f = await recoveryFixture(t);
    const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
    const setItem = f.storage.setItem;
    let armed = true;
    const recoveryFailure = failAt.startsWith('recovery') || failAt === 'approval journal';
    if (!recoveryFailure) await f.candidate.approveT01Recovery(review, true);
    const retryReview = recoveryFailure ? null : await f.candidate.prepare('T01');
    if (retryReview) await f.candidate.validateT01Confirmation(retryReview, true);
    f.storage.setItem = (key, value) => {
      const target = failAt.startsWith('recovery') ? f.recoveryKey :
        failAt.startsWith('retry ') && failAt !== 'retry journal' ? f.retryKey : f.journalKey;
      if (armed && key === target) {
        armed = false;
        if (failAt.endsWith('after write')) setItem(key, value);
        throw Error('Interrupted persistence');
      }
      setItem(key, value);
    };
    if (recoveryFailure) await assert.rejects(f.candidate.approveT01Recovery(review, true), /Interrupted/);
    else await assert.rejects(f.candidate.submitT01(retryReview, true), /Interrupted/);
    if (retryReview) {
      assert.equal(f.candidate.canSubmit(retryReview), false);
      await assert.rejects(f.candidate.submitT01(retryReview, true), /execution disabled/);
    }
    assert.equal(f.calls.some(x => /send|sign|requestAccounts/i.test(x.method)), false);
    assert.deepEqual(JSON.parse(f.records.get(f.attemptKey)), f.rejected);
    const reload = new f.Active(f.args);
    t.after(() => reload.close());
    await assert.rejects(reload.prepare('T01'), /Prior T01 attempt/);
    await assert.rejects(f.candidate.approveT01Recovery(review, true), /Recovery review missing|already recorded/);
  });
}

test('T01 recovery requires locks and durable T01 authorization and cannot authorize other steps', async t => {
  const f = await recoveryFixture(t);
  const unlocked = new f.Active({ ...f.args, locks: undefined });
  t.after(() => unlocked.close());
  await assert.rejects(unlocked.inspectT01Recovery(recoveryAttestation), /Exclusive browser lock/);
  for (const auth of [null, { stage: 'GO', step: 'T02', kind: 'T01_INTENT_V1', intentDigest: txHash },
    { stage: 'GO', step: 'T01', kind: 'T01_INTENT_V1', intentDigest: txHash }]) {
    f.setAuthorization(auth);
    await assert.rejects(f.candidate.inspectT01Recovery(recoveryAttestation), /durable T01 authorization/);
  }
  for (const step of bundle.plan.transactions.slice(1)) assert.equal(f.candidate.canSubmit({ step: step.id }), false);
  await assert.rejects(f.candidate.submitStep({ step: 'T04' }, true), /T04 execution blocked/);
});

test('real browser delayed recovery consumes its trusted click before Web Locks and reaches only a fresh unsigned review', {
  skip: !process.env.NAK_RECOVERY_PLAYWRIGHT,
}, async t => {
  const { createRequire } = await import('node:module');
  const { createServer } = await import('node:http');
  const { chromium } = createRequire(import.meta.url)(process.env.NAK_RECOVERY_PLAYWRIGHT);
  const f = await recoveryFixture(t);
  const source = await activatedBuild(null, "import './browser.mjs';", true);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const auth = { stage: 'GO', step: 'T01', kind: 'T01_INTENT_V1', intentDigest: f.intentDigest };
  const server = createServer((req, res) => {
    const files = {
      '/': ['text/html', html], '/app.js': ['text/javascript', source],
      '/style.css': ['text/css', ''], '/candidate-bundle.json': ['application/json', JSON.stringify(f.data)],
      '/step-authorization.json': ['application/json', JSON.stringify(auth)],
      '/favicon.ico': ['image/x-icon', ''],
    };
    const file = files[req.url];
    res.writeHead(file ? 200 : 404, { 'content-type': file?.[0] ?? 'text/plain' }).end(file?.[1] ?? '');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({
    ...(process.env.NAK_RECOVERY_BROWSER_EXECUTABLE ? { executablePath: process.env.NAK_RECOVERY_BROWSER_EXECUTABLE } : {}),
    headless: true, args: ['--no-sandbox', '--disable-extensions'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [], forbidden = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.exposeBinding('testRead', async (_, input) => {
    if (/send|sign|requestAccounts/i.test(input.method)) {
      forbidden.push(input.method);
      throw Error('Test forbids wallet permissions, signing and sends');
    }
    return f.provider.request(input);
  });
  await page.addInitScript(({ records, timestamp }) => {
    Date.now = () => timestamp;
    for (const [key, value] of records) localStorage.setItem(key, value);
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: input => window.testRead(input) };
    window.unhandled = [];
    window.addEventListener('unhandledrejection', event => window.unhandled.push(String(event.reason)));
  }, { records: [...f.records], timestamp: f.now() });
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => !document.getElementById('prepare').disabled);
  await page.check('#t01-recovery-activity');
  await page.check('#t01-recovery-no-transaction');
  await page.click('#t01-recovery-inspect');
  await page.waitForFunction(() => !document.getElementById('t01-recovery-confirmed').disabled);
  assert.match(await page.locator('#t01-recovery-review').textContent(), /T01_HASHLESS_REJECTION_V1/);
  const inspectedBrowserReview = JSON.parse(await page.locator('#t01-recovery-review').textContent());
  const delayedHead = { ...block, number: '0x80', hash: txHash,
    timestamp: '0x' + (BigInt(block.timestamp) + 240n).toString(16) };
  const browserRead = f.provider.request.bind(f.provider);
  f.provider.request = input => input.method === 'eth_getBlockByNumber' &&
    (input.params[0] === 'latest' || input.params[0] === delayedHead.number) ?
    Promise.resolve(delayedHead) : browserRead(input);
  await page.evaluate(timestamp => { Date.now = () => timestamp; }, f.now() + 240_000);
  await page.check('#t01-recovery-confirmed');
  await page.click('#t01-recovery-approve');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('T01 recovery approved.'));
  const stored = await page.evaluate(() => ({ ...localStorage }));
  assert.equal(stored[f.attemptKey], f.records.get(f.attemptKey));
  assert.equal(JSON.parse(stored[f.recoveryKey]).rejectedAttemptDigest, digest(f.rejected));
  assert.deepEqual(JSON.parse(stored[f.recoveryKey]), inspectedBrowserReview);
  assert.equal(stored[f.retryKey], undefined);
  await page.click('#prepare');
  await page.waitForFunction(() => !document.getElementById('prepare').disabled);
  assert.equal(JSON.parse(await page.locator('#journal').textContent()).entries.T01.status, 'PREPARED');
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.unhandled), []);
  assert.deepEqual(forbidden, []);
});

test('a hash discovered after recovery approval blocks retry in every tab without changing original evidence', async t => {
  const f = await recoveryFixture(t);
  const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
  await f.candidate.approveT01Recovery(review, true);
  const retryReview = await f.candidate.prepare('T01');
  await f.candidate.validateT01Confirmation(retryReview, true);
  const original = f.records.get(f.attemptKey);
  const other = new f.Active(f.args);
  t.after(() => other.close());
  await assert.rejects(other.reconcile('T01', txHash), /Transaction evidence appeared/);
  assert.equal(f.candidate.canSubmit(retryReview), false);
  await assert.rejects(f.candidate.submitT01(retryReview, true), /execution disabled/);
  assert.equal(f.records.get(f.attemptKey), original);
  assert.equal(f.records.has(f.retryKey), false);
  assert.equal(f.calls.some(x => /send|sign|requestAccounts/i.test(x.method)), false);
});

for (const change of ['estimate', 'journal', 'attempt', 'context', 'final nonce', 'time']) {
  test('T01 recovery rejects altered ' + change + ' evidence before persistence', async t => {
    const f = await recoveryFixture(t);
    const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
    if (change === 'estimate') f.setEstimate('0xc351');
    if (change === 'journal') {
      const updated = structuredClone(f.journal);
      updated.history.push({ kind: 'CONFLICTING_AUDIT' });
      f.records.set(f.journalKey, JSON.stringify(updated));
    }
    if (change === 'attempt') f.records.set(f.attemptKey, JSON.stringify({ ...f.rejected, status: 'UNCERTAIN' }));
    if (change === 'time') f.candidate.now = () => f.now() + 121_000;
    let accounts = 0;
    f.provider.hook = async method => {
      if (method === 'eth_accounts' && ++accounts === 2) {
        await Promise.resolve();
        if (change === 'context') f.emit('chainChanged');
        if (change === 'final nonce') f.setNonce('0x33');
      }
    };
    await assert.rejects(f.candidate.approveT01Recovery(review, true));
    assert.equal(f.records.has(f.recoveryKey), false);
    assert.equal(f.calls.some(x => /send|sign|requestAccounts/i.test(x.method)), false);
  });
}

for (const write of ['recovery', 'approval journal', 'retry', 'retry journal']) {
  test('silent storage loss at ' + write + ' never permits a wallet handoff', async t => {
    const f = await recoveryFixture(t);
    const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
    const approving = write === 'recovery' || write === 'approval journal';
    if (!approving) await f.candidate.approveT01Recovery(review, true);
    const retryReview = approving ? null : await f.candidate.prepare('T01');
    if (retryReview) await f.candidate.validateT01Confirmation(retryReview, true);
    const setItem = f.storage.setItem;
    f.storage.setItem = (key, value) => {
      const target = write === 'recovery' ? f.recoveryKey : write === 'retry' ? f.retryKey : f.journalKey;
      if (key !== target) setItem(key, value);
    };
    if (approving) await assert.rejects(f.candidate.approveT01Recovery(review, true), /persistence failed/);
    else {
      await assert.rejects(f.candidate.submitT01(retryReview, true), /persistence failed|submission uncertain/);
      assert.equal(f.candidate.canSubmit(retryReview), false);
    }
    assert.equal(f.calls.some(x => /send|sign|requestAccounts/i.test(x.method)), false);
    assert.deepEqual(JSON.parse(f.records.get(f.attemptKey)), f.rejected);
  });
}

test('a supplied hash before recovery is retained and cannot be forgotten by a later attestation', async t => {
  const f = await recoveryFixture(t);
  await assert.rejects(f.candidate.reconcile('T01', txHash), /Transaction evidence appeared/);
  await assert.rejects(f.candidate.inspectT01Recovery(recoveryAttestation), /Transaction evidence blocks/);
  assert.equal(JSON.parse(f.records.get(f.recoveryKey + ':transaction-evidence')).hash, txHash);
  assert.equal(f.records.has(f.recoveryKey), false);
  assert.deepEqual(JSON.parse(f.records.get(f.attemptKey)), f.rejected);
});

test('delayed recovery approval retains the inspected digest while refreshing evidence across blocks and time', async t => {
  const f = await recoveryFixture(t);
  const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
  const original = f.records.get(f.attemptKey);
  const inspected = structuredClone(review);
  f.candidate.now = () => f.now() + 240_000;
  const head = { ...block, number: '0x80', hash: txHash,
    timestamp: '0x' + (BigInt(block.timestamp) + 240n).toString(16), baseFeePerGas: '0x12' };
  const request = f.provider.request.bind(f.provider);
  f.provider.request = async input => {
    assert.doesNotMatch(input.method, /send|sign|requestAccounts/i);
    if (input.method === 'eth_getBlockByNumber' &&
      (input.params[0] === 'latest' || input.params[0] === head.number)) return head;
    return request(input);
  };
  const result = await f.candidate.approveT01Recovery(review, true);
  assert.equal(result.recoveryDigest, inspected.recoveryDigest);
  assert.deepEqual(JSON.parse(f.records.get(f.recoveryKey)), inspected);
  assert.equal(f.records.get(f.attemptKey), original);
  assert.equal(f.records.has(f.retryKey), false);
  const prepared = await f.candidate.prepare('T01');
  assert.equal(prepared.snapshot.number, head.number);
  assert.equal(f.candidate.canSubmit(prepared), false);
});

for (const failure of ['inspected reorg', 'fresh reorg', 'fresh block lag', 'fresh time age', 'nonce', 'balance', 'conflict', 'missing inspected block']) {
  test('delayed recovery approval fails closed on ' + failure, async t => {
    const f = await recoveryFixture(t);
    const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
    let now = f.now() + 240_000;
    f.candidate.now = () => now;
    const head = { ...block, number: '0x80', hash: txHash,
      timestamp: '0x' + (BigInt(block.timestamp) + 240n).toString(16) };
    const request = f.provider.request.bind(f.provider);
    let accountReads = 0;
    f.provider.request = async input => {
      assert.doesNotMatch(input.method, /send|sign|requestAccounts/i);
      if (input.method === 'eth_accounts' && ++accountReads === 2) {
        await Promise.resolve();
        if (failure === 'fresh time age') now += 121_000;
        if (failure === 'nonce') f.setNonce('0x33');
        if (failure === 'conflict') {
          f.records.set(f.attemptKey.replace('t01', 't02'), JSON.stringify({ nonce: '0x32', status: 'UNCERTAIN' }));
        }
      }
      if (input.method === 'eth_getBlockByNumber') {
        if (input.params[0] === block.number) {
          if (failure === 'missing inspected block') return null;
          if (failure === 'inspected reorg') return { ...block, hash: '0x' + '33'.repeat(32) };
        }
        if (input.params[0] === 'latest') {
          return failure === 'fresh block lag' && accountReads === 2 ? { ...head, number: '0x83' } : head;
        }
        if (input.params[0] === head.number) {
          return failure === 'fresh reorg' && accountReads === 2 ? { ...head, hash: '0x' + '33'.repeat(32) } : head;
        }
      }
      if (failure === 'balance' && input.method === 'eth_call' &&
        input.params[0].data.startsWith(token.getFunction('balanceOf').selector)) {
        return token.encodeFunctionResult('balanceOf', [1]);
      }
      return request(input);
    };
    await assert.rejects(f.candidate.approveT01Recovery(review, true));
    assert.equal(f.records.has(f.recoveryKey), false);
    assert.equal(f.records.has(f.retryKey), false);
    assert.deepEqual(JSON.parse(f.records.get(f.attemptKey)), f.rejected);
  });
}

test('delayed recovery approval remains exclusive and fail-closed if persistence is interrupted', async t => {
  const f = await recoveryFixture(t);
  const review = await f.candidate.inspectT01Recovery(recoveryAttestation);
  const other = new f.Active(f.args);
  t.after(() => other.close());
  const otherReview = await other.inspectT01Recovery(recoveryAttestation);
  const now = f.now() + 240_000;
  f.candidate.now = () => now;
  other.now = () => now;
  const head = { ...block, number: '0x80', hash: txHash,
    timestamp: '0x' + (BigInt(block.timestamp) + 240n).toString(16) };
  const request = f.provider.request.bind(f.provider);
  f.provider.request = async input => {
    assert.doesNotMatch(input.method, /send|sign|requestAccounts/i);
    if (input.method === 'eth_getBlockByNumber' &&
      (input.params[0] === 'latest' || input.params[0] === head.number)) return head;
    return request(input);
  };
  const setItem = f.storage.setItem;
  f.storage.setItem = (key, value) => {
    setItem(key, value);
    if (key === f.recoveryKey) throw Error('Interrupted recovery write');
  };
  const approving = f.candidate.approveT01Recovery(review, true);
  await assert.rejects(other.approveT01Recovery(otherReview, true), /locked in another tab/);
  await assert.rejects(approving, /Interrupted recovery write/);
  assert.equal(f.records.has(f.recoveryKey), true);
  await assert.rejects(f.candidate.prepare('T01'), /Prior T01 attempt/);
  await assert.rejects(other.prepare('T01'), /Prior T01 attempt/);
  assert.equal(f.records.has(f.retryKey), false);
  assert.deepEqual(JSON.parse(f.records.get(f.attemptKey)), f.rejected);
});

const reviewedT02Caps = { gas: '155240', maxFeePerGas: '35', maxPriorityFeePerGas: '1' };
const approvedT02PacketDigest = '0xbe3bd4e1c0a8468be55adb826cec4e8ac58cb374143f02ed04098b278904b358';

async function retainedT02Fixture(t) {
  const f = fixture();
  const draft = open(f);
  await draft.prepare('T01');
  f.confirm('0x65');
  let now = f.now();
  let head = { ...block, number: '0x70', baseFeePerGas: '0x11' };
  const history = new Map([[block.number, block], ['0x65', { ...block, number: '0x65' }], [head.number, { ...head }]]);
  const request = f.provider.request.bind(f.provider);
  f.provider.request = async input => {
    if (input.method === 'eth_getBlockByNumber') {
      if (input.params[0] === 'latest') return head;
      if (input.params[0] === 'finalized') return history.get('0x65');
      if (input.params[0] === head.number) return head;
      if (history.has(input.params[0])) return history.get(input.params[0]);
    }
    if (input.method === 'eth_getTransactionCount' && input.params[1] === block.number) return '0x32';
    return request(input);
  };
  await draft.reconcile('T01', txHash);
  f.setNonce('0x33');
  f.setEstimate('0x1f956');
  const initial = await draft.prepare('T02');
  const approval = await draft.validateConfirmation(initial, true);
  assert.equal(approval.packetDigest, approvedT02PacketDigest);
  draft.close();
  let auth = { stage: 'GO', step: 'T02', planDigest: approval.planDigest, packetDigest: approval.packetDigest };
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => auth });
  t.after(() => { globalThis.fetch = priorFetch; });
  const { CandidateReview: Active } = await activatedBuild();
  let held = false;
  const locks = { async request(_key, _options, callback) {
    if (held) return callback(null);
    held = true;
    try { return await callback({}); } finally { held = false; }
  } };
  const args = { provider: f.provider, bundle: f.data, storage: f.storage, now: () => now, locks };
  const active = new Active(args);
  t.after(() => active.close());
  const advance = (number, fee = '0x10', seconds = 12) => {
    history.set(head.number, { ...head });
    now += seconds * 1000;
    head = { ...head, number, hash: '0x' + number.slice(2).padStart(64, '0'),
      timestamp: '0x' + (BigInt(block.timestamp) + BigInt((now - f.now()) / 1000)).toString(16),
      baseFeePerGas: fee };
    history.set(number, { ...head });
  };
  advance('0x80', '0x10', 240);
  return { ...f, active, Active, args, approval, advance, history,
    setAuthorization: value => { auth = value; }, getAuthorization: () => auth,
    head: () => head, clock: () => now };
}

test('retained T02 prepares the exact authorized packet across base-fee drift and refreshes observations', async t => {
  const f = await retainedT02Fixture(t);
  const review = await f.active.prepare('T02', reviewedT02Caps);
  assert.equal(review.unsignedTransaction.maxFeePerGas, '0x23');
  assert.equal(review.unsignedTransaction.gas, '0x25e68');
  assert.equal(f.active.journal().entries.T01.status, 'CONFIRMED');
  const journalKey = 'nak-candidate:' + f.approval.planDigest;
  const saved = JSON.parse(f.records.get(journalKey)).entries.T02;
  assert.equal(saved.packetDigest, approvedT02PacketDigest);
  assert.deepEqual(saved.anchor.reviewedCaps, { gas: '0x25e68', maxFeePerGas: '0x23', maxPriorityFeePerGas: '0x1' });
  f.advance('0x90', '0x12', 240);
  const result = await f.active.validateConfirmation(review, true);
  assert.equal(result.packetDigest, approvedT02PacketDigest);
  assert.equal(f.active.canSubmit(review), true);
  assert.deepEqual(JSON.parse(f.records.get(journalKey)).entries.T02, saved);
  const simulation = f.calls.filter(x => x.method === 'eth_estimateGas').at(-1);
  assert.deepEqual(simulation.params, [review.unsignedTransaction, '0x90']);
  f.advance('0xa0', '0x22', 240);
  await f.active.validateConfirmation(review, true);
  assert.equal(f.calls.some(x => /send|sign|requestAccounts/i.test(x.method)), false);
  // Retained fees must also reconstruct after reload at a block with a different base fee.
  const reload = new f.Active(f.args);
  t.after(() => reload.close());
  const fresh = await reload.prepare('T02', reviewedT02Caps);
  assert.equal(fresh.unsignedTransaction.maxFeePerGas, '0x23');
  assert.equal((await reload.validateConfirmation(fresh, true)).packetDigest, approvedT02PacketDigest);
  for (const step of bundle.plan.transactions.filter(x => x.id !== 'T02')) {
    assert.equal(reload.canSubmit({ step: step.id }), false);
  }
});

for (const change of ['gas', 'fee', 'priority', 'nonce', 'allowance', 'quote', 'estimate', 'authorization', 'policy']) {
  test('retained T02 fails closed on changed ' + change, async t => {
    const f = await retainedT02Fixture(t);
    const caps = { ...reviewedT02Caps };
    if (change === 'gas') caps.gas = '155241';
    if (change === 'fee') caps.maxFeePerGas = '33';
    if (change === 'priority') caps.maxPriorityFeePerGas = '2';
    if (change === 'nonce') f.setNonce('0x34');
    if (change === 'allowance') f.answers.allowance = [1];
    if (change === 'quote') f.answers.getRegisterPrice = [8000022, 0];
    if (change === 'estimate') f.setEstimate('0x1f957');
    if (change === 'authorization') f.setAuthorization({ ...f.getAuthorization(), packetDigest: txHash });
    if (change === 'policy') caps.maxFeePerGas = '2000000001';
    await assert.rejects(f.active.prepare('T02', caps));
    assert.equal(f.calls.some(x => /send|sign|requestAccounts/i.test(x.method)), false);
    assert.equal([...f.records.keys()].some(key => key.startsWith('nak-t02-attempt:')), false);
  });
}

for (const change of ['insufficient cap', 'nonce', 'estimate', 'allowance', 'old reorg', 'fresh reorg', 'stale head', 'stale time', 'late fee']) {
  test('retained T02 handoff blocks ' + change + ' before attempt persistence', async t => {
    const f = await retainedT02Fixture(t);
    const review = await f.active.prepare('T02', reviewedT02Caps);
    const anchorNumber = review.snapshot.number;
    f.advance('0x90', '0x10', 240);
    if (change === 'insufficient cap') f.advance('0x91', '0x23');
    if (change === 'nonce') f.setNonce('0x34');
    if (change === 'estimate') f.setEstimate('0x1f957');
    if (change === 'allowance') f.answers.allowance = [1];
    const request = f.provider.request.bind(f.provider);
    let nonceReads = 0, sends = 0;
    f.provider.request = async input => {
      if (input.method === 'eth_getTransactionCount' && ++nonceReads === 8) {
        await Promise.resolve();
        if (change === 'stale head') f.advance('0x94', '0x10', 0);
        if (change === 'stale time') f.active.now = () => f.clock() + 121_000;
        if (change === 'late fee') f.advance('0x91', '0x23', 0);
      }
      if (input.method === 'eth_getBlockByNumber') {
        if (change === 'old reorg' && input.params[0] === anchorNumber) return { ...f.history.get(anchorNumber), hash: txHash };
        if (change === 'fresh reorg' && input.params[0] === '0x90' && nonceReads >= 8) return { ...f.head(), hash: txHash };
      }
      if (input.method === 'eth_sendTransaction') { sends++; return txHash; }
      return request(input);
    };
    await assert.rejects(f.active.submitStep(review, true));
    assert.equal(sends, 0);
    assert.equal([...f.records.keys()].some(key => key.startsWith('nak-t02-attempt:')), false);
  });
}

test('retained T02 preserves a separate Request action and prevents concurrent and duplicate requests', async t => {
  const f = await retainedT02Fixture(t);
  const review = await f.active.prepare('T02', reviewedT02Caps);
  await f.active.validateConfirmation(review, true);
  let sends = 0;
  assert.equal(f.calls.some(x => /send|sign|requestAccounts/i.test(x.method)), false);
  const request = f.provider.request.bind(f.provider);
  f.provider.request = async input => {
    if (input.method === 'eth_sendTransaction') {
      sends++;
      assert.deepEqual(input.params, [review.unsignedTransaction]);
      return txHash;
    }
    return request(input);
  };
  const submission = f.active.submitStep(review, true);
  await assert.rejects(f.active.submitStep(review, true), /already in progress/);
  await submission;
  await assert.rejects(f.active.submitStep(review, true), /execution disabled/);
  const reload = new f.Active(f.args);
  t.after(() => reload.close());
  await assert.rejects(reload.prepare('T02', reviewedT02Caps), /Prior T02 attempt/);
  assert.equal(sends, 1);
});

test('retained T02 preparation cannot be applied to any other step', async t => {
  const f = await retainedT02Fixture(t);
  for (const step of bundle.plan.transactions.filter(x => x.id !== 'T02')) {
    await assert.rejects(f.active.prepare(step.id, reviewedT02Caps), /T02-only/);
    assert.equal(f.active.canSubmit({ step: step.id }), false);
  }
  await assert.rejects(f.active.submitStep({ step: 'T04' }, true), /T04 execution blocked/);
});

test('real browser explicitly prepares the retained T02 packet and requests only after a separate trusted action', {
  skip: !process.env.NAK_RECOVERY_PLAYWRIGHT,
}, async t => {
  const { createRequire } = await import('node:module');
  const { createServer } = await import('node:http');
  const { chromium } = createRequire(import.meta.url)(process.env.NAK_RECOVERY_PLAYWRIGHT);
  const f = await retainedT02Fixture(t);
  const source = await activatedBuild(null, "import './browser.mjs';", true);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  let servedAuth = f.getAuthorization();
  const server = createServer((req, res) => {
    const files = {
      '/': ['text/html', html], '/app.js': ['text/javascript', source],
      '/style.css': ['text/css', ''], '/candidate-bundle.json': ['application/json', JSON.stringify(f.data)],
      '/step-authorization.json': ['application/json', JSON.stringify(servedAuth)],
      '/favicon.ico': ['image/x-icon', ''],
    };
    const file = files[req.url];
    res.writeHead(file ? 200 : 404, { 'content-type': file?.[0] ?? 'text/plain' }).end(file?.[1] ?? '');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({
    ...(process.env.NAK_RECOVERY_BROWSER_EXECUTABLE ? { executablePath: process.env.NAK_RECOVERY_BROWSER_EXECUTABLE } : {}),
    headless: true, args: ['--no-sandbox', '--disable-extensions'],
  });
  t.after(() => browser.close());
  const errors = [], sends = [];
  let expectedTransaction;
  const openPage = async () => {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeBinding('testWallet', async (_, input) => {
      assert.doesNotMatch(input.method, /sign|requestAccounts/i);
      if (input.method === 'eth_sendTransaction') {
        assert.ok(expectedTransaction, 'A separate Request action must be expected');
        assert.deepEqual(input.params, [expectedTransaction]);
        sends.push(input);
        return '0x' + '34'.repeat(32);
      }
      return f.provider.request(input);
    });
    await page.addInitScript(({ records, timestamp }) => {
      Date.now = () => timestamp;
      for (const [key, value] of records) localStorage.setItem(key, value);
      window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: input => window.testWallet(input) };
      window.unhandled = [];
      window.addEventListener('unhandledrejection', event => window.unhandled.push(String(event.reason)));
    }, { records: [...f.records], timestamp: f.clock() });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => !document.getElementById('prepare').disabled);
    await page.selectOption('#step', 'T02');
    assert.equal(await page.locator('#t02-reviewed-caps').isVisible(), true);
    assert.equal(await page.locator('#t02-retain-caps').isChecked(), false);
    assert.equal(await page.inputValue('#t02-gas'), '155240');
    assert.equal(await page.inputValue('#t02-fee'), '35');
    assert.equal(await page.inputValue('#t02-tip'), '1');
    await page.check('#t02-retain-caps');
    return page;
  };
  const page = await openPage();
  await page.click('#prepare');
  await page.waitForFunction(() => !document.getElementById('prepare').disabled);
  const review = JSON.parse(await page.locator('#review').textContent());
  const stored = await page.evaluate(() => ({ ...localStorage }));
  const journal = JSON.parse(stored['nak-candidate:' + f.approval.planDigest]);
  assert.equal(journal.entries.T02.packetDigest, approvedT02PacketDigest);
  assert.equal(journal.entries.T01.status, 'CONFIRMED');
  assert.equal(review.unsignedTransaction.maxFeePerGas, '0x23');
  assert.equal(review.unsignedTransaction.gas, '0x25e68');
  assert.equal(await page.locator('#t01-validate').isDisabled(), true);
  assert.equal(sends.length, 0);
  f.advance('0x90', '0x12', 240);
  await page.evaluate(timestamp => { Date.now = () => timestamp; }, f.clock());
  await page.check('#t01-confirmed');
  assert.equal(sends.length, 0);
  assert.equal(await page.locator('#t01-validate').textContent(), 'Request T02 in MetaMask');
  expectedTransaction = review.unsignedTransaction;
  await page.click('#t01-validate');
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('T02 pending.'));
  assert.equal(sends.length, 1);
  assert.equal(await page.locator('#t01-validate').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.unhandled), []);
  await page.close();
  expectedTransaction = undefined;

  for (const failure of ['missing authorization', 'different authorization', 'fee cap', 'nonce']) {
    servedAuth = failure === 'missing authorization' ? null : failure === 'different authorization' ?
      { ...f.getAuthorization(), packetDigest: txHash } : f.getAuthorization();
    f.setNonce(failure === 'nonce' ? '0x34' : '0x33');
    f.advance('0x' + (0xa0 + ['missing authorization', 'different authorization', 'fee cap', 'nonce'].indexOf(failure)).toString(16),
      failure === 'fee cap' ? '0x23' : '0x10');
    const negative = await openPage();
    await negative.click('#prepare');
    await negative.waitForFunction(() => !document.getElementById('prepare').disabled);
    const status = await negative.locator('#status').textContent();
    assert.match(status, /authorization|Base fee moved outside reviewed envelope|nonce/i);
    assert.equal(await negative.locator('#t01-validate').isDisabled(), true);
    assert.equal(sends.length, 1);
    assert.deepEqual(await negative.evaluate(() => window.unhandled), []);
    await negative.close();
  }
  assert.deepEqual(errors, []);
});
