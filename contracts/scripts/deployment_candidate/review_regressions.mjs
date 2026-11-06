import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import path from 'node:path';
import { load,readJSON,ROOT,OUT,DOC } from './common.mjs';
import { buildCandidate } from './prepare.mjs';
import { assertFreshness,assertGuestMargin,assertSnapshotNonces,gasLimit,assertInclusion,comparePlannedTransaction,verifyMinedTransaction } from './validation.mjs';
import { securityPolicy } from './security_policy.mjs';
const deps=await load(),baseline=await readJSON(path.join(OUT,'public-bindings.json'));
const original=await readJSON(path.join(ROOT,'docs/prep/stage3f-audit/review-plan.json'));
const clone=x=>structuredClone(x);
const reference={number:baseline.block,hash:baseline.blockHash,timestamp:baseline.timestamp};
const historical={mode:'HISTORICAL_FORK',latest:reference};
function txFor(plan,id){const s=plan.transactions.find(x=>x.id===id);return{from:deps.inputs.owner,to:s.candidateDestination??undefined,data:s.candidateCalldata,nonce:s.candidateNonce,value:s.candidateValueWei,chainId:s.candidateChainId,gas:'0x10000',maxFeePerGas:'0x64',maxPriorityFeePerGas:'0x1'};}

test('T01 partial token balance is the exact deficit in every display and calldata representation',async()=>{
 const snapshot=clone(baseline);snapshot.tokenBalanceUnits='3000000';snapshot.includeMint=true;
 const p=await buildCandidate(deps,snapshot,original,historical),s=p.transactions[0];
 const expected=(BigInt(snapshot.priceUnits)-3000000n).toString();
 assert.equal(s.arguments[1].value,expected);assert.equal(s.candidateArguments[1],expected);assert.equal(s.snapshotCandidate.arguments[1],expected);
 assert.equal(deps.interfaces.MockUSDC.decodeFunctionData(s.signature,s.candidateCalldata)[1],BigInt(expected));
});
test('candidate preparation rejects nonce disagreement even if the recorded stability boolean lies',async()=>{
 const snapshot=clone(baseline);snapshot.pendingNonce='0x33';snapshot.nonceStableAtObservation=true;
 await assert.rejects(()=>buildCandidate(deps,snapshot,original,historical),/NONCE_DISAGREEMENT/);
});
test('old fork snapshot is explicitly not usable as a fresh live review',async()=>{
 const p=await buildCandidate(deps,baseline,original,historical);assert.equal(p.usableForFreshLiveReview,false);assert.equal(p.preparationStatus,'HISTORICAL_FORK_ONLY_NOT_LIVE_USABLE');
 await assert.rejects(()=>buildCandidate(deps,baseline,original,{mode:'LIVE_REVIEW',latest:reference,nowSeconds:Number(BigInt(reference.timestamp))+121}),/WALL_TIME/);
});
test('freshness uses approved block and second limits including stricter custom values',()=>{
 const inputs=clone(deps.inputs);inputs.expiry.maxAgeBlocks=1;inputs.expiry.maxAgeSeconds=5;
 const current={...reference,number:'0x'+(BigInt(reference.number)+2n).toString(16)};assert.throws(()=>assertFreshness(reference,current,inputs,{mode:'HISTORICAL_FORK'}),/BLOCK_AGE/);
 assert.throws(()=>assertFreshness(reference,{...reference,timestamp:'0x'+(BigInt(reference.timestamp)+6n).toString(16)},inputs,{mode:'HISTORICAL_FORK'}),/CHAIN_TIME/);
});
test('guest margin enforces configured600 seconds, and a changed approved margin is honored',()=>{
 assertGuestMargin(1600,1000,deps.inputs);assert.throws(()=>assertGuestMargin(1599,1000,deps.inputs),/GUEST_MARGIN/);
 const inputs=clone(deps.inputs);inputs.expiry.guestMinimumRemainingSeconds=900;assert.throws(()=>assertGuestMargin(1600,1000,inputs),/GUEST_MARGIN/);
});
test('gas multiplier comes from approved configuration rather than a hardcoded120 percent',()=>{
 const inputs=clone(deps.inputs);inputs.fees.gasLimitMultiplierPercent=150;assert.equal(gasLimit(101,inputs),152n);
 inputs.fees.maxGasPerStep='151';assert.throws(()=>gasLimit(101,inputs),/GAS_CAP/);
});
test('security policy agrees with source and rejects a broadened owner grant',async()=>{
 const p=await securityPolicy(deps.original);assert.equal(p.registrarRoles,4097n);
 const altered=clone(deps.original);altered.roles.OWNER_OPERATIONS_AND_ADMINS=(BigInt(altered.roles.OWNER_OPERATIONS_AND_ADMINS)|(1n<<124n)).toString();
 await assert.rejects(()=>securityPolicy(altered),/SECURITY_POLICY_MISMATCH/);
});
test('plan comparison rejects inclusion, nonce, destination and value drift',async()=>{
 const p=await buildCandidate(deps,baseline,original,historical),tx=txFor(p,'T01'),args=p.transactions[0].candidateArguments;
 assert.throws(()=>assertInclusion(p,'T01',false),/INCLUSION/);
 for(const edit of [t=>t.nonce='0x99',t=>t.to=deps.inputs.mira,t=>t.value='0x1']){const bad=clone(tx);edit(bad);assert.throws(()=>comparePlannedTransaction(p,'T01',bad,args,deps.interfaces,deps.artifacts));}
});
test('a consistently re-encoded but different amount cannot pass a frozen plan',async()=>{
 const p=await buildCandidate(deps,baseline,original,historical),tx=txFor(p,'T01');const args=[deps.inputs.owner,'1'];tx.data=deps.interfaces.MockUSDC.encodeFunctionData('mint',args);
 assert.throws(()=>comparePlannedTransaction(p,'T01',tx,args,deps.interfaces,deps.artifacts),/CALLDATA/);
});
test('deferred input requires the exact allowed fork provenance and exports no private value',async()=>{
 const p=await buildCandidate(deps,baseline,original,historical),s=p.transactions[2],value='0x'+'ab'.repeat(32),args=[value];
 const tx=txFor(p,'T03');tx.data=deps.interfaces.ETHRegistrar.encodeFunctionData(s.signature,args);
 assert.throws(()=>comparePlannedTransaction(p,'T03',tx,args,deps.interfaces,deps.artifacts),/SUBSTITUTION/);
 const r=comparePlannedTransaction(p,'T03',tx,args,deps.interfaces,deps.artifacts,{0:{binding:'registration.commitment',provenance:'PRIVATE_FORK_COMMITMENT',value}});
 assert.equal(r.forkOnlySubstitutions[0].valueExported,false);assert.equal(JSON.stringify(r).includes(value),false);
});
const submitted={from:deps.inputs.owner,to:deps.addresses.MockUSDC,data:'0x1234',nonce:'0x32',value:'0x0',chainId:'0xaa36a7',gas:'0x10000',maxFeePerGas:'0x64',maxPriorityFeePerGas:'0x1'};
const receipt={transactionHash:'0x'+'11'.repeat(32),blockHash:'0x'+'22'.repeat(32),to:submitted.to,gasUsed:'0x5208',effectiveGasPrice:'0x2'};
const mined={...submitted,input:submitted.data,hash:receipt.transactionHash,blockHash:receipt.blockHash};
test('all mined envelope fields are checked against submitted values',()=>{assert.ok(Object.values(verifyMinedTransaction(mined,receipt,submitted)).every(Boolean));});
for(const [field,value] of [['to',deps.inputs.mira],['value','0x1'],['chainId','0x1'],['gas','0x10001'],['maxFeePerGas','0x65'],['maxPriorityFeePerGas','0x2']])test('mined '+field+' mutation fails closed',()=>{assert.throws(()=>verifyMinedTransaction({...mined,[field]:value},receipt,submitted),/MINED_/);});

