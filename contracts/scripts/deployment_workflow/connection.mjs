import { getAddress } from 'ethers';

/** Account permission only. No generic provider/request, signing or submission API. */
export class ConnectionOnlyMetaMask {
  #provider; #busy = false; #epoch = 0; #closed = false; #handlers; #update;
  constructor(provider, expectedOwner, update = () => {}) {
    this.#provider = provider; this.owner = getAddress(expectedOwner); this.#update = update;
    this.result = { status: 'IDLE', execution: 'DISABLED', walletControlProof: 'NO_SIGNATURE_REQUESTED' };
    this.#handlers = Object.fromEntries(['accountsChanged','chainChanged','disconnect'].map(name => [name, () => {
      ++this.#epoch; this.#publish({ status: 'INVALIDATED', reason: name });
    }]));
    for (const [name,fn] of Object.entries(this.#handlers)) provider.on?.(name,fn);
  }
  #publish(value) { this.result = { ...value, execution: 'DISABLED', walletControlProof: 'NO_SIGNATURE_REQUESTED' }; this.#update({...this.result}); return {...this.result}; }
  async connectFromClick(event) {
    // Synthetic trusted-click construction belongs to Node test infrastructure only.
    const nativeClick = typeof Event !== 'undefined' && event instanceof Event && event.isTrusted === true && event.type === 'click';
    if (!nativeClick) throw new Error('Connect requires a trusted user click');
    if (this.#closed || this.#busy) throw new Error('Connection unavailable/already pending');
    this.#busy = true; this.#publish({status:'REQUESTING'});
    try {
      await this.#provider.request({method:'eth_requestAccounts'});
      // A permission grant may emit accountsChanged. Observe identity afterward.
      const epoch = this.#epoch;
      const accounts = await this.#provider.request({method:'eth_accounts'});
      const chain = await this.#provider.request({method:'eth_chainId'});
      const accountsAgain = await this.#provider.request({method:'eth_accounts'});
      const chainAgain = await this.#provider.request({method:'eth_chainId'});
      if (this.#closed || epoch !== this.#epoch || String(accounts[0]).toLowerCase() !== String(accountsAgain[0]).toLowerCase() || chain !== chainAgain) return this.#publish({status:'INVALIDATED',reason:'Identity changed during connection'});
      const selected = accountsAgain[0] ? getAddress(accountsAgain[0]) : null;
      const selectedChain = BigInt(chainAgain);
      const status = !selected || selected.toLowerCase() !== this.owner.toLowerCase() ? 'WRONG_ACCOUNT' : selectedChain !== 11155111n ? 'WRONG_NETWORK' : 'VERIFIED';
      return this.#publish({status,selectedAccount:selected,expectedOwner:this.owner,chainId:selectedChain.toString(),matchesOwner:selected?.toLowerCase()===this.owner.toLowerCase(),matchesSepolia:selectedChain===11155111n});
    } catch (error) {
      return this.#publish({status:error.code===4001?'REJECTED':'ERROR',code:Number.isInteger(error.code)?error.code:null});
    } finally { this.#busy = false; }
  }
  close() { this.#closed = true; ++this.#epoch; for (const [name,fn] of Object.entries(this.#handlers)) this.#provider.removeListener?.(name,fn); }
}
