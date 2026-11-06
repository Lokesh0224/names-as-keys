import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Interface } from 'ethers';
import { privateEstimator } from '../private_transport.mjs';
import { privateEstimateHandler } from '../private_server.mjs';
import { loadCandidateBundle } from '../candidate_bundle.mjs';
import { allowedForward } from '../../deployment_candidate/upstream_proxy.mjs';

const bundle = await loadCandidateBundle();
const step = bundle.plan.transactions.find(s => s.id === 'T04');
const iface = new Interface(bundle.abis.ETHRegistrar);
const secret = '0x' + 'ab'.repeat(32);
const args = [...step.candidateArguments];
args[2] = secret;
const tx = { from: bundle.inputs.owner, to: step.candidateDestination, nonce: step.candidateNonce,
  value: '0x0', chainId: '0xaa36a7', maxFeePerGas: '0x21', maxPriorityFeePerGas: '0x1',
  data: iface.encodeFunctionData(step.signature, args) };
const header = { number: '0x64', hash: '0x' + '11'.repeat(32) };
const origin = 'http://127.0.0.1:8769';

async function invoke(handler, { body = { tx, header }, site = origin, host = '127.0.0.1:8769', method = 'POST' } = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, { method, url: '/private-estimate', headers: { host, origin: site, 'content-type': 'application/json' } });
  const result = {};
  await handler(req, { setHeader: (key, value) => { result[key] = value; },
    writeHead: status => { result.status = status; }, end: text => { result.body = text; } });
  return result;
}

test('browser private estimator requires the loopback origin and forbids redirects and caching', async () => {
  const calls = [];
  const fetcher = async (...args) => { calls.push(args); return { ok: true, json: async () => ({ gas: '0x12' }) }; };
  await assert.rejects(privateEstimator(new URL('https://example.test'), fetcher)(tx, header), /loopback/);
  assert.equal(calls.length, 0);
  assert.equal(await privateEstimator(new URL(origin), fetcher)(tx, header), '0x12');
  const [[url, options]] = calls;
  assert.equal(url, '/private-estimate');
  assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.credentials, 'omit');
});

test('private endpoint accepts only reviewed reveal and returns a gas quantity without reflecting secrets', async () => {
  let calls = 0;
  const handler = privateEstimateHandler(bundle, async request => {
    calls++;
    assert.equal(request.secret, secret);
    assert.deepEqual(request.header, header);
    return '0x1234';
  });
  assert.equal((await invoke(handler, { site: 'https://example.test' })).status, 403);
  assert.equal((await invoke(handler, { host: 'localhost:8769' })).status, 403);
  assert.equal((await invoke(handler, { method: 'GET' })).status, 403);
  for (const bad of [{ ...tx, nonce: '0x0' }, { ...tx, to: bundle.inputs.mira },
    { ...tx, data: iface.encodeFunctionData('commit', [secret]) },
    { ...tx, data: iface.encodeFunctionData(step.signature, ['other', ...args.slice(1)]) }]) {
    assert.equal((await invoke(handler, { body: { tx: bad, header } })).status, 400);
  }
  const result = await invoke(handler);
  assert.equal(calls, 1);
  assert.equal(result.status, 200);
  assert.equal(result['Cache-Control'], 'no-store');
  assert.deepEqual(JSON.parse(result.body), { gas: '0x1234' });
  const failure = await invoke(privateEstimateHandler(bundle, async () => { throw new Error(tx.data); }));
  assert.equal(failure.status, 400);
  assert.ok(!failure.body.includes(secret.slice(2)));
  assert.ok(!failure.body.includes(tx.data));
});

test('guarded upstream rejects raw reveal estimates and preimage bytes even in allowed reads', () => {
  const payload = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });
  assert.equal(allowedForward(payload('eth_estimateGas', [tx, header.number]), secret), false);
  assert.equal(allowedForward(payload('eth_getStorageAt', [tx.to, secret, header.number]), secret), false);
  assert.equal(allowedForward(payload('eth_getBlockByNumber', [header.number, false]), secret), true);
});
