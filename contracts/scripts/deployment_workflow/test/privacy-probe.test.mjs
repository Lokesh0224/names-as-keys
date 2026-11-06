import test from 'node:test';
import assert from 'node:assert/strict';
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
