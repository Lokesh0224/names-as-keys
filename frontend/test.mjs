import { id, ZeroAddress } from 'ethers';
import { requestLiveAction } from './live-wallet.mjs';
import { credentialStatus, confirmedThrough, assertConfirmedDoorEvent } from './sepolia.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from './serve.mjs';
import { createDemo } from './demo.mjs';
import { LABEL, DEMO_OWNER, DEMO_GUEST, DEMO_DOOR, doorInterface, registrarInterface, guestPath, doorIsOpen } from './protocol.mjs';

const unlock = account => ({ account, target: 'door', data: doorInterface.encodeFunctionData('unlock', [LABEL]) });
const issue = (now, guest = DEMO_GUEST) => ({
  account: DEMO_OWNER, target: 'registrar',
  data: registrarInterface.encodeFunctionData('issue', [LABEL, guest, Math.floor(now / 1000) + 300]),
});
const revoke = token => ({
  account: DEMO_OWNER, target: 'registrar', data: registrarInterface.encodeFunctionData('revoke', [LABEL, token]),
});

test('a credential authorizes its current ENS owner, and expiry is exclusive', () => {
  let now = 1_800_000_000_000;
  const demo = createDemo(() => now);
  const alternate = '0x0000000000000000000000000000000000001234';
  assert.equal(demo.execute(unlock(DEMO_GUEST)).denied, true);
  demo.execute(issue(now, alternate));
  assert.equal(demo.execute(unlock(DEMO_GUEST)).denied, true);
  demo.execute(unlock(alternate));
  assert.equal(demo.state().latest.nonce, '1');
  now = demo.state().expiry;
  assert.equal(demo.state().status, 'Expired');
  assert.equal(demo.execute(unlock(alternate)).denied, true);
  assert.equal(demo.state().latest.nonce, '1');
  assert.equal(demo.state().activity.filter(event => event.kind === 'unlock').length, 1);
});

test('guest route, QR and cross-view issue → unlock → revoke → deny', async t => {
  const server = await createApp({});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = path => fetch(base + path);
  const state = async () => (await get('/api/state')).json();
  const post = (path, body, origin = base) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
  const initial = await state();
  for (const path of ['/owner', initial.guestPath, '/door', '/qr.svg']) {
    assert.equal((await get(path)).status, 200, path);
  }
  assert.equal(initial.guestPath, guestPath(DEMO_DOOR));
  assert.match(await (await get('/qr.svg')).text(), /^<svg/);
  assert.equal((await get('/guest?door=wrong&mode=demo')).status, 404);
  assert.equal((await get(initial.guestPath + '&contract=bad')).status, 404);
  assert.equal((await post('/api/action', issue(Date.now()), 'http://other.example')).status, 403);
  assert.equal((await post('/api/action', { ...issue(Date.now()), account: DEMO_GUEST })).status, 400);
  assert.equal((await post('/api/action', issue(Date.now()))).status, 200);
  const active = await state();
  assert.equal(active.status, 'Active');
  assert.equal((await post('/api/action', revoke('0'))).status, 400);
  assert.equal((await post('/api/action', unlock(DEMO_GUEST))).status, 200);
  const { latest } = await state();
  assert.equal(latest.guest, DEMO_GUEST);
  assert.equal(latest.doorId, DEMO_DOOR);
  assert.equal(latest.hash, null);
  assert.equal((await post('/api/action', revoke(active.token))).status, 200);
  assert.equal((await post('/api/action', unlock(DEMO_GUEST))).status, 403);
  const revoked = await state();
  assert.equal(revoked.status, 'Revoked');
  assert.equal(revoked.activity[0].kind, 'denied');
  assert.deepEqual(revoked.latest, latest);
  assert.equal((await post('/api/reset', { account: DEMO_OWNER })).status, 200);
  assert.equal((await state()).latest, null);
});

