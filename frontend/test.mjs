import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from './serve.mjs';
import { createDemo } from './demo.mjs';
import { LABEL, DEMO_OWNER, DEMO_GUEST, DEMO_DOOR, doorInterface, registrarInterface, guestPath } from './protocol.mjs';

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

test('Sepolia fails closed without deployment configuration', async () => {
  await assert.rejects(createApp({ NAK_MODE: 'sepolia' }), /HTTPS origin/);
  await assert.rejects(createApp({
    NAK_MODE: 'sepolia', NAK_PUBLIC_ORIGIN: 'https://door.example', NAK_SEPOLIA_RPC_URL: 'http://127.0.0.1:1',
  }), /invalid address/);
});
