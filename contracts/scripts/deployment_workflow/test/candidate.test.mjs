import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, keccak256 } from 'ethers';
import { CandidateReview } from '../candidate.mjs';
import { loadCandidateBundle } from '../candidate_bundle.mjs';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { digest } from '../workflow.mjs';

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
async function activatedBuild(authorization = null, entry = "export * from './candidate.mjs'; export { ReadOnlyWallet } from './workflow.mjs';") {
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
        const declaration = 'function consumeConfirmationClick(event) {';
        assert.ok(source.includes(declaration));
        return { contents: source.replace(declaration, declaration + "\n  if (typeof window === 'undefined') return true;") };
      });
      builder.onLoad({ filter: /t01_authorization\.mjs$/ }, () => ({
        contents: 'export const T01_AUTHORIZATION = ' + JSON.stringify(authorization),
      }));
    } }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
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
