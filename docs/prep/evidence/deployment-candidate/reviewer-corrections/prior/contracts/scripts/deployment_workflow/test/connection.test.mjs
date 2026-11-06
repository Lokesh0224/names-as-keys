import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionOnlyMetaMask } from '../connection.mjs';
const OWNER='0x40F6DcB0Fa311570f72aC6F64045EB80E66711F7';
const OTHER='0x5a9191871b9117218F83Ed43293E011667053F39';
const CLICK={testOnlyClick:true};
function provider() {
  return {testOnly:true,calls:[],accounts:[OWNER],chain:'0xaa36a7',listeners:new Map(),
    on(name,fn){this.listeners.set(name,fn);},removeListener(name){this.listeners.delete(name);},
    async request(args){this.calls.push(args); if(this.hook)await this.hook(args.method);
      if(args.method==='eth_requestAccounts'){if(this.reject)throw {code:4001};return this.accounts;}
      if(args.method==='eth_accounts')return [...this.accounts];if(args.method==='eth_chainId')return this.chain;
      throw new Error('Disallowed connection method');}};
}
test('constructor/page-load equivalent never requests accounts',()=>{const p=provider();new ConnectionOnlyMetaMask(p,OWNER);assert.equal(p.calls.length,0);});
test('no user click or untrusted synthetic DOM click cannot request permission',async()=>{const p=provider(),c=new ConnectionOnlyMetaMask(p,OWNER);for(const event of [undefined,{},new Event('click')])await assert.rejects(()=>c.connectFromClick(event),/trusted/);assert.equal(p.calls.length,0);});
test('test click marker cannot be used with a non-test provider',async()=>{const p=provider();p.testOnly=false;const c=new ConnectionOnlyMetaMask(p,OWNER);await assert.rejects(()=>c.connectFromClick(CLICK),/trusted/);assert.equal(p.calls.length,0);});
test('connection accepts selected owner/Sepolia without signing or sending',async()=>{const p=provider(),c=new ConnectionOnlyMetaMask(p,OWNER);const result=await c.connectFromClick(CLICK);assert.equal(result.status,'VERIFIED');assert.equal(result.execution,'DISABLED');assert.deepEqual([...new Set(p.calls.map(x=>x.method))],['eth_requestAccounts','eth_accounts','eth_chainId']);});
test('wrong selected owner fails connection verification',async()=>{const p=provider();p.accounts=[OTHER];assert.equal((await new ConnectionOnlyMetaMask(p,OWNER).connectFromClick(CLICK)).status,'WRONG_ACCOUNT');});
test('wrong network fails without requesting a network switch',async()=>{const p=provider();p.chain='0x1';assert.equal((await new ConnectionOnlyMetaMask(p,OWNER).connectFromClick(CLICK)).status,'WRONG_NETWORK');assert.ok(p.calls.every(x=>!x.method.startsWith('wallet_')));});
test('permission rejection is recorded without retry',async()=>{const p=provider();p.reject=true;assert.equal((await new ConnectionOnlyMetaMask(p,OWNER).connectFromClick(CLICK)).status,'REJECTED');assert.equal(p.calls.length,1);});
test('context changes invalidate previously verified connection without more RPC',async()=>{const p=provider(),c=new ConnectionOnlyMetaMask(p,OWNER);await c.connectFromClick(CLICK);const n=p.calls.length;for(const name of ['accountsChanged','chainChanged','disconnect']){p.listeners.get(name)();assert.equal(c.result.status,'INVALIDATED');assert.equal(p.calls.length,n);}});
test('chain change during identity reads cannot verify stale context',async()=>{const p=provider(),c=new ConnectionOnlyMetaMask(p,OWNER);let once=false;p.hook=method=>{if(method==='eth_accounts'&&!once){once=true;p.listeners.get('chainChanged')();}};assert.equal((await c.connectFromClick(CLICK)).status,'INVALIDATED');});
test('concurrent connect clicks produce one permission request',async()=>{const p=provider(),c=new ConnectionOnlyMetaMask(p,OWNER);let release;p.hook=method=>method==='eth_requestAccounts'?new Promise(r=>release=r):undefined;const first=c.connectFromClick(CLICK);await assert.rejects(()=>c.connectFromClick(CLICK),/pending/);release();await first;assert.equal(p.calls.filter(x=>x.method==='eth_requestAccounts').length,1);});
