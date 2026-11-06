import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, keccak256 } from 'ethers';
import { CandidateReview } from '../candidate.mjs';
import { loadCandidateBundle } from '../candidate_bundle.mjs';

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
        case 'eth_chainId': return '0xaa36a7';
        case 'eth_getBlockByNumber':
          if (params[0] === 'latest' && advance) return { ...block, number: '0x70' };
          return params[0] === '0x70' ? { ...block, number: '0x70' } : block;
        case 'eth_getTransactionCount': return nonce;
        case 'eth_getBalance': return '0xffffffffffffffff';
        case 'eth_getCode': return params[0] === inputs.owner ? '0x' : '0x6000';
        case 'eth_estimateGas': return '0xc350';
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
