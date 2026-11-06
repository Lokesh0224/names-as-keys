import { Interface, id } from 'ethers';
import doorABI from '../docs/prep/stage3e/abis/DoorKeys.json' with { type: 'json' };
import registrarABI from '../docs/prep/stage3e/abis/CredentialRegistrar.json' with { type: 'json' };

export const ROOT = 'nak-lokesh-20261105';
export const LABEL = 'mira';
export const CHAIN = 11155111;
export const DEMO_OWNER = '0x00000000000000000000000000000000000A11cE';
export const DEMO_GUEST = '0x0000000000000000000000000000000000000B0b';
export const DEMO_DOOR = id('Names as Keys: isolated demo door');
export const doorInterface = new Interface(doorABI);
export const registrarInterface = new Interface(registrarABI);

export function guestPath(door, contract) {
  const context = contract ? { chain: String(CHAIN), contract } : { mode: 'demo' };
  return '/guest?' + new URLSearchParams({ door, ...context });
}

export function describeUnlock(args, at, hash) {
  return {
    kind: 'unlock', at, hash, guest: args.guest, nonce: String(args.requestNonce),
    token: String(args.credentialTokenId), expiry: Number(args.credentialExpiry) * 1000,
    labelHash: args.credentialLabelHash, doorId: args.doorId,
  };
}

export { doorABI, registrarABI };
