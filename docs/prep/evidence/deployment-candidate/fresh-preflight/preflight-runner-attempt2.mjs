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
 const deps=await m.load(),{inputs,interfaces,addresses}=deps;
 const block=await m.publicRPC('eth_blockNumber'),header=await m.publicRPC('eth_getBlockByNumber',[block,false]);
 const c=m.makeCall(m.publicRPC,interfaces,addresses,block),label=inputs.root.slice(0,-4);
 const [chain,available,state,quote,balance,allowance,nonce,pending,r1,r2,ownerCode,miraCode,ownerETH,miraETH,ethLink,regLink]=await Promise.all([
 m.publicRPC('eth_chainId'),c('ETHRegistrar','isAvailable',[label]),c('ETHRegistry','getState',[keccak256(new TextEncoder().encode(label))]),c('ETHRegistrar','getRegisterPrice',[label,inputs.expiry.rootDurationSeconds,addresses.MockUSDC]),c('MockUSDC','balanceOf',[inputs.owner]),c('MockUSDC','allowance',[inputs.owner,addresses.ETHRegistrar]),m.publicRPC('eth_getTransactionCount',[inputs.owner,block]),m.publicRPC('eth_getTransactionCount',[inputs.owner,'pending']),c('VerifiableFactory','predictProxyAddress',[inputs.owner,inputs.salts.R1]),c('VerifiableFactory','predictProxyAddress',[inputs.owner,inputs.salts.R2]),m.publicRPC('eth_getCode',[inputs.owner,block]),m.publicRPC('eth_getCode',[inputs.mira,block]),m.publicRPC('eth_getBalance',[inputs.owner,block]),m.publicRPC('eth_getBalance',[inputs.mira,block]),c('RootRegistry','getSubregistry',['eth']),c('ETHRegistrar','ETH_REGISTRY')]);
 m.need(BigInt(chain)===11155111n&&available[0]&&ownerCode==='0x'&&miraCode==='0x','CHAIN_ROOT_ACCOUNT');
 m.need(ethLink[0].toLowerCase()===addresses.ETHRegistry.toLowerCase()&&regLink[0].toLowerCase()===addresses.ETHRegistry.toLowerCase(),'REGISTRY_BINDING');
 const price=quote[0]+quote[1];m.need(price<=BigInt(inputs.spending.maxRentUnits),'RENT_CAP');
 const seq=m.noncePlan(nonce,balance[0]<price,allowance[0]!==price,inputs.owner);
 const obs={classification:'PUBLIC_READ_ONLY_CANDIDATE_SNAPSHOT_NOT_EXECUTION_AUTHORIZATION',block,blockNumber:BigInt(block).toString(),blockHash:header.hash,timestamp:header.timestamp,root:inputs.root,available:available[0],state:state[0].toArray(),priceUnits:price.toString(),baseUnits:quote[0].toString(),premiumUnits:quote[1].toString(),tokenBalanceUnits:balance[0].toString(),allowanceUnits:allowance[0].toString(),nonce,pendingNonce:pending,accounts:{owner:{address:inputs.owner,code:ownerCode,balanceWei:ownerETH},mira:{address:inputs.mira,code:miraCode,balanceWei:miraETH}},predictions:{R1:r1[0],R2:r2[0],CredentialRegistrar:seq.registrar,DoorKeys:seq.door},sequence:seq.steps,includeMint:balance[0]<price,includeApprove:allowance[0]!==price};
 m.need(r1[0]!==r2[0],'REGISTRY_COLLISION');
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
 const collisions=Object.fromEntries(await Promise.all(Object.entries(obs.predictions).map(async([name,address])=>{const code=await m.publicRPC('eth_getCode',[address,obs.block]);m.need(code==='0x','PREDICTION_COLLISION');return[name,{address,code,empty:true}];})));
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
