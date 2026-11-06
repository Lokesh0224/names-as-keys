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
  const button = {}, connect = {}, status = {}, connection = {}, methods = [], events = {};
  const elements = { '#probe': button, '#connect': connect, '#status': status, '#connection': connection };
  let chain = '0x7a6a', rejectConnection = false;
  const address = '0x' + 'aB'.repeat(20);
  const zeroNonce = { jsonrpc: '2.0', id: 1, result: '0x0' };
  let rpcReply = zeroNonce;
  runInNewContext(script, {
    TextEncoder, AbortSignal,
    async fetch(url, options) {
      assert.equal(url, '/rpc');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(JSON.parse(options.body), {
        jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [address, 'pending'],
      });
      return { ok: true, json: async () => rpcReply };
    },
    document: { querySelector: selector => elements[selector] },
    window: { ethereum: { isMetaMask: true, on: (name, handler) => { events[name] = handler; }, async request({ method, params }) {
      methods.push(method);
      if (method === 'eth_chainId') return chain;
      if (method === 'eth_requestAccounts') {
        if (rejectConnection) throw Object.assign(new Error(), { code: 4001 });
        events.accountsChanged();
        return [address];
      }
      if (method === 'eth_accounts') return [address];
      if (method === 'eth_getTransactionCount') throw new Error('Injected provider nonce read failed');
      assert.equal(method, 'eth_sendTransaction');
      assert.equal(status.textContent, 'Wallet request started. Reject the prompt.');
      assert.equal(params[0].data, '0x' + MARKER);
      assert.equal(params[0].chainId, '0x7a6a');
      assert.equal(params[0].nonce, '0x0');
      throw Object.assign(new Error(), { code: 4001 });
    } } },
  });
  assert.equal(button.disabled, true);
  await button.onclick({ isTrusted: true });
  await connect.onclick({ isTrusted: false });
  assert.deepEqual(methods, []);
  chain = '0xaa36a7';
  await connect.onclick({ isTrusted: true });
  assert.deepEqual(methods, ['eth_chainId']);
  assert.equal(button.disabled, true);
  chain = '0x7a6a';
  rejectConnection = true;
  await connect.onclick({ isTrusted: true });
  assert.equal(status.textContent, 'Wallet connection rejected.');
  assert.equal(button.disabled, true);
  rejectConnection = false;
  await connect.onclick({ isTrusted: true });
  assert.match(connection.textContent, new RegExp(address + '.*31338'));
  assert.equal(button.disabled, false);
  rpcReply = { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'fixture failure' } };
  await button.onclick({ isTrusted: true });
  assert.match(status.textContent, /RPC returned an error reading the nonce/);
  rpcReply = { ...zeroNonce, result: '0x00' };
  await button.onclick({ isTrusted: true });
  assert.match(status.textContent, /invalid nonce response/);
  assert.ok(!methods.includes('eth_sendTransaction'));
  rpcReply = zeroNonce;
  await button.onclick({ isTrusted: true });
  assert.equal(methods.at(-1), 'eth_sendTransaction');
  assert.ok(!methods.includes('eth_getTransactionCount'));
  assert.equal(status.textContent, 'Rejected by owner.');
  events.accountsChanged();
  assert.equal(button.disabled, true);
  assert.match(status.textContent, /account changed/);
  await connect.onclick({ isTrusted: true });
  events.chainChanged();
  assert.equal(button.disabled, true);
  assert.match(status.textContent, /network changed/);
  await button.onclick({ isTrusted: true });
  assert.equal(methods.filter(method => method === 'eth_sendTransaction').length, 1);
});
