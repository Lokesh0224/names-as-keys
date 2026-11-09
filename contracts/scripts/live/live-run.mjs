import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import { Wallet, id, keccak256 } from 'ethers';
import { createContext, need, same, atomicJSON, readJSON, withLock, confirmedReceipt, proofLabel } from './context.mjs';
import { ZERO } from './config.mjs';
import { sendOnce, verifyPrefix, drySummary } from './run.mjs';
import { hierarchy, one, state } from './steps.mjs';
export async function liveRun(ctx,{execute=false,guestPrivateKey}={}) {
  const label=proofLabel(ctx.proofLabel);
  need(!same(ctx.owner,ctx.guest),'Guest must differ from owner');
  let guest;
  try{guest=new Wallet(guestPrivateKey,ctx.provider);}catch{need(false,'LIVE_GUEST_PRIVATE_KEY is required (never logged)');}
  need(same(guest.address,ctx.guest),'Guest signer differs from LIVE_GUEST_ADDRESS');
  await ctx.identity();await verifyPrefix(ctx);
  need(ctx.journal.entries.some(e=>e.step==='T14'&&e.status==='VERIFIED'),'Verified T14 required');
  const lock=await hierarchy(ctx);
  need(await ctx.provider.getCode(ctx.guest)==='0x','Guest must be undelegated EOA');
  const proofFile=path.join(ctx.dir,'proof-'+label+'.json');
  const proof=await readJSON(proofFile)??{label,owner:ctx.owner,guest:ctx.guest,door:ctx.addresses.DoorKeys,rows:[]};
  need(proof.label===label&&same(proof.owner,ctx.owner)&&same(proof.guest,ctx.guest)&&same(proof.door,ctx.addresses.DoorKeys),'Live-run proof scope mismatch');
  async function save(){
    await atomicJSON(proofFile,proof);
    const text='# Sepolia live proof\n\nLabel: '+label+'. Required confirmations: '+ctx.confirmations+'.\n\n| Action | Transaction | Block |\n| --- | --- | --- |\n'+proof.rows.map(r=>'| '+r.action+' | [receipt](https://sepolia.etherscan.io/tx/'+r.txHash+') | '+r.blockNumber+' |').join('\n')+(proof.denied?'\n| denied | read-only InvalidCredential() revert; no transaction | — |':'')+'\n';
    await mkdir(path.dirname(ctx.proofFile),{recursive:true});await writeFile(ctx.proofFile,text,{mode:0o600});
  }
  for(const row of proof.rows){const r=await confirmedReceipt(ctx,row.txHash);need(r.blockNumber===row.blockNumber,'Proof receipt block changed');}
  const attemptLabel=action=>'PROOF_'+label+'_'+action.toUpperCase();
  async function send(action,signer,to,data){
    const result=await sendOnce(ctx,attemptLabel(action),signer,{to,data,value:0n});
    const mined=await ctx.provider.getTransaction(result.receipt.hash);
    need(same(mined.from,signer.address)&&same(mined.to,to)&&mined.value===0n&&keccak256(mined.data)===keccak256(data)&&result.attempt.dataHash===keccak256(data),'Proof mined transaction mismatch');
    return result;
  }
  if(!proof.rows.some(r=>r.action==='issue')){
    const attempt=await readJSON(path.join(ctx.dir,'attempts',attemptLabel('issue')+'.json'));
    if(!attempt){
      const s=await state(ctx,'R2',label),initial=BigInt(id(label))&~0xffffffffn;
      need(s.status===0n&&s.expiry===0n&&same(s.latestOwner,ZERO)&&s.tokenId===initial&&s.resource===initial+1n,'Proof label is not pristine; choose a new LIVE_PROOF_LABEL');
      proof.expiry=String(await ctx.time()+3600n);
    }else{need(attempt.facts?.proofLabel===label&&attempt.facts.expiry,'Proof issue attempt scope missing');proof.expiry=attempt.facts.expiry;}
    need(BigInt(proof.expiry)<=lock.expiry,'Proof expiry exceeds lock expiry');
    const data=ctx.interfaces.CredentialRegistrar.encodeFunctionData('issue',[label,ctx.guest,proof.expiry]);
    if(!execute){
      await ctx.provider.call({to:ctx.addresses.CredentialRegistrar,from:ctx.owner,data});
      const gas=await ctx.provider.estimateGas({to:ctx.addresses.CredentialRegistrar,from:ctx.owner,data});
      await drySummary(ctx,'PROOF_ISSUE',{to:ctx.addresses.CredentialRegistrar,data},gas,{expiry:proof.expiry});return {dryRun:true};
    }
    ctx.attemptFacts={proofLabel:label,expiry:proof.expiry};let result;
    try{result=await send('issue',ctx.signer,ctx.addresses.CredentialRegistrar,data);}finally{ctx.attemptFacts=undefined;}
    const {receipt}=result,e=one(ctx,receipt,'CredentialRegistrar','CredentialIssued');
    need(same(e.labelHash,id(label))&&same(e.guest,ctx.guest)&&e.expiry===BigInt(proof.expiry),'Proof issuance event mismatch');
    const s=await ctx.read('R2','getState',[id(label)],receipt.blockNumber);
    need(s.status===2n&&s.tokenId===e.tokenId&&s.expiry===e.expiry&&same(await ctx.read('R2','getOwner',[id(label)],receipt.blockNumber),ctx.guest),'Proof issuance state mismatch');
    proof.token=String(e.tokenId);proof.rows.push({action:'issue',txHash:receipt.hash,blockNumber:receipt.blockNumber});await save();ctx.log('issue https://sepolia.etherscan.io/tx/'+receipt.hash);
  }
  const token=proof.token;need(token,'Missing receipt-derived proof token');
  if(!execute){
    need(!proof.rows.some(r=>r.action==='revoke'),'Proof run already revoked');
    const tx={to:ctx.addresses.DoorKeys,data:ctx.interfaces.DoorKeys.encodeFunctionData('unlock',[label]),value:0n,from:guest.address};
    await ctx.provider.call(tx);ctx.log('DRY RUN PROOF_UNLOCK target=DoorKeys@'+tx.to+' function=unlock estimatedGas='+await ctx.provider.estimateGas(tx)+' maxFeePerGasWei=2000000000 maxPriorityFeePerGasWei=100000000');return {dryRun:true};
  }
  if(!proof.rows.some(r=>r.action==='unlock')){
    const s=await state(ctx,'R2',label);need(s.tokenId===BigInt(token)&&s.status===2n&&same(await ctx.read('R2','getOwner',[id(label)]),ctx.guest),'Expected active proof credential');
    const before=await ctx.read('DoorKeys','requestNonce');
    const {receipt,recovered}=await send('unlock',guest,ctx.addresses.DoorKeys,ctx.interfaces.DoorKeys.encodeFunctionData('unlock',[label]));
    const e=one(ctx,receipt,'DoorKeys','DoorUnlocked');
    need(same(e.doorId,await ctx.read('DoorKeys','doorId'))&&same(e.guest,ctx.guest)&&same(e.credentialLabelHash,id(label))&&e.credentialTokenId===BigInt(token)&&e.credentialExpiry===s.expiry,'Proof unlock event fields mismatch');
    need(e.requestNonce===(recovered?before:before+1n),'Proof unlock nonce mismatch');
    proof.rows.push({action:'unlock',txHash:receipt.hash,blockNumber:receipt.blockNumber});await save();ctx.log('unlock https://sepolia.etherscan.io/tx/'+receipt.hash);
  }
  if(!proof.rows.some(r=>r.action==='revoke')){
    const s=await ctx.read('R2','getState',[BigInt(token)]);need(s.tokenId===BigInt(token),'Stale proof token before revoke');
    const {receipt}=await send('revoke',ctx.signer,ctx.addresses.CredentialRegistrar,ctx.interfaces.CredentialRegistrar.encodeFunctionData('revoke',[label,token]));
    const e=one(ctx,receipt,'CredentialRegistrar','CredentialRevoked');need(same(e.labelHash,id(label))&&e.tokenId===BigInt(token),'Proof revoke event mismatch');
    need((await state(ctx,'R2',label)).status!==2n&&same(await ctx.read('R2','getOwner',[id(label)]),ZERO),'Proof revocation postcondition failed');
    proof.rows.push({action:'revoke',txHash:receipt.hash,blockNumber:receipt.blockNumber});await save();ctx.log('revoke https://sepolia.etherscan.io/tx/'+receipt.hash);
  }
  let denied=false;
  try{await ctx.provider.call({from:ctx.guest,to:ctx.addresses.DoorKeys,data:ctx.interfaces.DoorKeys.encodeFunctionData('unlock',[label])});}
  catch(error){denied=error.code==='CALL_EXCEPTION'&&error.data===ctx.interfaces.DoorKeys.getError('InvalidCredential').selector;}
  need(denied,'Expected exact InvalidCredential revert after proof revocation');
  proof.denied='InvalidCredential()';await save();ctx.log('DENIED verified: InvalidCredential(); no failing transaction broadcast');return proof;
}
export async function main(args=process.argv.slice(2)) {
  need(args.every(a=>a==='--execute'),'Only --execute is supported');const execute=args.includes('--execute'),ctx=await createContext();
  try{const fn=()=>liveRun(ctx,{execute,guestPrivateKey:process.env.LIVE_GUEST_PRIVATE_KEY});return execute?await withLock(ctx,fn):await fn();}finally{ctx.provider.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{if(error.safe)console.error('STOP: '+error.message);console.error('STOP: live-run failed; transport details suppressed; inspect saved hashes, never auto-retry.');process.exitCode=1;});
