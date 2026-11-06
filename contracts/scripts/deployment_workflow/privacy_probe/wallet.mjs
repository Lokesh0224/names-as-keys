const chainId = '0x7a6a';
const marker = '0x' + Array.from(new TextEncoder().encode('NAK PUBLIC WALLET TRACE FIXTURE'),
  byte => byte.toString(16).padStart(2, '0')).join('');
const status = document.querySelector('#status');
const button = document.querySelector('#probe');

button.onclick = async event => {
  if (!event.isTrusted) return;
  button.disabled = true;
  let failure = 'MetaMask unavailable.';
  try {
    const wallet = window.ethereum;
    if (!wallet?.isMetaMask) throw new Error();
    const network = () => wallet.request({ method: 'eth_chainId' });
    failure = 'Select the disposable local chain 31338 in MetaMask.';
    if (await network() !== chainId) throw new Error();
    failure = 'Connect a disposable account through MetaMask first.';
    const [from] = await wallet.request({ method: 'eth_accounts' });
    if (!from || !/^0x[0-9a-f]{40}$/i.test(from)) throw new Error();
    failure = 'Could not read the disposable account nonce.';
    const nonce = await wallet.request({ method: 'eth_getTransactionCount', params: [from, 'pending'] });
    if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(nonce ?? '')) throw new Error();
    failure = 'Could not confirm the disposable network before opening the wallet.';
    if (await network() !== chainId) throw new Error();
    failure = 'MetaMask did not accept the disposable transaction request.';
    status.textContent = 'Wallet request started. Reject the prompt.';
    await wallet.request({ method: 'eth_sendTransaction', params: [{
      from, to: from, chainId, nonce, data: marker, value: '0x0',
      gas: '0x10000', maxFeePerGas: '0x77359400', maxPriorityFeePerGas: '0x1',
    }] });
    status.textContent = 'Unexpected wallet success. Discard this run.';
  } catch (error) {
    status.textContent = error?.code === 4001 ? 'Rejected by owner.' :
      failure;
  } finally { button.disabled = false; }
};
