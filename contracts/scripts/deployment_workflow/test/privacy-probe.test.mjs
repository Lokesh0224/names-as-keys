import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { MARKER, traceRpc } from '../privacy_probe/server.mjs';

test('wallet trace records marker-bearing simulation and denies writes without logging payloads', async () => {
  const rows = [], forwarded = [];
  const forward = async call => { forwarded.push(call.method); return { result: '0x5208' }; };
  for (const method of ['eth_estimateGas', 'eth_call', 'eth_simulateV1', 'eth_sendTransaction', 'eth_sendRawTransaction', 'anvil_setBalance']) {
    const reply = await traceRpc({ jsonrpc: '2.0', id: 1, method, params: [{ data: '0x' + MARKER }] }, forward, row => rows.push(row));
    if (method.includes('send') || method.startsWith('anvil')) assert.equal(reply.error.code, -32601);
  }
  assert.deepEqual(forwarded, ['eth_estimateGas', 'eth_call', 'eth_simulateV1']);
  assert.ok(rows.every(row => row.marker));
  assert.ok(!JSON.stringify(rows).includes(MARKER));
  assert.equal(rows.filter(row => row.disposition === 'blocked').length, 3);
});

test('net_version accepts omitted or empty params and broadcasts stay blocked', async () => {
  const forwarded = [];
  const invoke = fields => traceRpc({ jsonrpc: '2.0', id: 7, ...fields }, async call => {
    forwarded.push(call);
    return { jsonrpc: '2.0', id: call.id, result: '31338' };
  }, () => {});
  for (const fields of [{}, { params: [] }]) {
    assert.equal((await invoke({ method: 'net_version', ...fields })).result, '31338');
  }
  assert.equal((await invoke({ method: 'net_version', params: ['extra'] })).error.code, -32601);
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'wallet_sendCalls']) {
    for (const fields of [{}, { params: [] }]) {
      assert.equal((await invoke({ method, ...fields })).error.code, -32601);
    }
  }
  assert.deepEqual(forwarded, Array(2).fill({ jsonrpc: '2.0', id: 7, method: 'net_version', params: [] }));
});

test('probe reaches the injected wallet request and handles owner rejection', async () => {
  const script = await readFile(new URL('../privacy_probe/wallet.mjs', import.meta.url), 'utf8');
  const button = {}, status = {}, methods = [];
  const address = '0x' + '12'.repeat(20);
  runInNewContext(script, {
    TextEncoder, document: { querySelector: selector => selector === '#probe' ? button : status },
    window: { ethereum: { isMetaMask: true, async request({ method, params }) {
      methods.push(method);
      if (method === 'eth_chainId') return '0x7a6a';
      if (method === 'eth_accounts') return [address];
      if (method === 'eth_getTransactionCount') return '0x0';
      assert.equal(method, 'eth_sendTransaction');
      assert.equal(status.textContent, 'Wallet request started. Reject the prompt.');
      assert.equal(params[0].data, '0x' + MARKER);
      assert.equal(params[0].chainId, '0x7a6a');
      throw Object.assign(new Error(), { code: 4001 });
    } } },
  });
  await button.onclick({ isTrusted: true });
  assert.equal(methods.at(-1), 'eth_sendTransaction');
  assert.equal(status.textContent, 'Rejected by owner.');
});
