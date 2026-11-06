const chainId = '0x7a6a';
const marker = '0x' + Array.from(new TextEncoder().encode('NAK PUBLIC WALLET TRACE FIXTURE'),
  byte => byte.toString(16).padStart(2, '0')).join('');
const status = document.querySelector('#status');
const connection = document.querySelector('#connection');
const connect = document.querySelector('#connect');
const probe = document.querySelector('#probe');
const wallet = window.ethereum;
let account, epoch = 0, busy = false;

function render() {
  connect.disabled = busy || Boolean(account);
  probe.disabled = busy || !account;
  connection.textContent = account ? account + ' · Disposable Anvil (31338)' : 'Wallet disconnected.';
}

function invalidate(message) {
  epoch++;
  account = undefined;
  status.textContent = message;
  render();
}

if (wallet?.isMetaMask) {
  wallet.on('accountsChanged', () => invalidate('MetaMask account changed. Connect the disposable wallet again.'));
  wallet.on('chainChanged', () => invalidate('MetaMask network changed. Select chain 31338 and connect again.'));
  wallet.on('disconnect', () => invalidate('MetaMask disconnected. Connect the disposable wallet again.'));
} else {
  status.textContent = 'MetaMask unavailable. Open the probe in your disposable MetaMask profile.';
}
render();

const network = () => wallet.request({ method: 'eth_chainId' });
const accounts = () => wallet.request({ method: 'eth_accounts' });
const validAddress = value => /^0x[0-9a-f]{40}$/i.test(value ?? '');

connect.onclick = async event => {
  if (!event.isTrusted || busy || account || !wallet?.isMetaMask) return;
  busy = true;
  render();
  let failure = 'Select the disposable local chain 31338 in MetaMask.';
  let checkedEpoch = epoch;
  try {
    if (await network() !== chainId || checkedEpoch !== epoch) throw new Error();
    failure = 'MetaMask could not grant account access.';
    await wallet.request({ method: 'eth_requestAccounts' });
    // Granting permission can itself emit accountsChanged.
    checkedEpoch = epoch;
    failure = 'Select chain 31338 and unlock a disposable account in MetaMask.';
    const [from] = await accounts();
    if (await network() !== chainId || !validAddress(from) || checkedEpoch !== epoch) throw new Error();
    account = from;
    status.textContent = 'Disposable wallet connected. Open the prompt separately, then reject it.';
  } catch (error) {
    if (checkedEpoch === epoch) {
      status.textContent = error?.code === 4001 ? 'Wallet connection rejected.' : failure;
    }
  } finally {
    busy = false;
    render();
  }
};

probe.onclick = async event => {
  if (!event.isTrusted || busy || !account) return;
  const from = account;
  const checkedEpoch = epoch;
  busy = true;
  render();
  let failure = 'Could not read the disposable account nonce.';
  try {
    const nonce = await wallet.request({ method: 'eth_getTransactionCount', params: [from, 'pending'] });
    if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(nonce ?? '')) throw new Error();
    failure = 'Could not verify the disposable account and network. Connect again.';
    const [selected] = await accounts();
    if (await network() !== chainId || selected?.toLowerCase() !== from.toLowerCase() || checkedEpoch !== epoch) {
      if (checkedEpoch === epoch) invalidate(failure);
      return;
    }
    failure = 'MetaMask did not accept the disposable transaction request.';
    status.textContent = 'Wallet request started. Reject the prompt.';
    await wallet.request({ method: 'eth_sendTransaction', params: [{
      from, to: from, chainId, nonce, data: marker, value: '0x0',
      gas: '0x10000', maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x1',
    }] });
    status.textContent = 'Unexpected wallet success. Discard this run.';
  } catch (error) {
    if (checkedEpoch === epoch) status.textContent = error?.code === 4001 ? 'Rejected by owner.' : failure;
  } finally {
    busy = false;
    render();
  }
};
