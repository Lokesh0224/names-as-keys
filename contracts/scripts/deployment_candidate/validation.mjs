import { keccak256,getCreateAddress } from 'ethers';
import { need } from './common.mjs';
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const DEFERRED={T03:{0:['registration.commitment','PRIVATE_FORK_COMMITMENT']},T04:{2:['privateRegistrationState.secret','PRIVATE_FORK_PREIMAGE']},T06:{0:['receipts.rootTokenId','FORK_RECEIPT_T04']},T08:{5:['inputs.lockExpiry','FORK_REVIEW_TIMESTAMP']},T10:{0:['receipts.lockTokenId','FORK_RECEIPT_T08']},T15:{2:['inputs.guestExpiry','FORK_REVIEW_TIMESTAMP']}};
export function assertSnapshotNonces(snapshot){need(snapshot.nonce!==null&&snapshot.pendingNonce!==null&&BigInt(snapshot.nonce)===BigInt(snapshot.pendingNonce),'SNAPSHOT_PENDING_NONCE_DISAGREEMENT');}
export function assertFreshness(reference,current,inputs,{mode='LIVE_REVIEW',nowSeconds=Date.now()/1000}={}){
  need(reference&&current&&reference.hash&&current.hash,'MISSING_REVIEW_HEADER');
  const blocks=BigInt(current.number)-BigInt(reference.number),seconds=BigInt(current.timestamp)-BigInt(reference.timestamp);
  need(blocks>=0n&&blocks<=BigInt(inputs.expiry.maxAgeBlocks),'REVIEW_BLOCK_AGE');
  need(seconds>=0n&&seconds<=BigInt(inputs.expiry.maxAgeSeconds),'REVIEW_CHAIN_TIME_AGE');
  if(mode==='LIVE_REVIEW')need(nowSeconds-Number(BigInt(reference.timestamp))<=Number(inputs.expiry.maxAgeSeconds)&&Number(BigInt(reference.timestamp))<=nowSeconds+15,'REVIEW_WALL_TIME_AGE');
  else need(mode==='HISTORICAL_FORK','UNKNOWN_REVIEW_CONTEXT');
}
export function gasLimit(estimate,inputs){const percent=BigInt(inputs.fees.gasLimitMultiplierPercent);need(percent>=100n,'INVALID_GAS_MULTIPLIER');const gas=(BigInt(estimate)*percent+99n)/100n;need(gas>0n&&gas<=BigInt(inputs.fees.maxGasPerStep),'GAS_CAP');return gas;}
export function assertGuestMargin(expiry,timestamp,inputs){need(BigInt(expiry)-BigInt(timestamp)>=BigInt(inputs.expiry.guestMinimumRemainingSeconds),'GUEST_MARGIN');}
export function assertInclusion(plan,id,included){const step=plan.transactions.find(s=>s.id===id);need(step&&step.conditionallyIncluded===included,'PLAN_INCLUSION_MISMATCH');return step;}
export function comparePlannedTransaction(plan,id,tx,args,interfaces,artifacts,substitutions={}){
  const step=assertInclusion(plan,id,true);const creation=step.signature.startsWith('constructor(');
  need(plan.owner&&step.signer?.address&&same(tx.from,plan.owner)&&same(tx.from,step.signer.address),'PLAN_SIGNER_MISMATCH');
  need(BigInt(tx.nonce)===BigInt(step.candidateNonce),'PLAN_NONCE_MISMATCH');
  need(creation?tx.to===undefined||tx.to===null:same(tx.to,step.candidateDestination),'PLAN_DESTINATION_MISMATCH');
  need(BigInt(tx.value)===BigInt(step.candidateValueWei)&&BigInt(tx.chainId)===BigInt(step.candidateChainId),'PLAN_VALUE_OR_CHAIN_MISMATCH');
  const creationAddress=creation?getCreateAddress({from:plan.owner,nonce:BigInt(step.candidateNonce)}):null;
  if(creation)need(step.candidateCreationAddress&&same(creationAddress,step.candidateCreationAddress),'PLAN_CREATION_ADDRESS_MISMATCH');
  const actualSubstitutions=[];
  const resolved=step.candidateArguments.map((value,index)=>{
    if(value!==null&&value!==undefined)return value;
    const spec=DEFERRED[id]?.[index],given=substitutions[index];
    need(spec&&given&&given.binding===spec[0]&&given.provenance===spec[1]&&given.value!==undefined,'UNVERIFIED_FORK_SUBSTITUTION');
    actualSubstitutions.push({argumentIndex:index,binding:spec[0],provenance:spec[1],forkOnly:true,...(spec[1].startsWith('PRIVATE_')?{valueExported:false}:{value:String(given.value),reference:given.reference})});
    return given.value;
  });
  need(Object.keys(substitutions).length===actualSubstitutions.length,'EXTRA_FORK_SUBSTITUTION');
  const iface=interfaces[step.abi];
  const encode=values=>creation?artifacts[step.abi].bytecode.object+iface.encodeDeploy(values).slice(2):iface.encodeFunctionData(step.signature,values);
  const expected=encode(resolved);
  need(same(expected,tx.data)&&same(encode(args),tx.data),'PLAN_ARGUMENT_OR_CALLDATA_MISMATCH');
  if(step.candidateCalldata!==null)need(same(step.candidateCalldata,tx.data),'PLAN_KNOWN_CALLDATA_MISMATCH');
  return {inclusion:true,sender:true,creationAddress,nonce:true,destination:true,value:true,chainId:true,knownArguments:true,knownCalldata:step.candidateCalldata!==null,calldataDigest:keccak256(tx.data),forkOnlySubstitutions:actualSubstitutions};
}
export function verifyMinedTransaction(mined,receipt,submitted,plannedCreationAddress=null){
  need(mined&&receipt&&same(mined.hash,receipt.transactionHash)&&mined.blockHash===receipt.blockHash,'MINED_IDENTITY');
  need(same(mined.from,submitted.from)&&BigInt(mined.nonce)===BigInt(submitted.nonce)&&same(mined.input,submitted.data),'MINED_INPUT_DRIFT');
  need(submitted.to===undefined?mined.to===null&&receipt.to===null:same(mined.to,submitted.to)&&same(receipt.to,submitted.to),'MINED_DESTINATION');
  if(submitted.to===undefined||submitted.to===null)need(plannedCreationAddress&&same(receipt.contractAddress,plannedCreationAddress),'MINED_PLAN_CREATION_ADDRESS');
  for(const key of ['value','chainId','gas','maxFeePerGas','maxPriorityFeePerGas'])need(mined[key]!==null&&mined[key]!==undefined&&BigInt(mined[key])===BigInt(submitted[key]),'MINED_'+key.toUpperCase());
  need(BigInt(receipt.gasUsed)>0n&&BigInt(receipt.gasUsed)<=BigInt(submitted.gas)&&BigInt(receipt.effectiveGasPrice)<=BigInt(submitted.maxFeePerGas),'MINED_CHARGED_GAS_OR_FEE');
  return {sender:true,nonce:true,calldata:true,destination:true,value:true,chainId:true,gasLimit:true,maxFeePerGas:true,maxPriorityFeePerGas:true,chargedGasAndFee:true};
}
