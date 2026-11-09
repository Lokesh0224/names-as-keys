import { mkdir, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { keccak256, Transaction } from 'ethers';
import { STEP_IDS, CHAIN_ID } from './config.mjs';
import { createContext, need, same, atomicJSON, readJSON, stringify, loadSecret, removeSecret, withLock, confirmedReceipt } from './context.mjs';
import { STEPS } from './steps.mjs';
import { checkGasLimit, gasNumbers, isCreateStep } from './gas.mjs';
import { quoteFunding, fundingSummary, checkGasAndFunding, checkFunding } from './funding.mjs';

export function checkOrder(ctx,id) {
  const index=STEP_IDS.indexOf(id);need(index>=0,'Unknown step');
  const entries=ctx.journal.entries;
  need(entries.length<=15&&entries.every((e,i)=>e.step===STEP_IDS[i]&&['VERIFIED','SKIPPED'].includes(e.status)),'Journal is not an ordered verified prefix');
  need(index<=entries.length,'Previous step is not verified in sepolia.live.json');
}
export async function verifyRecorded(ctx,entry) {
  if(entry.status==='SKIPPED'){
    need(['T01','T02'].includes(entry.step),'Only T01/T02 may be skipped');
    const header=await ctx.provider.getBlock(entry.blockNumber);need(header?.hash===entry.blockHash,'Skipped observation lost canonicality');
    const before=ctx.blockTag;ctx.blockTag=entry.blockNumber;
    try {
      const actual=entry.step==='T01'?await ctx.read('MockUSDC','balanceOf',[ctx.owner]):await ctx.read('MockUSDC','allowance',[ctx.owner,ctx.addresses.ETHRegistrar]);
      need(entry.step==='T01'?actual>=BigInt(entry.facts.price):actual===BigInt(entry.facts.price),'Skipped step state mismatch');
    } finally {ctx.blockTag=before;}
    return;
  }
  const r=await confirmedReceipt(ctx,entry.txHash), tx=await ctx.provider.getTransaction(entry.txHash);
  need(r?.status===1&&tx&&r.blockHash===entry.blockHash&&r.blockNumber===entry.blockNumber,'Recorded receipt missing/reverted/replaced');
  need((await ctx.provider.getBlock(r.blockNumber))?.hash===r.blockHash,'Recorded receipt reorged');
  need(same(tx.from,ctx.owner)&&tx.chainId===CHAIN_ID&&keccak256(tx.data)===entry.envelope.dataHash&&String(tx.nonce)===entry.envelope.nonce&&same(tx.to??'',entry.envelope.to??'')&&String(tx.value)===entry.envelope.value,'Recorded mined envelope mismatch');
  const oldWork=ctx.work,oldTag=ctx.blockTag;ctx.work=entry.facts;ctx.blockTag=r.blockNumber;
  try {
    const derived=await STEPS[entry.step].verify(ctx,r);
    need(stringify(derived)===stringify(entry.derivedAddresses),'Recorded derived bindings differ from chain');
  } finally {ctx.work=oldWork;ctx.blockTag=oldTag;ctx.refresh();}
}
export async function verifyPrefix(ctx) {checkOrder(ctx,STEP_IDS[Math.min(ctx.journal.entries.length,14)]);for(const entry of ctx.journal.entries)await verifyRecorded(ctx,entry);}
export async function waitCommitAge(ctx) {
  const commit=ctx.derived.commitment;need(commit,'Verified T03 required before reveal wait');
  while(true){
    await ctx.identity();
    const at=await ctx.read('ETHRegistrar','commitmentAt',[commit]);
    need(at>0n&&String(at)===String(ctx.derived.commitmentAt),'Commitment changed during wait');
    const min=await ctx.read('ETHRegistrar','MIN_COMMITMENT_AGE'),max=await ctx.read('ETHRegistrar','MAX_COMMITMENT_AGE'),now=await ctx.time();
    need(now<at+max,'Commitment expired during wait');if(now>=at+min)return;
    ctx.log('Waiting for onchain minimum commitment age');await ctx.waitTick();
  }
}
async function append(ctx,entry) {ctx.journal.entries.push(entry);await atomicJSON(ctx.journalFile,ctx.journal);ctx.refresh();}
export async function sendOnce(ctx,label,signer,tx) {
  await ctx.identity();
  const attemptFile=path.join(ctx.dir,'attempts',label+'.json');
  const existing=await readJSON(attemptFile);
  if(existing){
    need(existing.status!=='FAILED','STOP '+label+' previous CREATE FAILED txHash='+existing.txHash+' gasUsed='+existing.gasUsed+'; no automatic retry or higher gas limit');
    need(same(existing.sender,signer.address),'Outstanding attempt sender mismatch');
    const r=await stepReceipt(ctx,label,existing.txHash);
    need(r?.status===1,'Outstanding attempt not successful; inspect manually; never auto-retry');
    return {receipt:r,attempt:existing,recovered:true};
  }
  const [latest,pending]=await Promise.all([ctx.provider.send('eth_getTransactionCount',[signer.address,'latest']),ctx.provider.send('eth_getTransactionCount',[signer.address,'pending'])]);
  need(BigInt(latest)===BigInt(pending),'Pending nonce differs; manual reconciliation required');
  // Suppress underlying errors at the CLI boundary: RPC exceptions can contain full reveal bytes/URLs.
  const request={...tx,from:signer.address};
  await ctx.provider.call(request);
  const estimate=await ctx.provider.estimateGas(request);
  const {gasLimit}=gasNumbers(label,estimate);
  const funding=await quoteFunding(ctx,gasLimit,signer.address);
  ctx.log(label+' '+fundingSummary(funding));
  checkGasAndFunding(label,estimate,funding);
  const fee=funding.maxFeePerGas,tip=funding.maxPriorityFeePerGas;
  const spent=ctx.journal.entries.reduce((n,e)=>n+BigInt(e.costWei??0),0n);
  need(spent+gasLimit*fee<=30000000000000000n,label+' total deployment gas budget exceeded; '+fundingSummary(funding));
  const full={...tx,chainId:CHAIN_ID,nonce:Number(BigInt(pending)),type:2,gasLimit,maxFeePerGas:fee,maxPriorityFeePerGas:tip};
  await ctx.identity();
  need(BigInt(await ctx.provider.send('eth_getTransactionCount',[signer.address,'pending']))===BigInt(pending),'Nonce changed before signing');
  checkFunding(label,{...funding,balanceWei:await ctx.provider.getBalance(signer.address)});
  const raw=await signer.signTransaction(full), hash=Transaction.from(raw).hash;
  const attempt={facts:ctx.attemptFacts??{},label,sender:signer.address,txHash:hash,nonce:String(full.nonce),to:tx.to??null,dataHash:keccak256(tx.data),value:String(tx.value??0),gasLimit:String(gasLimit),fee:String(fee),tip:String(tip)};
  await mkdir(path.dirname(attemptFile),{recursive:true,mode:0o700});
  const f=await open(attemptFile,'wx',0o600);try{await f.writeFile(stringify(attempt));await f.sync();}finally{await f.close();}
  // Hash persisted before the single broadcast; raw signed bytes never written to disk.
  let response;
  try{response=await ctx.provider.broadcastTransaction(raw);}catch(error){
    if(isCreateStep(label)){const failed=await ctx.provider.getTransactionReceipt(hash);if(failed?.status===0)await recordFailedCreate(ctx,label,failed);}
    throw error;
  }
  need(response.hash===hash,'Unexpected submitted hash');
  const receipt=await stepReceipt(ctx,label,hash);
  need(receipt?.status===1,'Transaction failed or pending; never auto-retry');
  return {receipt,attempt,recovered:false};
}
export async function runStep(ctx,id,{execute=false,wait=true,allowMira=false}={}) {
  need(id!=='T15'||allowMira,'T15 requires explicit --allow-mira; deploy stops at T14');
  checkOrder(ctx,id);await ctx.identity();await verifyPrefix(ctx);
  if(ctx.journal.entries.some(e=>e.step===id)){
    if(execute&&id==='T04')await removeSecret(ctx);
    ctx.log(id+' already verified; no transaction');return {alreadyVerified:true};
  }
  const step=STEPS[id];
  // A durable attempted send is recoverable only by its precomputed hash, never by a second send.
  const attempt=await readJSON(path.join(ctx.dir,'attempts',id+'.json'));
  if(attempt){
    need(attempt.status!=='FAILED','STOP '+id+' previous CREATE FAILED txHash='+attempt.txHash+' gasUsed='+attempt.gasUsed+'; no automatic retry or higher gas limit');
    need(execute,'Existing attempt requires --execute for read-only receipt reconciliation');
    const facts=attempt.facts;need(facts,'Attempt lacks saved public preparation facts');
    const r=await stepReceipt(ctx,id,attempt.txHash);need(r?.status===1,'Attempt pending/missing/reverted; inspect manually; no retry');
    return finish(ctx,id,r,attempt,facts);
  }
  if(id==='T03'||id==='T04')await loadSecret(ctx,{persist:execute,create:id==='T03'});
  if(id==='T04'&&wait)await waitCommitAge(ctx);
  const result=await step.preconditions(ctx);
  if(result?.skip){
    ctx.log(id+' SKIPPED: '+(id==='T01'?'balance covers quote':'allowance equals exact quote'));
    if(!execute)await drySummary(ctx,id,null,null);
    if(execute){const b=await ctx.provider.getBlock('latest');await append(ctx,{step:id,status:'SKIPPED',txHash:null,blockNumber:b.number,blockHash:b.hash,facts:ctx.work,derivedAddresses:{}});}
    return {skipped:true};
  }
  const tx=await step.build(ctx);
  if(execute)ctx.log(id==='T04'?'T04 function=register calldataBytes='+((tx.data.length-2)/2):id+' '+step.describe+'; target='+(tx.to??'CREATE')+'; value=0');
  if(!execute){
    await ctx.provider.call({...tx,from:ctx.owner});const estimate=await ctx.provider.estimateGas({...tx,from:ctx.owner});await drySummary(ctx,id,tx,estimate);return {dryRun:true,...gasNumbers(id,estimate)};
  }
  // Save public facts in the durable attempt before any broadcast, without raw calldata or preimage.
  const facts=structuredClone(ctx.work);
  const sent=await sendWithFacts(ctx,id,tx,facts);
  return finish(ctx,id,sent.receipt,sent.attempt,facts);
}
async function sendWithFacts(ctx,id,tx,facts) {
  // sendOnce accepts a callback-free public fact bag; the attempt is serialized before broadcast.
  ctx.attemptFacts=facts;
  try{return await sendOnce(ctx,id,ctx.signer,tx);}finally{ctx.attemptFacts=undefined;}
}
async function finish(ctx,id,r,attempt,facts) {
  r=await stepReceipt(ctx,id,r.hash);
  need(same(attempt.sender,ctx.owner),'Attempt owner mismatch');
  const mined=await ctx.provider.getTransaction(r.hash);
  need(mined&&same(mined.from,ctx.owner)&&mined.chainId===CHAIN_ID&&keccak256(mined.data)===attempt.dataHash&&String(mined.nonce)===attempt.nonce&&same(mined.to??'',attempt.to??'')&&String(mined.value)===attempt.value,'Mined transaction differs from saved attempt');
  need(mined.gasLimit===BigInt(attempt.gasLimit)&&mined.maxFeePerGas===BigInt(attempt.fee)&&mined.maxPriorityFeePerGas===BigInt(attempt.tip),'Mined fee/gas fields differ');
  need((await ctx.provider.getBlock(r.blockNumber))?.hash===r.blockHash,'Receipt is not canonical');
  ctx.work=facts;ctx.blockTag=r.blockNumber;let derived;
  try{derived=await STEPS[id].verify(ctx,r);}finally{ctx.blockTag=undefined;}
  await append(ctx,{step:id,status:'VERIFIED',txHash:r.hash,blockNumber:r.blockNumber,blockHash:r.blockHash,facts,derivedAddresses:derived,costWei:String(r.gasUsed*r.gasPrice),envelope:{nonce:attempt.nonce,to:attempt.to,dataHash:attempt.dataHash,value:attempt.value}});
  if(id==='T04')await removeSecret(ctx);
  ctx.log(id+' VERIFIED https://sepolia.etherscan.io/tx/'+r.hash);
  return {receipt:r};
}
export function parseArgs(args) {
  const o={execute:false};
  for(let i=0;i<args.length;i++){
    const a=args[i];if(a==='--execute')o.execute=true;
    else if(a==='--allow-mira')o.allowMira=true;
    else if(a==='--status')o.status=true;
    else if(['--step','--from','--to'].includes(a)){need(args[i+1],'Missing CLI option value');o[a.slice(2)]=args[++i];}
    else throw new Error('Unknown CLI option');
  }
  if(o.status){need(args.length===1,'--status cannot be combined with other options');return o;}
  need(Boolean(o.step)!==Boolean(o.from),'Use --step or --from/--to');
  need(!o.step||!o.to,'--to requires --from');
  if(o.step)o.from=o.to=o.step;
  need(STEP_IDS.includes(o.from)&&STEP_IDS.includes(o.to)&&STEP_IDS.indexOf(o.from)<=STEP_IDS.indexOf(o.to),'Invalid step range');
  need(o.to!=='T15'||o.allowMira,'T15 requires explicit --allow-mira');return o;
}
export async function main(args=process.argv.slice(2),env=process.env,contextOptions={}) {
  const options=parseArgs(args);
  const ctx=await createContext(env,contextOptions);
  try {
    if(options.status)return await status(ctx);
    const run=async()=>{for(const id of STEP_IDS.slice(STEP_IDS.indexOf(options.from),STEP_IDS.indexOf(options.to)+1)){
      const result=await runStep(ctx,id,options);
      if(!options.execute&&result.dryRun){ctx.log('DRY RUN stops here: dependent writes require actual verified receipts');break;}
      if(!options.execute&&result.skipped&&!ctx.journal.entries.some(e=>e.step===id)){ctx.log('DRY RUN skip not persisted; execute to verify/record progression');break;}
    }};
    if(options.execute)await withLock(ctx,run);else await run();
  }finally{ctx.provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main().catch(error=>{if(error.safe)console.error('STOP: '+error.message);console.error('STOP: live toolkit failed. Values/transport details suppressed. Inspect local attempt hashes and chain state; no automatic retry.');process.exitCode=1;});
}

const DRY_FUNCTIONS=[['MockUSDC','mint'],['MockUSDC','approve'],['ETHRegistrar','commit'],['ETHRegistrar','register'],['VerifiableFactory','deployProxy'],['ETHRegistry','setSubregistry'],['R1','setParent'],['R1','register'],['VerifiableFactory','deployProxy'],['R1','setSubregistry'],['R2','setParent'],['CredentialRegistrar','constructor'],['R2','grantRootRoles'],['DoorKeys','constructor'],['CredentialRegistrar','issue']];
export async function drySummary(ctx,id,tx,gas,{expiry}={}) {
  const [contract,fn]=id==='PROOF_ISSUE'?['CredentialRegistrar','issue']:DRY_FUNCTIONS[STEP_IDS.indexOf(id)];
  if(id==='T04'){ctx.log('T04 function=register calldataBytes='+((tx.data.length-2)/2));const f=await quoteFunding(ctx,gasNumbers(id,gas).gasLimit);checkGasAndFunding(id,gas,f);return;}
  const limits=gas===null?null:gasNumbers(id,gas);
  ctx.log('DRY RUN '+id+' target='+contract+'@'+(tx?.to??ctx.addresses[contract]??'CREATE')+' function='+fn+' estimatedGas='+(gas??'N/A (skipped)')+' gasLimit='+(limits?.gasLimit??'N/A (skipped)')+' gasCeiling='+(limits?.ceiling??gasNumbers(id,0n).ceiling)+' maxFeePerGasWei=2000000000 maxPriorityFeePerGasWei=100000000');
  if(limits){
    const funding=await quoteFunding(ctx,limits.gasLimit);
    ctx.log(id+(isCreateStep(id)?' protocolCap='+limits.protocolCap+' headroomPercent='+limits.headroomPercent+'%':'')+' '+fundingSummary(funding));
    checkGasAndFunding(id,gas,funding);
  }
  if(['T08','T15','PROOF_ISSUE'].includes(id)){
    const root=await ctx.read('ETHRegistry','getState',[(await import('ethers')).id(ctx.root)]);
    const lockExpiry=id==='T08'?BigInt(ctx.work.expiry):(await ctx.read('R1','getState',[(await import('ethers')).id('lock')])).expiry;
    need(lockExpiry<=root.expiry,'Lock expiry exceeds root expiry');
    const iso=n=>new Date(Number(n)*1000).toISOString();
    ctx.log('expiry='+iso(BigInt(expiry??ctx.work.expiry))+' lockExpiry='+iso(lockExpiry)+' rootExpiry='+iso(root.expiry)+' lockExpiry<=rootExpiry=PASS');
  }
}
export async function status(ctx) {
  await ctx.identity();checkOrder(ctx,STEP_IDS[Math.min(ctx.journal.entries.length,14)]);
  const rows=[];
  for(const step of STEP_IDS.slice(0,14)){
    const entry=ctx.journal.entries.find(e=>e.step===step),attempt=await readJSON(path.join(ctx.dir,'attempts',step+'.json'));
    const row={step,state:'not-run',txHash:entry?.txHash??attempt?.txHash??null,block:entry?.blockNumber??null};
    if(entry){try{await verifyRecorded(ctx,entry);row.state='verified';}catch{row.state='pending';}}
    else if(attempt){row.state='pending';row.block=(await ctx.provider.getTransactionReceipt(attempt.txHash))?.blockNumber??null;}
    rows.push(row);ctx.log(step+' '+row.state+' txHash='+(row.txHash??'—')+' block='+(row.block??'—'));
  }
  const next=rows.find(r=>r.state!=='verified');
  const nextRunnable=next?.state==='not-run'?next.step:null;
  ctx.log('Next runnable step (ordering only; fresh preconditions required): '+(nextRunnable??(next?'none; reconcile '+next.step:'complete through T14')));
  return {rows,nextRunnable};
}

export async function recordFailedCreate(ctx,step,receipt) {
  const file=path.join(ctx.dir,'attempts',step+'.json'),attempt=await readJSON(file);
  need(attempt&&same(attempt.txHash,receipt.hash),'Failed CREATE receipt has no matching durable attempt');
  need((await ctx.provider.getBlock(receipt.blockNumber))?.hash===receipt.blockHash,'Failed CREATE receipt not canonical');
  const gasExhausted=receipt.gasUsed>=BigInt(attempt.gasLimit);
  await atomicJSON(file,{...attempt,status:'FAILED',gasUsed:String(receipt.gasUsed),receiptStatus:0,
    blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,gasExhausted,failureReason:gasExhausted?'OUT_OF_GAS_LIKELY':'REVERTED'});
  const message='STOP '+step+' CREATE FAILED txHash='+receipt.hash+' gasUsed='+receipt.gasUsed+' gasLimit='+attempt.gasLimit+
    (gasExhausted?' (gas exhausted; likely OOG)':' (reverted; OOG not proven)')+'; no automatic retry or higher gas limit';
  ctx.log(message);need(false,message);
}
export async function stepReceipt(ctx,step,hash) {
  if(!isCreateStep(step))return confirmedReceipt(ctx,hash,{wait:true});
  const deadline=Date.now()+180000;
  while(true){
    const receipt=await ctx.provider.getTransactionReceipt(hash);
    if(receipt){
      if(receipt.status===0)await recordFailedCreate(ctx,step,receipt);
      need((await ctx.provider.getBlock(receipt.blockNumber))?.hash===receipt.blockHash,'CREATE receipt not canonical');
      const head=Number(BigInt(await ctx.provider.send('eth_blockNumber',[])));
      if(head-receipt.blockNumber+1>=ctx.confirmations)return receipt;
    }
    need(Date.now()<deadline,'CREATE receipt pending; no automatic retry');await ctx.confirmationTick(hash,receipt);
  }
}
