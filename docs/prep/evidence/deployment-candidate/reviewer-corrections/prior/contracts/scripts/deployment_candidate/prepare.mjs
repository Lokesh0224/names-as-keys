/** Public candidate packet overlay. Private preimages and live receipt fields stay null. */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { load,readJSON,stringify,ROOT,OUT,DOC,need } from './common.mjs';
const {inputs,interfaces,artifacts}=await load();
const observation=await readJSON(path.join(OUT,'public-bindings.json'));
const original=await readJSON(path.join(ROOT,'docs/prep/stage3f-audit/review-plan.json'));
const initial=interfaces.UserRegistryImpl.encodeFunctionData('initialize',[[{account:inputs.owner,roleBitmap:original.initializationRoleBitmap}]]);
const binding={
  'accounts.owner':inputs.owner,'accounts.guest':inputs.mira,'quote.basePlusPremium':observation.priceUnits,
  'salts.R1':inputs.salts.R1,'salts.R2':inputs.salts.R2,'encoded.initializeOwnerGrants':initial,
  ...Object.fromEntries(Object.entries(observation.predictions).map(([name,address])=>['future.'+name,address])),
};
function resolve(value){
  if(Array.isArray(value))return value.map(resolve);
  if(value&&typeof value==='object'){
    if(value.binding in binding)return {...value,value:binding[value.binding],classification:value.binding.startsWith('future.')?'PUBLIC_PREDICTION_REQUIRES_LIVE_RECEIPT':'APPROVED_CANDIDATE_STATIC_OR_SNAPSHOT_INPUT'};
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v)]));
  }return value;
}
function unbox(value){if(Array.isArray(value))return value.map(unbox);if(value&&typeof value==='object'&&('binding'in value||'reference'in value))return value.value;return value;}
const plan=resolve(original);
plan.approvedCheckpoint=inputs.checkpoint;plan.candidateApproval=inputs.classification;
plan.observationBlock=Number(observation.blockNumber);plan.observationBlockHash=observation.blockHash;
plan.futureAddresses=observation.predictions;plan.salts=inputs.salts;
plan.registrationSecret=null;plan.registrationCommitment=null;plan.lockExpiry=null;plan.guestExpiry=null;
plan.liveExecutionAllowed=false;delete plan.walletRequestsEnabled;plan.accountPermissionRequests='ONLY_TRUSTED_CONNECT_CLICK';plan.signatureRequestsEnabled=false;plan.transactionRequestsEnabled=false;plan.stage3F='NO_GO';
plan.bindingPolicy='Predictions are not deployment receipts. Constructor runtime token generations and absolute expiries must be rebound/read from confirmed live state. Never promote local simulation bindings into live receipt fields.';
for(const step of plan.transactions){
  const sequence=observation.sequence.find(s=>s.id===step.id);step.candidateNonce=sequence.nonce;step.conditionallyIncluded=sequence.included;
  step.finalCalldata=null;step.finalGasEstimate=null;step.liveReceipt=null;step.execution='DISABLED';
  step.remainingBindings=step.remainingBindings.filter(key=>!(key in binding));
  const args=step.arguments.map(unbox);
  const unknown=args.some(x=>x===null||x===undefined);
  if(step.id==='T01')args[1]=(BigInt(observation.priceUnits)>BigInt(observation.tokenBalanceUnits)?BigInt(observation.priceUnits)-BigInt(observation.tokenBalanceUnits):0n).toString();
  step.candidateCalldata=null;
  if(!unknown&&sequence.included){
    if(step.signature.startsWith('constructor('))step.candidateCalldata=artifacts[step.abi].bytecode.object+interfaces[step.abi].encodeDeploy(args).slice(2);
    else step.candidateCalldata=interfaces[step.abi].encodeFunctionData(step.signature,args);
  }
  step.candidateArguments=args;
  step.candidateBlockers=step.remainingBindings.length?step.remainingBindings:['All live prerequisite/receipt/source/nonce/fee checks and separate authorization still required'];
  if(step.id==='T03'||step.id==='T04'){need(step.candidateCalldata===null,'PRIVATE_PREIMAGE_EXPORT');step.privateInputPolicy='Future private session binding; never publish preimage or raw reveal calldata';}
  step.snapshotCandidate=(step.id==='T01'||step.id==='T02')&&sequence.included?{classification:'CURRENT_READ_ONLY_SNAPSHOT_CONDITIONAL_ON_FUTURE_RECHECK',signature:step.signature,arguments:args,transaction:{from:inputs.owner,to:unbox(step.target),value:'0x0',data:step.candidateCalldata}}:null;
}
await writeFile(path.join(DOC,'review-plan.json'),stringify(plan));
console.log('PASS: public unsigned candidate overlay encoded known inputs; six receipt/time/private steps remain unencoded; final/live fields remain null');
