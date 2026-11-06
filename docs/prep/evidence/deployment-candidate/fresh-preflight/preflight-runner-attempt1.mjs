import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root='/home/l/EthMumbai2026/names-as-keys';
const m=await import(pathToFileURL(root+'/contracts/scripts/deployment_candidate/common.mjs'));
const {keccak256,sha256}=await import(pathToFileURL(root+'/contracts/node_modules/ethers/lib.esm/index.js'));
const {assertFreshness,assertSnapshotNonces}=await import(pathToFileURL(root+'/contracts/scripts/deployment_candidate/validation.mjs'));
const {factoryPrediction}=await import(pathToFileURL(root+'/contracts/scripts/deployment_candidate/prediction.mjs'));
const {buildCandidate}=await import(pathToFileURL(root+'/contracts/scripts/deployment_candidate/prepare.mjs'));
const out=path.join(m.OUT,'fresh-preflight');
const historical=path.join(m.REVIEW_OUT,'public-bindings.json'),old=await fs.readFile(historical);
try{
 const obs=await m.inspect();
 const deps=await m.load(),{inputs,interfaces,addresses}=deps;
 const call=m.makeCall(m.publicRPC,interfaces,addresses,obs.block);
 const baseline=await m.readJSON(path.join(root,'docs/prep/evidence/stage3e/current-sepolia.json'));
 const identities=await Promise.all(Object.entries(baseline.contracts).map(async([name,v])=>{
  const code=await m.publicRPC('eth_getCode',[v.address,obs.block]);m.need(code!=='0x'&&keccak256(code)===v.runtimeKeccak256,'CODE_DRIFT');return {name,address:v.address,codeHash:keccak256(code),match:true};
 }));
 obs.factoryLogic=(await call('VerifiableFactory','proxyLogic'))[0];
 const logicCode=await m.publicRPC('eth_getCode',[obs.factoryLogic,obs.block]);
 const proof=await m.readJSON(path.join(root,'docs/prep/evidence/stage3f-audit/semantic-runtime-reconciliation.json'));
 m.need(sha256(logicCode).slice(2)===proof.contracts.UUPSProxyLogic.patchedRuntimeSHA256,'LOGIC_DRIFT');
 obs.independentFactoryDerivation={};
 for(const name of ['R1','R2']){const d=factoryPrediction(addresses.VerifiableFactory,obs.factoryLogic,inputs.owner,inputs.salts[name]);m.need(d.address===obs.predictions[name],'PREDICTION_DRIFT');obs.independentFactoryDerivation[name]=d;}
 const collisions={};for(const [name,address] of Object.entries(obs.predictions)){const code=await m.publicRPC('eth_getCode',[address,obs.block]);m.need(code==='0x','PREDICTION_COLLISION');collisions[name]={address,code,empty:true};}
 m.need(BigInt(obs.accounts.owner.balanceWei)>=BigInt(inputs.fees.maxTotalWei),'OWNER_BUDGET');
 const original=await m.readJSON(path.join(root,'docs/prep/stage3f-audit/review-plan.json'));
 const latest=await m.publicRPC('eth_getBlockByNumber',['latest',false]);
 const latestNonce=await m.publicRPC('eth_getTransactionCount',[inputs.owner,'latest']);
 const pendingNonce=await m.publicRPC('eth_getTransactionCount',[inputs.owner,'pending']);
 m.need(BigInt(latestNonce)===BigInt(obs.nonce),'LATEST_NONCE_DRIFT');assertSnapshotNonces({...obs,pendingNonce});
 m.need((await m.publicRPC('eth_getBlockByNumber',[obs.block,false])).hash===obs.blockHash,'REORG');
 const nowSeconds=Date.now()/1000;
 const reference={number:obs.block,hash:obs.blockHash,timestamp:obs.timestamp};
 assertFreshness(reference,latest,inputs,{nowSeconds});
 m.need(BigInt(latest.baseFeePerGas)+1n<=BigInt(inputs.fees.maxFeePerGasWei),'BASE_FEE_CAP');
 const plan=await buildCandidate(deps,{...obs,pendingNonce},original,{latest,nowSeconds});
 const result={classification:'FRESH_READ_ONLY_PREFLIGHT_AT_PREPARATION_NOT_LIVE_AUTHORIZATION',preparedUTC:new Date(nowSeconds*1000).toISOString(),snapshot:reference,latestAtPreparation:{number:latest.number,hash:latest.hash,timestamp:latest.timestamp,baseFeePerGas:latest.baseFeePerGas},freshness:{wallAgeSeconds:nowSeconds-Number(BigInt(obs.timestamp)),blockAge:(BigInt(latest.number)-BigInt(obs.block)).toString(),maxAgeSeconds:inputs.expiry.maxAgeSeconds,maxAgeBlocks:inputs.expiry.maxAgeBlocks,passedAtPreparation:true},nonces:{snapshot:obs.nonce,latest:latestNonce,pending:pendingNonce,agreement:true},reviewedCodeIdentities:identities,proxyLogic:{address:obs.factoryLogic,sourceReconciledHashMatch:true},collisionChecks:collisions,ownerBudget:{balanceWei:obs.accounts.owner.balanceWei,approvedTotalCeilingWei:inputs.fees.maxTotalWei,sufficient:true},caps:{rentPassed:true,baseFeeBelowMaxFee:true,liveGasEstimates:{},exactPerStepFeeAndGasPackets:'DEFERRED; no estimate requested in this preflight'},liveExecutionAllowed:false,stage3F:'NO_GO'};
 for(const [name,data] of Object.entries({'public-bindings.json':obs,'review-plan.json':plan,'preflight-result.json':result}))await fs.writeFile(path.join(out,name),m.stringify(data));
 console.log('PASS: fresh unsigned packet; 16 reviewed runtimes plus factory logic matched; no live writes, gas estimates or private-session input');
}catch(e){await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({status:'BLOCKED',reason:String(e.message).slice(0,160),liveExecutionAllowed:false},null,2));console.error('BLOCKED: fresh read-only preflight failed');process.exitCode=1;}
finally{await fs.writeFile(historical,old);}
