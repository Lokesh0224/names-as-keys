import { CHAIN, LABEL, doorInterface, registrarInterface } from './protocol.mjs';
import { BrowserProvider, getAddress, isHexString } from 'ethers';

const method = { issue: 'issue', revoke: 'revoke', unlock: 'unlock' };

export async function requestLiveAction({ wallet, account, action, state, event, prepare, stillConnected }) {
  if (event?.isTrusted !== true || event.type !== 'click' || !wallet?.isMetaMask ||
      !Object.hasOwn(method, action) || state.ready !== true) throw new Error('Wallet action unavailable.');
  const guestAction = action === 'unlock';
  const expected = getAddress(guestAction ? state.guest : state.owner);
  const target = getAddress(guestAction ? state.contract : state.registrar);
  const sender = getAddress(account);
  if (sender !== expected) throw new Error('Wrong wallet for this action.');
  const { to, data } = await prepare(action, sender);
  const args = (guestAction ? doorInterface : registrarInterface).decodeFunctionData(action, data);
  if (getAddress(to) !== target || args[0] !== LABEL || (action === 'issue' && args[1] !== state.guest)) {
    throw new Error('Prepared transaction does not match the selected action.');
  }
  const [accounts, chain] = await Promise.all([
    wallet.request({ method: 'eth_accounts' }), wallet.request({ method: 'eth_chainId' }),
  ]);
  if (BigInt(chain) !== BigInt(CHAIN) || !accounts[0] || getAddress(accounts[0]) !== sender || !stillConnected()) {
    throw new Error('Wallet or network changed. Reconnect to continue.');
  }
  const hash = await wallet.request({
    method: 'eth_sendTransaction', params: [{ from: sender, to: target, data, chainId: '0xaa36a7', value: '0x0' }],
  });
  if (!isHexString(hash, 32)) throw new Error('Wallet did not return a valid transaction hash.');
  return hash;
}

export function waitForLiveReceipt(wallet, hash) {
  return new BrowserProvider(wallet).waitForTransaction(hash, 2, 120_000);
}