test('Sepolia without a deployment keeps pages available and disables actions and QR', async t => {
  const server = await createApp({ NAK_MODE: 'sepolia' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const response = await fetch(base + '/api/state');
  const state = await response.json();
  assert.equal(state.ready, false);
  assert.match(state.prerequisites, /HTTPS origin and Sepolia RPC/);
  assert.equal((await fetch(base + '/owner')).status, 200);
  assert.equal((await fetch(base + '/api/prepare?action=unlock')).status, 403);
  assert.equal((await fetch(base + '/qr.svg')).status, 404);
});

test('Sepolia maps actual ENS owner and expiry to active, expired or revoked state', () => {
  const tokenId = BigInt(id(LABEL)) & ~0xffffffffn;
  const active = { status: 2n, expiry: 200n, latestOwner: DEMO_GUEST, tokenId, resource: tokenId + 1n };
  assert.equal(credentialStatus(active, DEMO_GUEST, 199n), 'Active');
  assert.equal(credentialStatus({ ...active, status: 0n }, ZeroAddress, 200n), 'Expired');
  assert.equal(credentialStatus({ ...active, status: 0n, latestOwner: ZeroAddress, tokenId: tokenId + 1n }, ZeroAddress, 200n), 'Revoked');
});

test('kiosk excludes head events and rejects missing or reorged confirmed events', () => {
  assert.equal(confirmedThrough(101), 100);
  const log = { blockNumber: 100, blockHash: 'canonical', args: { requestNonce: 2n } };
  assert.doesNotThrow(() => assertConfirmedDoorEvent(log, 2n, 'canonical'));
  assert.throws(() => assertConfirmedDoorEvent(log, 2n, 'reorg'));
  assert.throws(() => assertConfirmedDoorEvent(undefined, 2n));
  assert.equal(doorIsOpen(null, 8000, 20000), false);
  assert.equal(doorIsOpen({ at: 1000, openAt: 20000 }, 8000, 27999), true);
  assert.equal(doorIsOpen({ at: 1000, openAt: 20000 }, 8000, 28000), false);
});

test('wallet uses explicit clicks, rejects wrong chain and handles rejection without retry', async () => {
  const contract = '0x0000000000000000000000000000000000000001';
  const registrar = '0x0000000000000000000000000000000000000002';
  const state = { ready: true, owner: DEMO_OWNER, guest: DEMO_GUEST, contract, registrar };
  const data = doorInterface.encodeFunctionData('unlock', [LABEL]);
  let chain = '0x1', sent = 0;
  const wallet = { isMetaMask: true, async request({ method, params }) {
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_accounts') return [DEMO_GUEST];
    assert.equal(method, 'eth_sendTransaction');
    assert.deepEqual(params, [{ from: DEMO_GUEST, to: contract, data, chainId: '0xaa36a7', value: '0x0' }]);
    sent++;
    throw Object.assign(new Error('Rejected'), { code: 4001 });
  } };
  const input = { wallet, state, account: DEMO_GUEST, action: 'unlock',
    event: { type: 'click', isTrusted: true }, prepare: async () => ({ to: contract, data }), stillConnected: () => true };
  await assert.rejects(requestLiveAction({ ...input, event: { type: 'click', isTrusted: false } }), /unavailable/);
  await assert.rejects(requestLiveAction(input), /network changed/);
  assert.equal(sent, 0);
  chain = '0xaa36a7';
  await assert.rejects(requestLiveAction({ ...input, prepare: async () => { throw new Error('Denied by DoorKeys'); } }), /Denied/);
  assert.equal(sent, 0);
  await assert.rejects(requestLiveAction(input), { code: 4001 });
  assert.equal(sent, 1);
});

test('owner wallet sends only prepared registrar issue and revoke transactions', async () => {
  const registrar = '0x0000000000000000000000000000000000000002';
  const state = { ready: true, owner: DEMO_OWNER, guest: DEMO_GUEST, registrar };
  for (const [action, args] of [['issue', [LABEL, DEMO_GUEST, 12345]], ['revoke', [LABEL, 123n]]]) {
    const data = registrarInterface.encodeFunctionData(action, args);
    const hash = '0x' + '11'.repeat(32);
    const wallet = { isMetaMask: true, async request({ method, params }) {
      if (method === 'eth_accounts') return [DEMO_OWNER];
      if (method === 'eth_chainId') return '0xaa36a7';
      assert.equal(method, 'eth_sendTransaction');
      assert.deepEqual(params, [{ from: DEMO_OWNER, to: registrar, data, chainId: '0xaa36a7', value: '0x0' }]);
      return hash;
    } };
    assert.equal(await requestLiveAction({ wallet, state, action, account: DEMO_OWNER,
      event: { type: 'click', isTrusted: true }, prepare: async () => ({ to: registrar, data }), stillConnected: () => true }), hash);
  }
});
