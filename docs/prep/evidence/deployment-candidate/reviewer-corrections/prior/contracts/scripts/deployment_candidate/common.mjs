import { Interface, getCreateAddress, keccak256 } from 'ethers';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const OUT=path.join(ROOT,'docs/prep/evidence/deployment-candidate');
export const DOC=path.join(ROOT,'docs/prep/deployment-candidate');
export const UPSTREAM='https://sepolia.gateway.tenderly.co';
export const READ_METHODS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_getBalance','eth_getTransactionCount','eth_gasPrice']);
export const readJSON=async p=>JSON.parse(await readFile(p,'utf8'));
export const stringify=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
export const need=(v,m)=>{if(!v)throw new Error(m);};
export async function publicRPC(method,params=[]) {
  need(READ_METHODS.has(method),'Public RPC method not read-only');
  const response=await fetch(UPSTREAM,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(25000)});
  const result=await response.json();need(!result.error && 'result'in result,'Public read unavailable: '+method);return result.result;
}
export async function load() {
  const inputs=await readJSON(path.join(DOC,'APPROVED_INPUTS.json'));
  need(inputs.classification==='OWNER_APPROVED_CANDIDATE_DEFAULTS_NOT_LIVE_AUTHORIZATION'&&!inputs.liveExecutionAllowed,'Candidate approval/disabled execution required');
  const original=await readJSON(path.join(ROOT,'docs/prep/stage3e/deployment-manifest.json'));
  const addresses=Object.fromEntries(Object.entries(original.verifiedAddresses).map(([n,v])=>[n,v.value]));
  const abis={};for(const name of ['RootRegistry','ETHRegistry','ETHRegistrar','UserRegistryImpl','VerifiableFactory','MockUSDC','CredentialRegistrar','DoorKeys'])abis[name]=await readJSON(path.join(ROOT,'docs/prep/stage3e/abis',name+'.json'));
  const interfaces=Object.fromEntries(Object.entries(abis).map(([n,abi])=>[n,new Interface(abi)]));
  const artifacts={};for(const name of ['CredentialRegistrar','DoorKeys'])artifacts[name]=await readJSON(path.join(ROOT,'contracts/out',name+'.sol',name+'.json'));
  return {inputs,original,addresses,abis,interfaces,artifacts};
}
export const makeCall=(rpc,interfaces,addresses,block)=>(name,sig,args=[])=>rpc('eth_call',[{to:addresses[name],data:interfaces[name].encodeFunctionData(sig,args)},block]).then(raw=>interfaces[name].decodeFunctionResult(sig,raw));
export function noncePlan(nonce,includeMint,includeApprove,owner) {
  let next=BigInt(nonce);
  const steps=Array.from({length:15},(_,i)=>{const id='T'+String(i+1).padStart(2,'0');const included=(i!==0||includeMint)&&(i!==1||includeApprove);return{id,included,nonce:included?'0x'+(next++).toString(16):null};});
  return {steps,registrar:getCreateAddress({from:owner,nonce:steps[11].nonce}),door:getCreateAddress({from:owner,nonce:steps[13].nonce})};
}
export async function inspect() {
  const {inputs,addresses,interfaces,original}=await load();
  need(BigInt(await publicRPC('eth_chainId'))===11155111n,'Wrong upstream chain');
  const block='0x'+(BigInt(await publicRPC('eth_blockNumber'))-32n).toString(16);
  const header=await publicRPC('eth_getBlockByNumber',[block,false]);
  const call=makeCall(publicRPC,interfaces,addresses,block);
  const available=(await call('ETHRegistrar','isAvailable',[inputs.root.slice(0,-4)]))[0];
  need(available,'Approved root unavailable; stop without substitution');
  const state=(await call('ETHRegistry','getState',[keccak256(new TextEncoder().encode(inputs.root.slice(0,-4)))]))[0];
  const quote=await call('ETHRegistrar','getRegisterPrice',[inputs.root.slice(0,-4),inputs.expiry.rootDurationSeconds,addresses.MockUSDC]);
  const price=quote[0]+quote[1];need(price<=BigInt(inputs.spending.maxRentUnits),'Fresh quote exceeds approved cap');
  const tokenBalance=(await call('MockUSDC','balanceOf',[inputs.owner]))[0],allowance=(await call('MockUSDC','allowance',[inputs.owner,addresses.ETHRegistrar]))[0];
  const nonce=await publicRPC('eth_getTransactionCount',[inputs.owner,block]),pendingNonce=await publicRPC('eth_getTransactionCount',[inputs.owner,'pending']);
  const records={};for(const name of ['RootRegistry','ETHRegistry','ETHRegistrar','VerifiableFactory','UserRegistryImpl','MockUSDC']){
    const code=await publicRPC('eth_getCode',[addresses[name],block]);
    records[name]={address:addresses[name],codeHash:keccak256(code),nonempty:code!=='0x'};
    need(records[name].nonempty,'Missing upstream code');
  }
  const baseline=await readJSON(path.join(ROOT,'docs/prep/evidence/stage3e/current-sepolia.json'));
  for(const [name,v]of Object.entries(records))need(v.codeHash===baseline.contracts[name].runtimeKeccak256,'Reviewed upstream code drift: '+name);
  need((await call('RootRegistry','getSubregistry',['eth']))[0].toLowerCase()===addresses.ETHRegistry.toLowerCase(),'ETH attachment drift');
  need((await call('ETHRegistrar','ETH_REGISTRY'))[0].toLowerCase()===addresses.ETHRegistry.toLowerCase(),'Registrar registry drift');
  const r1=(await call('VerifiableFactory','predictProxyAddress',[inputs.owner,inputs.salts.R1]))[0];
  const r2=(await call('VerifiableFactory','predictProxyAddress',[inputs.owner,inputs.salts.R2]))[0];
  need(r1!==r2,'Registry prediction collision');
  const predictedCode={R1:await publicRPC('eth_getCode',[r1,block]),R2:await publicRPC('eth_getCode',[r2,block])};
  need(Object.values(predictedCode).every(x=>x==='0x'),'Predicted registry already deployed; stop');
  const accounts={};for(const [name,address]of Object.entries({owner:inputs.owner,mira:inputs.mira})){
    accounts[name]={address,code:await publicRPC('eth_getCode',[address,block]),balanceWei:await publicRPC('eth_getBalance',[address,block])};need(accounts[name].code==='0x','EOA model changed');
  }
  const includeMint=tokenBalance<price,includeApprove=allowance!==price;
  const plan=noncePlan(nonce,includeMint,includeApprove,inputs.owner);
  const observed={classification:'PUBLIC_READ_ONLY_CANDIDATE_SNAPSHOT_NOT_EXECUTION_AUTHORIZATION',block,blockNumber:BigInt(block).toString(),blockHash:header.hash,timestamp:header.timestamp,observedUTC:new Date().toISOString(),root:inputs.root,available,state:state.toArray(),priceUnits:price,baseUnits:quote[0],premiumUnits:quote[1],tokenBalanceUnits:tokenBalance,allowanceUnits:allowance,nonce,pendingNonce,nonceStableAtObservation:nonce===pendingNonce,accounts,upstream:records,predictions:{R1:r1,R2:r2,CredentialRegistrar:plan.registrar,DoorKeys:plan.door},predictedRegistryCode:predictedCode,sequence:plan.steps,includeMint,includeApprove,directCreateCondition:'Exact starting nonce/prefix, no extra owner transactions, no replacement/cancellation changes; actual receipts must confirm every address',stage3F:'NO_GO'};
  need((await publicRPC('eth_getBlockByNumber',[block,false])).hash===header.hash,'Observation reorged');
  await writeFile(path.join(OUT,'public-bindings.json'),stringify(observed));
  console.log('PASS: read-only public candidate predictions and snapshot written; no secret, wallet or write RPC used');
  return observed;
}
