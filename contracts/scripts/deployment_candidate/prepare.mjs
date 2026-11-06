/** Public candidate builder. Usability requires matching nonces and a fresh live review. */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load,readJSON,stringify,ROOT,REVIEW_OUT,DOC,need } from './common.mjs';
import { assertSnapshotNonces,assertFreshness } from './validation.mjs';
import { securityPolicy } from './security_policy.mjs';
export async function buildCandidate(deps,observation,original,{mode='LIVE_REVIEW',latest,nowSeconds=Date.now()/1000}={}){
  const {inputs,interfaces,artifacts}=deps;
  assertSnapshotNonces(observation);
  const reference={number:observation.block,hash:observation.blockHash,timestamp:observation.timestamp};
  assertFreshness(reference,latest,inputs,{mode,nowSeconds});
  const policy=await securityPolicy(deps.original);
  const deficit=BigInt(observation.priceUnits)>BigInt(observation.tokenBalanceUnits)?BigInt(observation.priceUnits)-BigInt(observation.tokenBalanceUnits):0n;
  const initial=interfaces.UserRegistryImpl.encodeFunctionData('initialize',[[{account:inputs.owner,roleBitmap:policy.ownerRootRoles}]]);
  const bindings={ 'accounts.owner':inputs.owner,'accounts.guest':inputs.mira,'quote.basePlusPremium':observation.priceUnits,'quote.tokenDeficit':deficit.toString(),
    'salts.R1':inputs.salts.R1,'salts.R2':inputs.salts.R2,'encoded.initializeOwnerGrants':initial,...Object.fromEntries(Object.entries(observation.predictions).map(([n,a])=>['future.'+n,a]))};
  function resolve(v){if(Array.isArray(v))return v.map(resolve);if(v&&typeof v==='object'){if(v.binding in bindings)return {...v,value:bindings[v.binding],classification:v.binding.startsWith('future.')?'PUBLIC_PREDICTION_REQUIRES_LIVE_RECEIPT':'APPROVED_CANDIDATE_STATIC_OR_SNAPSHOT_INPUT'};return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)]));}return v;}
  const unbox=v=>Array.isArray(v)?v.map(unbox):v&&typeof v==='object'&&('binding'in v||'reference'in v)?v.value:v;
  const plan=resolve(original);
  plan.approvedCheckpoint=inputs.checkpoint;plan.candidateApproval=inputs.classification;
  plan.observationBlock=Number(observation.blockNumber);plan.observationBlockHash=observation.blockHash;
  plan.snapshot={number:observation.block,hash:observation.blockHash,timestamp:observation.timestamp,nonce:observation.nonce,pendingNonce:observation.pendingNonce};
  plan.preparationContext=mode;plan.usableForFreshLiveReview=mode==='LIVE_REVIEW';plan.reviewContext={latest,reviewedAtSeconds:nowSeconds};
  plan.preparationStatus=mode==='LIVE_REVIEW'?'FRESH_REVIEW_ONLY_NO_WRITE_AUTHORIZATION':'HISTORICAL_FORK_ONLY_NOT_LIVE_USABLE';
  plan.futureAddresses=observation.predictions;plan.salts=inputs.salts;
  plan.registrationSecret=null;plan.registrationCommitment=null;plan.lockExpiry=null;plan.guestExpiry=null;
  plan.liveExecutionAllowed=false;delete plan.walletRequestsEnabled;plan.accountPermissionRequests='ONLY_TRUSTED_CONNECT_CLICK';plan.signatureRequestsEnabled=false;plan.transactionRequestsEnabled=false;plan.stage3F='NO_GO';
  plan.bindingPolicy='Live use requires a fresh canonical snapshot/pending-nonce agreement, re-review and actual live receipt bindings. Historical/local fork state is not live review.';
  for(const step of plan.transactions){
    const sequence=observation.sequence.find(s=>s.id===step.id);need(sequence,'MISSING_SEQUENCE_STEP');
    need(sequence.included===(step.id==='T01'?deficit>0n:step.id==='T02'?BigInt(observation.allowanceUnits)!==BigInt(observation.priceUnits):true),'SNAPSHOT_INCLUSION_DISAGREEMENT');
    step.candidateNonce=sequence.nonce;step.conditionallyIncluded=sequence.included;
    step.finalCalldata=null;step.finalGasEstimate=null;step.liveReceipt=null;step.execution='DISABLED';
    step.remainingBindings=step.remainingBindings.filter(key=>!(key in bindings));
    if(step.id==='T01')step.arguments[1]={binding:'quote.tokenDeficit',value:deficit.toString(),classification:'EXACT_SNAPSHOT_TOKEN_DEFICIT'};
    const args=step.arguments.map(unbox);step.candidateArguments=args;
    step.candidateDestination=step.signature.startsWith('constructor(')?null:unbox(step.target);
    step.candidateCreationAddress=step.signature.startsWith('constructor(')?observation.predictions[step.abi]:null;
    step.candidateValueWei='0x0';step.candidateChainId='0x'+policy.chainId.toString(16);
    step.candidateCalldata=null;
    if(!args.some(x=>x===null||x===undefined)&&sequence.included)step.candidateCalldata=step.signature.startsWith('constructor(')?artifacts[step.abi].bytecode.object+interfaces[step.abi].encodeDeploy(args).slice(2):interfaces[step.abi].encodeFunctionData(step.signature,args);
    step.candidateBlockers=step.remainingBindings.length?step.remainingBindings:['All live prerequisite/receipt/source/nonce/fee checks and separate authorization still required'];
    if(step.id==='T03'||step.id==='T04'){need(step.candidateCalldata===null,'PRIVATE_PREIMAGE_EXPORT');step.privateInputPolicy='Private session binding, never publish preimage or raw reveal calldata';}
    step.snapshotCandidate=(step.id==='T01'||step.id==='T02')&&sequence.included?{classification:'SNAPSHOT_ONLY_REQUIRES_FRESH_LIVE_REVIEW',signature:step.signature,arguments:args,transaction:{from:inputs.owner,to:step.candidateDestination,value:'0x0',data:step.candidateCalldata}}:null;
  }
  return plan;
}
async function main(){
  const deps=await load(),observation=await readJSON(path.join(REVIEW_OUT,'public-bindings.json'));
  const original=await readJSON(path.join(ROOT,'docs/prep/stage3f-audit/review-plan.json'));
  // Full live freshness/canonical reads are made at preparation time, not inferred from an old file.
  const {publicRPC}=await import('./common.mjs');
  assertSnapshotNonces(observation);
  need(Date.now()/1000-Number(BigInt(observation.timestamp))<=Number(deps.inputs.expiry.maxAgeSeconds),'REVIEW_WALL_TIME_AGE');
  const latest=await publicRPC('eth_getBlockByNumber',['latest',false]);
  const pendingNonce=await publicRPC('eth_getTransactionCount',[deps.inputs.owner,'pending']);
  assertSnapshotNonces({...observation,pendingNonce});
  const canonical=await publicRPC('eth_getBlockByNumber',[observation.block,false]);need(canonical.hash===observation.blockHash,'PREPARATION_SNAPSHOT_REORG');
  const plan=await buildCandidate(deps,{...observation,pendingNonce},original,{latest});
  await writeFile(path.join(DOC,'review-plan.json'),stringify(plan));
  await writeFile(path.join(REVIEW_OUT,'review-plan.json'),stringify(plan));
  console.log('PASS: canonical fresh review and matching nonces; public plan prepared, no live write authorization');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{await main();}catch{
  const blocked={preparationStatus:'BLOCKED',usableForFreshLiveReview:false,liveExecutionAllowed:false,stage3F:'NO_GO',transactions:[],reason:'Preparation failed; refresh canonical snapshot and pending nonce. No previous usable packet retained.'};
  await writeFile(path.join(DOC,'review-plan.json'),stringify(blocked));
  await writeFile(path.join(REVIEW_OUT,'preparation-blocked.json'),stringify(blocked));
  console.error('BLOCKED: no usable candidate prepared; snapshot/nonce/freshness validation required');process.exitCode=1;
 }
}
