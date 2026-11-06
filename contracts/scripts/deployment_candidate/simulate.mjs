import { privateEstimateHandler } from '../deployment_workflow/private_server.mjs';
import { privateEstimator } from '../deployment_workflow/private_transport.mjs';
import { createServer as httpServer } from 'node:http';
import { once } from 'node:events';
import { CandidateReview } from '../deployment_workflow/candidate.mjs';
import { loadCandidateBundle } from '../deployment_workflow/candidate_bundle.mjs';
import { comparePlannedTransaction,verifyMinedTransaction,assertInclusion,assertSnapshotNonces,assertFreshness,assertGuestMargin,gasLimit } from './validation.mjs';
import { securityPolicy } from './security_policy.mjs';
import { startUpstreamProxy } from './upstream_proxy.mjs';
/** Exact approved static candidate inputs, ephemeral owned Anvil fork only.
 * No private wallet keys, persistent node state, raw RPC transcript or preimage output.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { Interface, AbiCoder, id, keccak256, zeroPadValue, toBeHex, getCreateAddress, toQuantity,sha256 } from 'ethers';
import { load, readJSON, stringify, OUT,REVIEW_OUT, UPSTREAM, need } from './common.mjs';

const ZERO='0x'+'00'.repeat(20),ZERO32='0x'+'00'.repeat(32);

const LOCAL_METHODS=new Set(['web3_clientVersion','anvil_nodeInfo','eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_getBalance','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_estimateGas','eth_sendTransaction','anvil_impersonateAccount','anvil_mine']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,url,upstreamProxy,stage='BOOT',localCalls=0,candidate,privateServer;
const integrated=process.argv.includes('--candidate-workflow');
const result={classification:'ISOLATED_LOCAL_FORK_CANDIDATE_STATIC_INPUTS_NOT_LIVE_EXECUTION',stage3F:'NO_GO',steps:[],planComparisons:[],preimageHandling:'Fresh random32-byte fork-only preimage in RAM, never serialized; destroyed with processes; never reused live',liveReceipts:{},liveExecutionAllowed:false};

async function rpc(method,params=[]) {
  need(child && child.exitCode===null && url?.startsWith('http://127.0.0.1:') && LOCAL_METHODS.has(method),'LOCAL_TRANSPORT_GUARD');
  ++localCalls;
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(45000)});
  const data=await response.json();
  // Never propagate an RPC error message/stack; it can contain private calldata.
  if(data.error){const error=new Error('LOCAL_RPC_FAILED');error.rpcCode=data.error.code;throw error;}
  need('result'in data,'LOCAL_RPC_MISSING_RESULT');return data.result;
}
async function freePort(){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function main(){
  const deps=await load();const {inputs,addresses:a,interfaces:i,artifacts}=deps;
  const policy=await securityPolicy(deps.original);
  const GRANTS=policy.ownerRootRoles,ROOT_ROLES=policy.rootRegistrationRoles,LOCK_ROLES=policy.lockTokenRoles,LABEL_STORE=a.LabelStore;
  need(BigInt(inputs.confirmations.count)>0n&&inputs.confirmations.finalityTag==='finalized'&&BigInt(inputs.expiry.guestMinimumRemainingSeconds)>=60n&&BigInt(inputs.expiry.guestDurationSeconds)<=30n*86400n,'APPROVED_POLICY_LIMITS');
  const observation=await readJSON(path.join(REVIEW_OUT,'public-bindings.json'));
  const planPath=path.join(REVIEW_OUT,'review-plan.json'),plan=await readJSON(planPath);
  assertSnapshotNonces(observation);
  need(plan.transactions.length===15&&plan.snapshot.hash===observation.blockHash&&BigInt(plan.snapshot.nonce)===BigInt(observation.nonce),'PLAN_SNAPSHOT_MISMATCH');
  result.sourceReviewPlan={path:'docs/prep/evidence/deployment-candidate/reviewer-corrections/review-plan.json',sha256:sha256(await readFile(planPath)),preparationContext:plan.preparationContext,snapshot:plan.snapshot};
  result.simulationContext='HISTORICAL_FORK_FROM_IDENTIFIED_PLAN_SNAPSHOT_NOT_FRESH_LIVE_REVIEW';
  let visited=0;
  const visit=(id,included)=>{need(plan.transactions[visited++]?.id===id,'PLAN_ORDER');assertInclusion(plan,id,included);if(!included)result.planComparisons.push({id,included:false,verifiedSkip:true});};
  const proofs=await readJSON(path.join(OUT,'local-artifact-proof.json'));
  result.forkBlockNumber=observation.blockNumber;result.forkBlockHash=observation.blockHash;
  result.approvedStaticInputs={owner:inputs.owner,mira:inputs.mira,root:inputs.root,salts:inputs.salts,epoch:inputs.deploymentEpoch,rootDuration:inputs.expiry.rootDurationSeconds,lockDuration:inputs.expiry.lockDurationSeconds,guestDuration:inputs.expiry.guestDurationSeconds};
  upstreamProxy=await startUpstreamProxy();
  const port=await freePort();url='http://127.0.0.1:'+port;
  child=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--accounts','0','--quiet','--disable-console-log','--fork-url',upstreamProxy.url,'--fork-block-number',observation.blockNumber,'--chain-id','11155111','--hardfork','prague','--disable-min-priority-fee','--no-storage-caching',...(integrated?['--prune-history','2048']:['--max-persisted-states','0'])],{stdio:['ignore','pipe','pipe']});
  // Discard native output, including any unexpected trace/startup text, rather than persist secrets.
  child.stdout.resume();child.stderr.resume();child.on('error',()=>{});
  let ready=false;for(let n=0;n<120;n++){try{ready=BigInt(await rpc('eth_chainId'))===policy.chainId;if(ready)break;}catch{}await sleep(250);}
  need(ready,'ANVIL_NOT_READY');
  const client=await rpc('web3_clientVersion');need(client.toLowerCase().includes('anvil'),'NOT_ANVIL');
  result.nodeInfo={client,evmModel:'Prague; actual network fork-rule parity not independently attested',accountsGenerated:0,persistence:'disabled',upstream:'public read-only fork transport',ownedLoopbackOnly:true};
  const header=await rpc('eth_getBlockByNumber',[observation.block,false]);need(header.hash===observation.blockHash,'FORK_HEADER_DRIFT');
  need((await rpc('eth_getTransactionCount',[inputs.owner,'pending']))===observation.nonce,'FORK_NONCE_DRIFT');
  await rpc('anvil_impersonateAccount',[inputs.owner]);
  a.R1=observation.predictions.R1;a.R2=observation.predictions.R2;i.R1=i.UserRegistryImpl;i.R2=i.UserRegistryImpl;
  const label=inputs.root.slice(0,-4),rootHash=id(label),lockHash=id('lock'),guestHash=id('mira');
  const call=async(name,sig,args=[],block='latest')=>i[name].decodeFunctionResult(sig,await rpc('eth_call',[{to:a[name],data:i[name].encodeFunctionData(sig,args)},block]));
  const labelInterface=new Interface(['function getLabel(uint256) view returns(string)','event Label(bytes32 indexed labelHash,string label)']);
  const eventInterfaces={...i,LabelStore:labelInterface};
  need((await call('UserRegistryImpl','LABEL_STORE'))[0].toLowerCase()===LABEL_STORE.toLowerCase(),'LABEL_STORE_BINDING');
  const event=(name,sig,args,address=a[name])=>({address,signature:sig,...eventInterfaces[name].encodeEventLog(eventInterfaces[name].getEvent(sig),args)});
  const wasAbsent=async text=>labelInterface.decodeFunctionResult('getLabel',await rpc('eth_call',[{to:LABEL_STORE,data:labelInterface.encodeFunctionData('getLabel',[id(text)])},'latest']))[0]==='';
  let spentWorstCase=0n, reviewClock=0, registrationBytes, openCandidate, candidateJournal;
  if(integrated){
    const bundle=await loadCandidateBundle(REVIEW_OUT);
    const journal=new Map();candidateJournal=journal;
    privateServer=httpServer(privateEstimateHandler(bundle,async ({tx,header,secret})=>{
      upstreamProxy.protect(secret);
      need((await rpc('eth_getBlockByNumber',[header.number,false])).hash===header.hash,'PRIVATE_REFERENCE');
      return rpc('eth_estimateGas',[tx,header.number]);
    }));
    privateServer.listen(0,'127.0.0.1');
    await once(privateServer,'listening');
    const origin='http://127.0.0.1:'+privateServer.address().port;
    const privateEstimate=privateEstimator(new URL(origin),(route,options)=>fetch(origin+route,{
      ...options,headers:{...options.headers,origin},
    }));
    openCandidate=()=>new CandidateReview({
      provider:{request:({method,params})=>method==='eth_accounts'?[inputs.owner]:rpc(method,params)},
      bundle, storage:{getItem:key=>journal.get(key)??null,setItem:(key,value)=>journal.set(key,value)},
      now:()=>reviewClock,
      random:bytes=>{bytes.set(registrationBytes);return bytes;},
      privateEstimate,
    });
    candidate=openCandidate();
    result.recoveryChecks=[];
    result.integratedWorkflow=[];
  }
  async function transact(step,name,sig,args,{creation=false,expectedAddress,substitutions={},reviewReference,guestExpiry}={}){
    stage=step;visit(step,true);
    const nonce=await rpc('eth_getTransactionCount',[inputs.owner,'pending']);
    const planned=plan.transactions.find(s=>s.id===step);need(planned.conditionallyIncluded&&BigInt(nonce)===BigInt(planned.candidateNonce),'NONCE_PLAN_DRIFT');
    const head=await rpc('eth_getBlockByNumber',['latest',false]);
    const tip=1n,fee=BigInt(head.baseFeePerGas)*2n+tip;
    need(fee<=BigInt(inputs.fees.maxFeePerGasWei)&&tip<=BigInt(inputs.fees.maxPriorityFeePerGasWei),'FEE_CAP');
    const data=creation?artifacts[name].bytecode.object+i[name].encodeDeploy(args).slice(2):i[name].encodeFunctionData(sig,args);
    const tx={from:inputs.owner,data,nonce,value:'0x0',chainId:toQuantity(policy.chainId),maxFeePerGas:toQuantity(fee),maxPriorityFeePerGas:toQuantity(tip)};
    if(!creation)tx.to=a[name];
    const reference=reviewReference??head;
    const estimated=BigInt(await rpc('eth_estimateGas',[tx]));const gas=gasLimit(estimated,inputs);
    tx.gas=toQuantity(gas);
    spentWorstCase+=gas*fee;need(spentWorstCase<=BigInt(inputs.fees.maxTotalWei),'TOTAL_FEE_CAP');
    const beforeSend=await rpc('eth_getBlockByNumber',['latest',false]);
    assertFreshness(reference,beforeSend,inputs,{mode:'HISTORICAL_FORK'});
    need((await rpc('eth_getBlockByNumber',[reference.number,false])).hash===reference.hash,'REVIEW_REFERENCE_REORG');
    need(fee>=BigInt(beforeSend.baseFeePerGas)+tip,'FRESH_BASE_FEE');
    if(guestExpiry!==undefined)assertGuestMargin(guestExpiry,beforeSend.timestamp,inputs);
    const planComparison=comparePlannedTransaction(plan,step,tx,args,i,artifacts,substitutions);
    result.planComparisons.push({id:step,...planComparison});
    if(candidate){
      reviewClock=Number(BigInt(head.timestamp))*1000;
      const review=await candidate.prepare(step);
      need(review.calldataDigest===keccak256(data)&&BigInt(review.gasLimit)===gas&&BigInt(review.maxFeePerGasWei)===fee,'INTEGRATED_REVIEW_DRIFT');
      need(review.execution==='DISABLED','INTEGRATED_EXECUTION_GUARD');
      if(step==='T04'){
        const secret=args[2].slice(2).toLowerCase();
        const publicText=JSON.stringify([review,...candidateJournal.values()]).toLowerCase();
        need(review.unsignedTransaction.data==='[PRIVATE REVEAL]'&&!publicText.includes(secret)&&!publicText.includes(data.toLowerCase()),'PRIVATE_REDACTION');
        result.recoveryChecks.push({id:step,privateReviewAndJournalRedacted:true});
      }
    }
    const hash=await rpc('eth_sendTransaction',[tx]);
    let receipt;for(let n=0;n<120;n++){receipt=await rpc('eth_getTransactionReceipt',[hash]);if(receipt)break;await sleep(100);}
    need(receipt?.status==='0x1','LOCAL_TRANSACTION_FAILED');
    const mined=await rpc('eth_getTransactionByHash',[hash]);
    const minedComparison=verifyMinedTransaction(mined,receipt,tx,planComparison.creationAddress);
    if(creation)need(receipt.contractAddress.toLowerCase()===expectedAddress.toLowerCase()&&getCreateAddress({from:inputs.owner,nonce})===expectedAddress,'CREATE_PREDICTION_DRIFT');
    const mineCount=BigInt(inputs.confirmations.count)>64n?BigInt(inputs.confirmations.count):64n;
    await rpc('anvil_mine',[toQuantity(mineCount),'0x1']);
    const latest=await rpc('eth_getBlockByNumber',['latest',false]),finalized=await rpc('eth_getBlockByNumber',[inputs.confirmations.finalityTag,false]);
    need(BigInt(latest.number)>=BigInt(receipt.blockNumber)+BigInt(inputs.confirmations.count)-1n&&finalized&&BigInt(finalized.number)>=BigInt(receipt.blockNumber),'LOCAL_CONFIRMATION_FINALITY_MODEL');
    const canonical=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);need(canonical.hash===receipt.blockHash,'LOCAL_REORG');
    if(guestExpiry!==undefined)assertGuestMargin(guestExpiry,canonical.timestamp,inputs);
    const record={id:step,nonce,transactionHash:hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,gasUsed:receipt.gasUsed,gasLimit:gas,feeCeiling:fee,calldataDigest:keccak256(data),privateInputOmitted:step==='T03'||step==='T04',localOnly:true,planComparison,minedComparison,reviewReference:reference,configuredLimits:{gasMultiplierPercent:inputs.fees.gasLimitMultiplierPercent,confirmations:inputs.confirmations.count,maxAgeBlocks:inputs.expiry.maxAgeBlocks,maxAgeSeconds:inputs.expiry.maxAgeSeconds,guestMarginSeconds:guestExpiry!==undefined?inputs.expiry.guestMinimumRemainingSeconds:null},forkOnlyExecutionFields:['gas','maxFeePerGas','maxPriorityFeePerGas'],confirmationHead:latest.number,finalizedCoverage:finalized.number};
    result.steps.push(record);
    if(candidate){
      if(step==='T01'||step==='T04'){
        candidate.close();
        candidate=openCandidate();
      }
      const entry=await candidate.reconcile(step,hash);
      if(step==='T01'||step==='T04')result.recoveryChecks.push({id:step,reloadedBeforeReconciliation:true});
      if(step==='T04')need(!JSON.stringify([...candidateJournal.values()]).toLowerCase().includes(args[2].slice(2).toLowerCase()),'PRIVATE_RECOVERY_JOURNAL');
      if(step==='T03'){
        const reopened=openCandidate();
        try{
          await reopened.prepare('T04');
          throw new Error('LOST_PREIMAGE_ACCEPTED');
        }catch(error){need(error.message.includes('Registration session unavailable'),'LOST_PREIMAGE_GUARD');}
        finally{reopened.close();}
        result.recoveryChecks.push({id:'T04',lostPreimageBlocked:true});
      }
      need(entry.status==='CONFIRMED'&&entry.evidence.hash===hash,'INTEGRATED_RECEIPT');
      result.integratedWorkflow.push({id:step,status:entry.status,reviewDigest:entry.reviewDigest,receiptHash:hash});
    }
    return{receipt,record,header:canonical};
  }
  function checkEvents(context,expected){
    need(context.receipt.logs.length===expected.length,'EVENT_COUNT');
    expected.forEach((e,n)=>{const actual=context.receipt.logs[n];need(actual.address.toLowerCase()===e.address.toLowerCase()&&actual.data.toLowerCase()===e.data.toLowerCase()&&JSON.stringify(actual.topics.map(x=>x.toLowerCase()))===JSON.stringify(e.topics.map(x=>x.toLowerCase())),'EVENT_FIELDS_ORDER');});
    context.record.verifiedEvents=expected.map(e=>({emitter:e.address,signature:e.signature}));
  }
  const quote=await call('ETHRegistrar','getRegisterPrice',[label,inputs.expiry.rootDurationSeconds,a.MockUSDC]);let price=quote[0]+quote[1];need(price===BigInt(observation.priceUnits),'QUOTE_DRIFT');
  need((await call('ETHRegistrar','isAvailable',[label]))[0],'ROOT_UNAVAILABLE');
  const balanceBeforeMint=(await call('MockUSDC','balanceOf',[inputs.owner]))[0];
  if(balanceBeforeMint<price){const amount=price-balanceBeforeMint;const c=await transact('T01','MockUSDC','mint',[inputs.owner,amount]);checkEvents(c,[event('MockUSDC','Transfer',[ZERO,inputs.owner,amount])]);}else visit('T01',false);
  if((await call('MockUSDC','allowance',[inputs.owner,a.ETHRegistrar]))[0]!==price){const c=await transact('T02','MockUSDC','approve',[a.ETHRegistrar,price]);checkEvents(c,[event('MockUSDC','Approval',[inputs.owner,a.ETHRegistrar,price])]);}else visit('T02',false);
  const preimageBytes=randomBytes(32);registrationBytes=preimageBytes;let preimage='0x'+preimageBytes.toString('hex');upstreamProxy.protect(preimage);
  const commitment=(await call('ETHRegistrar','makeCommitment',[label,inputs.owner,preimage,ZERO,ZERO,inputs.expiry.rootDurationSeconds,ZERO32]))[0];
  const committed=await transact('T03','ETHRegistrar','commit',[commitment],{substitutions:{0:{binding:'registration.commitment',value:commitment,provenance:'PRIVATE_FORK_COMMITMENT'}}});checkEvents(committed,[event('ETHRegistrar','CommitmentMade',[commitment])]);
  const age=BigInt((await rpc('eth_getBlockByNumber',['latest',false])).timestamp)-BigInt(committed.header.timestamp);
  need(age>=BigInt((await call('ETHRegistrar','MIN_COMMITMENT_AGE'))[0])&&age<BigInt((await call('ETHRegistrar','MAX_COMMITMENT_AGE'))[0]),'COMMITMENT_WINDOW');
  const freshQuote=await call('ETHRegistrar','getRegisterPrice',[label,inputs.expiry.rootDurationSeconds,a.MockUSDC]);need(freshQuote[0]+freshQuote[1]===price,'REVEAL_QUOTE_DRIFT');
  const absentRoot=await wasAbsent(label);
  const registered=await transact('T04','ETHRegistrar','register',[label,inputs.owner,preimage,ZERO,ZERO,inputs.expiry.rootDurationSeconds,a.MockUSDC,ZERO32],{substitutions:{2:{binding:'privateRegistrationState.secret',value:preimage,provenance:'PRIVATE_FORK_PREIMAGE'}}});
  preimageBytes.fill(0);preimage=null; // No preimage is ever added to the result object.
  const root=(await call('ETHRegistry','getState',[rootHash]))[0];
  const beneficiary=(await call('ETHRegistrar','BENEFICIARY'))[0];
  const registrationEvents=(registry,text,state,owner,sender,roles,absent)=>{
    const list=[];if(absent)list.push(event('LabelStore','Label',[id(text),text],LABEL_STORE));
    list.push(event(registry,'LabelRegistered',[state.tokenId,id(text),text,owner,state.expiry,sender]));
    list.push(event(registry,'TransferSingle',[sender,ZERO,owner,state.tokenId,1]));
    list.push(event(registry,'TokenResource',[state.tokenId,state.resource]));
    if(roles)list.push(event(registry,'EACRolesChanged',[state.resource,owner,0,roles]));return list;
  };
  checkEvents(registered,[event('MockUSDC','Transfer',[inputs.owner,beneficiary,price]),...registrationEvents('ETHRegistry',label,root,inputs.owner,a.ETHRegistrar,ROOT_ROLES,absentRoot),event('ETHRegistrar','NameRegistered',[root.tokenId,label,inputs.owner,ZERO,ZERO,inputs.expiry.rootDurationSeconds,a.MockUSDC,ZERO32,freshQuote[0],freshQuote[1]])]);
  need(root.expiry===BigInt(registered.header.timestamp)+BigInt(inputs.expiry.rootDurationSeconds),'ROOT_EXPIRY');
  const initialize=i.UserRegistryImpl.encodeFunctionData('initialize',[[{account:inputs.owner,roleBitmap:GRANTS}]]);
  const renderer=(await call('UserRegistryImpl','URI_RENDERER'))[0];
  async function registry(step,name,salt){
    need(await rpc('eth_getCode',[a[name],'latest'])==='0x','PREDICTED_PROXY_NOT_EMPTY');
    const c=await transact(step,'VerifiableFactory','deployProxy',[a.UserRegistryImpl,salt,initialize]);
    const p=a[name];checkEvents(c,[event('UserRegistryImpl','Upgraded',[a.UserRegistryImpl],p),event('UserRegistryImpl','RegistryCreated',[],p),event('UserRegistryImpl','EACRolesChanged',[0,inputs.owner,0,GRANTS],p),event('UserRegistryImpl','URIUpdated',['',renderer,ZERO],p),event('UserRegistryImpl','Initialized',[1],p),event('VerifiableFactory','ProxyDeployed',[inputs.owner,p,salt,a.UserRegistryImpl])]);
    need((await call('VerifiableFactory','verifyContract',[p]))[0].toLowerCase()===a.UserRegistryImpl.toLowerCase(),'PROXY_IMPLEMENTATION');
    need((await rpc('eth_getCode',[p,'latest'])).toLowerCase()===observation.independentFactoryDerivation[name].runtime.toLowerCase(),'FULL_PROXY_RUNTIME_MISMATCH');
    need((await call(name,'roles',[0,inputs.owner]))[0]===GRANTS&&(await call(name,'roleCount',[0]))[0]===GRANTS,'ROOT_OWNER_ROLES');
  }
  await registry('T05','R1',inputs.salts.R1);
  const attachRoot=await transact('T06','ETHRegistry','setSubregistry',[root.tokenId,a.R1],{substitutions:{0:{binding:'receipts.rootTokenId',value:root.tokenId,provenance:'FORK_RECEIPT_T04',reference:{transactionHash:registered.receipt.transactionHash}}}});checkEvents(attachRoot,[event('ETHRegistry','SubregistryUpdated',[root.tokenId,a.R1,inputs.owner])]);
  const parent1=await transact('T07','R1','setParent',[a.ETHRegistry,label]);checkEvents(parent1,[event('R1','ParentUpdated',[a.ETHRegistry,label,inputs.owner])]);
  const lockReference=await rpc('eth_getBlockByNumber',['latest',false]);const lockExpiry=BigInt(lockReference.timestamp)+BigInt(inputs.expiry.lockDurationSeconds);need(lockExpiry<=root.expiry,'LOCK_EXPIRY_BOUND');
  const absentLock=await wasAbsent('lock');
  const lockRegistered=await transact('T08','R1','register',['lock',inputs.owner,ZERO,ZERO,LOCK_ROLES,lockExpiry],{reviewReference:lockReference,substitutions:{5:{binding:'inputs.lockExpiry',value:lockExpiry,provenance:'FORK_REVIEW_TIMESTAMP',reference:lockReference}}});
  const lock=(await call('R1','getState',[lockHash]))[0];checkEvents(lockRegistered,registrationEvents('R1','lock',lock,inputs.owner,inputs.owner,LOCK_ROLES,absentLock));
  await registry('T09','R2',inputs.salts.R2);
  const attachLock=await transact('T10','R1','setSubregistry',[lock.tokenId,a.R2],{substitutions:{0:{binding:'receipts.lockTokenId',value:lock.tokenId,provenance:'FORK_RECEIPT_T08',reference:{transactionHash:lockRegistered.receipt.transactionHash}}}});checkEvents(attachLock,[event('R1','SubregistryUpdated',[lock.tokenId,a.R2,inputs.owner])]);
  const parent2=await transact('T11','R2','setParent',[a.R1,'lock']);checkEvents(parent2,[event('R2','ParentUpdated',[a.R1,'lock',inputs.owner])]);
  async function deploy(step,name,args){const predicted=observation.predictions[name];need(await rpc('eth_getCode',[predicted,'latest'])==='0x','PREDICTED_CREATE_NOT_EMPTY');const c=await transact(step,name,'constructor',args,{creation:true,expectedAddress:predicted});a[name]=predicted;checkEvents(c,[]);return c;}
  await deploy('T12','CredentialRegistrar',[inputs.owner,label,a.R1,a.R2]);
  const grant=await transact('T13','R2','grantRootRoles',[policy.registrarRoles,a.CredentialRegistrar]);checkEvents(grant,[event('R2','EACRolesChanged',[0,a.CredentialRegistrar,0,policy.registrarRoles])]);
  await deploy('T14','DoorKeys',[inputs.owner,label,a.R1,a.R2,inputs.deploymentEpoch]);
  const guestReference=await rpc('eth_getBlockByNumber',['latest',false]);const guestExpiry=BigInt(guestReference.timestamp)+BigInt(inputs.expiry.guestDurationSeconds);need(guestExpiry<=lock.expiry,'GUEST_EXPIRY_BOUND');
  const absentGuest=await wasAbsent('mira');
  const issued=await transact('T15','CredentialRegistrar','issue',['mira',inputs.mira,guestExpiry],{reviewReference:guestReference,guestExpiry,substitutions:{2:{binding:'inputs.guestExpiry',value:guestExpiry,provenance:'FORK_REVIEW_TIMESTAMP',reference:guestReference}}});
  const guest=(await call('R2','getState',[guestHash]))[0];
  checkEvents(issued,[...registrationEvents('R2','mira',guest,inputs.mira,a.CredentialRegistrar,0n,absentGuest),event('CredentialRegistrar','CredentialIssued',[guestHash,guest.tokenId,inputs.mira,guestExpiry])]);
  need((await call('ETHRegistry','getSubregistry',[label]))[0].toLowerCase()===a.R1.toLowerCase()&&(await call('R1','getSubregistry',['lock']))[0].toLowerCase()===a.R2.toLowerCase(),'FORWARD_LINKS');
  const p1=await call('R1','getParent'),p2=await call('R2','getParent');need(p1[0].toLowerCase()===a.ETHRegistry.toLowerCase()&&p1[1]===label&&p2[0].toLowerCase()===a.R1.toLowerCase()&&p2[1]==='lock','BACK_LINKS');
  need((await call('ETHRegistry','getOwner',[rootHash]))[0].toLowerCase()===inputs.owner.toLowerCase()&&(await call('R1','getOwner',[lockHash]))[0].toLowerCase()===inputs.owner.toLowerCase()&&(await call('R2','getOwner',[guestHash]))[0].toLowerCase()===inputs.mira.toLowerCase(),'OWNERS');
  need((await call('R2','roles',[0,a.CredentialRegistrar]))[0]===policy.registrarRoles&&(await call('R2','roleCount',[guest.resource]))[0]===0n&&(await call('R2','roles',[0,inputs.mira]))[0]===0n&&(await call('R2','roles',[0,a.DoorKeys]))[0]===0n&&!(await call('R2','isEmancipated'))[0],'FINAL_ROLES');
  const doorId=keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','bytes32','bytes32','address','address','uint256','uint256','uint256'],[policy.chainId,a.DoorKeys,rootHash,lockHash,a.R1,a.R2,root.tokenId,lock.tokenId,inputs.deploymentEpoch]));
  for(const name of ['CredentialRegistrar','DoorKeys']){
    const expected={owner:inputs.owner,administrator:inputs.owner,parentRegistry:a.R1,guestRegistry:a.R2,rootTokenId:root.tokenId,lockTokenId:lock.tokenId,rootLabelHash:rootHash,deploymentEpoch:inputs.deploymentEpoch,doorId};
    const proof=proofs[name];let bytes=Buffer.from(proof.runtimeTemplate,'hex');
    for(const field of proof.immutableReferences){const value=expected[field.name];need(value!==undefined,'UNKNOWN_IMMUTABLE');const word=typeof value==='string'&&value.startsWith('0x')?zeroPadValue(value,32):zeroPadValue(toBeHex(value),32);for(const slot of field.slots){need(slot.length===32,'IMMUTABLE_WIDTH');Buffer.from(word.slice(2),'hex').copy(bytes,slot.start);}}
    const actual=await rpc('eth_getCode',[a[name],'latest']);need('0x'+bytes.toString('hex')===actual.toLowerCase(),'FULL_RUNTIME_MISMATCH');
    need((await call(name,'rootLabel'))[0]===label,'ROOT_LABEL_STORAGE');
  }
  need((await call('DoorKeys','doorId'))[0]===doorId&&(await call('DoorKeys','requestNonce'))[0]===0n,'DOOR_BINDING');
  await rpc('eth_call',[{from:inputs.mira,to:a.DoorKeys,data:i.DoorKeys.encodeFunctionData('unlock',['mira'])},'latest']);
  need((await call('DoorKeys','requestNonce'))[0]===0n,'ETH_CALL_PERSISTED');
  result.localBindings={addresses:{R1:a.R1,R2:a.R2,CredentialRegistrar:a.CredentialRegistrar,DoorKeys:a.DoorKeys},rootTokenId:root.tokenId,rootResource:root.resource,rootExpiry:root.expiry,lockTokenId:lock.tokenId,lockResource:lock.resource,lockExpiry,lockReference:{number:lockReference.number,hash:lockReference.hash,timestamp:lockReference.timestamp},guestTokenId:guest.tokenId,guestExpiry,guestReference:{number:guestReference.number,hash:guestReference.hash,timestamp:guestReference.timestamp},doorId};
  need(visited===plan.transactions.length&&result.planComparisons.length===plan.transactions.length,'PLAN_INVENTORY_INCOMPLETE');
  result.securityConstants=policy;
  result.verified={allPlanStepsCompared:true,configurableLimitsEnforced:true,minedTransactionFieldsVerified:true,allIncludedStepsSucceeded:true,exactEncodedInputsAndNonces:true,allReceiptEventsExact:true,confirmationAndFinalizedModel:true,hierarchyAndBothParentLinks:true,ownersRolesExpiries:true,fullProductionRuntimeBytes:true,fullProxyRuntimeBytes:true,readOnlyUnlockAcceptedNoPersistentEvent:true};
  result.totalReservedGasWei=spentWorstCase;result.localRpcCalls=localCalls;result.status='PASS';
}
try{await main();console.log('PASS: isolated candidate fork sequence completed; preimage withheld; no live writes or wallet requests');}
catch(error){result.status='BLOCKED';result.failure={stage,classification:'SANITIZED_LOCAL_SIMULATION_FAILURE',rpcCode:Number.isInteger(error.rpcCode)?error.rpcCode:null};console.error('BLOCKED: isolated candidate simulation failed at '+stage+'; private error details withheld');process.exitCode=1;}
finally{
  candidate?.close();
  if(privateServer){privateServer.closeAllConnections();await new Promise(resolve=>privateServer.close(resolve));}
  if(child && child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(2000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(child&&child.exitCode===null&&child.signalCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(1000)]);
  result.nodeStopped=!child||child.exitCode!==null||child.signalCode!==null;
  if(upstreamProxy){result.upstreamReadOnlyProxy=upstreamProxy.stats;await upstreamProxy.close();}await writeFile(integrated?path.join(OUT,'workflow-recovery','simulation-result.json'):path.join(REVIEW_OUT,'simulation-result.json'),stringify(result));
}
