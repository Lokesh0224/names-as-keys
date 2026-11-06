import { id } from 'ethers';
import {
  DEMO_OWNER, DEMO_GUEST, DEMO_DOOR, ROOT, LABEL, guestPath,
  doorInterface, registrarInterface, describeUnlock,
} from './protocol.mjs';

export function createDemo(now = Date.now) {
  const root = { owner: DEMO_OWNER, child: 'R1', expiry: now() + 365 * 86400000 };
  const lock = { owner: DEMO_OWNER, child: 'R2', expiry: now() + 90 * 86400000 };
  let credential = null;
  let activity = [];
  let nonce = 0;
  let latestUnlock = null;

  function add(event) {
    activity = [event, ...activity].slice(0, 12);
  }
  function status() {
    if (!credential) return 'Unissued';
    if (credential.revoked) return 'Revoked';
    if (credential.expiry <= now()) return 'Expired';
    return 'Active';
  }
  function eligible(account) {
    return root.owner === DEMO_OWNER && lock.owner === DEMO_OWNER &&
      root.child === 'R1' && lock.child === 'R2' && now() < lock.expiry &&
      lock.expiry <= root.expiry && credential?.expiry <= lock.expiry &&
      status() === 'Active' && credential.owner === account;
  }
  function state(account) {
    return {
      mode: 'demo', root: ROOT, doorId: DEMO_DOOR, owner: DEMO_OWNER, guest: DEMO_GUEST,
      guestPath: guestPath(DEMO_DOOR), status: status(), expiry: credential?.expiry,
      token: credential?.token, activity, latest: latestUnlock,
      eligibility: account ? (eligible(account) ? 'Eligible' : 'Access unavailable') : undefined,
    };
  }

  function execute({ target, account, data }) {
    const at = now();
    if (target === 'door') {
      const call = doorInterface.parseTransaction({ data });
      if (call?.name !== 'unlock' || call.args.label !== LABEL) throw new Error('Invalid door request.');
      if (!eligible(account)) {
        add({ kind: 'denied', at, guest: account });
        return { denied: true, message: 'This wallet has no valid ENS credential for this door.' };
      }
      const log = doorInterface.encodeEventLog('DoorUnlocked', [
        DEMO_DOOR, account, id(LABEL), credential.token, credential.expiry / 1000, ++nonce,
      ]);
      latestUnlock = describeUnlock(doorInterface.parseLog(log).args, at, null);
      add(latestUnlock);
      return { message: 'Synthetic DoorUnlocked received.' };
    }

    if (target !== 'registrar' || account !== DEMO_OWNER) throw new Error('The demo owner must connect first.');
    const call = registrarInterface.parseTransaction({ data });
    if (call?.args.label !== LABEL) throw new Error('Invalid credential label.');
    if (call.name === 'issue') {
      const expiry = Number(call.args.expiry) * 1000;
      if (credential) throw new Error('Mira has already been issued in this session. Reset to rehearse again.');
      if (expiry < at + 60000 || expiry > Math.min(at + 30 * 86400000, lock.expiry)) {
        throw new Error('Invalid credential expiry.');
      }
      if (call.args.guest === DEMO_OWNER || /^0x0+$/.test(call.args.guest)) throw new Error('Invalid credential recipient.');
      const token = BigInt(id(LABEL)) & ~0xffffffffn;
      credential = { owner: call.args.guest, expiry, token: token.toString() };
      add({ kind: 'issued', at, guest: credential.owner });
      return { message: 'Synthetic credential issued.' };
    }
    if (call.name === 'revoke' && status() === 'Active' && String(call.args.expectedTokenId) === credential.token) {
      credential.revoked = true;
      add({ kind: 'revoked', at });
      return { message: 'Synthetic credential revoked.' };
    }
    throw new Error('No matching active credential to revoke.');
  }

  return {
    state, execute,
    reset() {
      credential = null;
      activity = [];
      nonce = 0;
      latestUnlock = null;
    },
  };
}