test('plan signer and owner must independently match transaction sender',async()=>{
 const p=await buildCandidate(deps,baseline,original,historical),tx=txFor(p,'T01'),args=p.transactions[0].candidateArguments;
 for(const mutate of [q=>q.transactions[0].signer.address=deps.inputs.mira,q=>q.owner=deps.inputs.mira]){
  const bad=clone(p);mutate(bad);assert.throws(()=>comparePlannedTransaction(bad,'T01',tx,args,deps.interfaces,deps.artifacts),/PLAN_SIGNER/);
 }
 assert.throws(()=>comparePlannedTransaction(p,'T01',{...tx,from:deps.inputs.mira},args,deps.interfaces,deps.artifacts),/PLAN_SIGNER/);
});
test('CREATE prediction and mined creation address are bound to the plan',async()=>{
 const p=await buildCandidate(deps,baseline,original,historical),s=p.transactions.find(x=>x.id==='T12'),tx=txFor(p,'T12');
 const args=s.candidateArguments,r=comparePlannedTransaction(p,'T12',tx,args,deps.interfaces,deps.artifacts);
 assert.equal(r.creationAddress,s.candidateCreationAddress);
 const bad=clone(p);bad.transactions.find(x=>x.id==='T12').candidateCreationAddress=deps.inputs.mira;
 assert.throws(()=>comparePlannedTransaction(bad,'T12',tx,args,deps.interfaces,deps.artifacts),/PLAN_CREATION_ADDRESS/);
 const cr={...receipt,to:null,contractAddress:r.creationAddress};
 const mt={...tx,to:null,input:tx.data,hash:cr.transactionHash,blockHash:cr.blockHash};
 verifyMinedTransaction(mt,cr,tx,r.creationAddress);
 assert.throws(()=>verifyMinedTransaction(mt,{...cr,contractAddress:deps.inputs.mira},tx,r.creationAddress),/MINED_PLAN_CREATION_ADDRESS/);
 assert.throws(()=>verifyMinedTransaction(mt,cr,tx),/MINED_PLAN_CREATION_ADDRESS/);
});
