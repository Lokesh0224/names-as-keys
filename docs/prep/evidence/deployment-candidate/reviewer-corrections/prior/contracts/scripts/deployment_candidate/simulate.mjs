import { startUpstreamProxy } from './upstream_proxy.mjs';
/** Exact approved static candidate inputs, ephemeral owned Anvil fork only.
 * No private wallet keys, persistent node state, raw RPC transcript or preimage output.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Interface, AbiCoder, id, keccak256, zeroPadValue, toBeHex, getCreateAddress, toQuantity } from 'ethers';
import { load, readJSON, stringify, OUT, UPSTREAM, need } from './common.mjs';

const ZERO='0x'+'00'.repeat(20),ZERO32='0x'+'00'.repeat(32);
const GRANTS=380593917518227438537563280301172632627253505n;
const ROOT_ROLES=97409655027181761882228017414928043058140282880n;
const LOCK_ROLES=91700664256357922357994873537130062512592519168n;
const LABEL_STORE='0xed8246ff02203a4d4cb262bd78beaa7408a57cae';
const LOCAL_METHODS=new Set(['web3_clientVersion','anvil_nodeInfo','eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_getBalance','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_estimateGas','eth_sendTransaction','anvil_impersonateAccount','anvil_mine']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,url,upstreamProxy,stage='BOOT',localCalls=0;
const result={classification:'ISOLATED_LOCAL_FORK_CANDIDATE_STATIC_INPUTS_NOT_LIVE_EXECUTION',stage3F:'NO_GO',steps:[],preimageHandling:'Fresh random32-byte fork-only preimage in RAM, never serialized; destroyed with processes; never reused live',liveReceipts:{},liveExecutionAllowed:false};

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
  const {inputs,addresses:a,interfaces:i,artifacts}=await load();
  const observation=await readJSON(path.join(OUT,'public-bindings.json'));
  const proofs=await readJSON(path.join(OUT,'local-artifact-proof.json'));
  result.forkBlockNumber=observation.blockNumber;result.forkBlockHash=observation.blockHash;
  result.approvedStaticInputs={owner:inputs.owner,mira:inputs.mira,root:inputs.root,salts:inputs.salts,epoch:inputs.deploymentEpoch,rootDuration:inputs.expiry.rootDurationSeconds,lockDuration:inputs.expiry.lockDurationSeconds,guestDuration:inputs.expiry.guestDurationSeconds};
  upstreamProxy=await startUpstreamProxy();
  const port=await freePort();url='http://127.0.0.1:'+port;
  child=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--accounts','0','--quiet','--disable-console-log','--fork-url',upstreamProxy.url,'--fork-block-number',observation.blockNumber,'--chain-id','11155111','--hardfork','prague','--disable-min-priority-fee','--no-storage-caching','--max-persisted-states','0'],{stdio:['ignore','pipe','pipe']});
  // Discard native output, including any unexpected trace/startup text, rather than persist secrets.
  child.stdout.resume();child.stderr.resume();child.on('error',()=>{});
  let ready=false;for(let n=0;n<120;n++){try{ready=BigInt(await rpc('eth_chainId'))===11155111n;if(ready)break;}catch{}await sleep(250);}
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
  const event=(name,sig,args,address=a[name])=>({address,signature:sig,...eventInterfaces[name].encodeEventLog(eventInterfaces[name].getEvent(sig),args)});
  const wasAbsent=async text=>labelInterface.decodeFunctionResult('getLabel',await rpc('eth_call',[{to:LABEL_STORE,data:labelInterface.encodeFunctionData('getLabel',[id(text)])},'latest']))[0]==='';
  let spentWorstCase=0n;
  async function transact(step,name,sig,args,{creation=false,expectedAddress}={}){
    stage=step;
    const nonce=await rpc('eth_getTransactionCount',[inputs.owner,'pending']);
    const planned=observation.sequence.find(s=>s.id===step);need(planned.included && BigInt(nonce)===BigInt(planned.nonce),'NONCE_PLAN_DRIFT');
    const head=await rpc('eth_getBlockByNumber',['latest',false]);
    const tip=1n,fee=BigInt(head.baseFeePerGas)*2n+tip;
    need(fee<=BigInt(inputs.fees.maxFeePerGasWei)&&tip<=BigInt(inputs.fees.maxPriorityFeePerGasWei),'FEE_CAP');
    const data=creation?artifacts[name].bytecode.object+i[name].encodeDeploy(args).slice(2):i[name].encodeFunctionData(sig,args);
    const tx={from:inputs.owner,data,nonce,value:'0x0',chainId:'0xaa36a7',maxFeePerGas:toQuantity(fee),maxPriorityFeePerGas:toQuantity(tip)};
    if(!creation)tx.to=a[name];
    const estimated=BigInt(await rpc('eth_estimateGas',[tx]));const gas=(estimated*120n+99n)/100n;
    need(gas<=BigInt(inputs.fees.maxGasPerStep),'GAS_CAP');tx.gas=toQuantity(gas);
    spentWorstCase+=gas*fee;need(spentWorstCase<=BigInt(inputs.fees.maxTotalWei),'TOTAL_FEE_CAP');
    const hash=await rpc('eth_sendTransaction',[tx]);
    let receipt;for(let n=0;n<120;n++){receipt=await rpc('eth_getTransactionReceipt',[hash]);if(receipt)break;await sleep(100);}
    need(receipt?.status==='0x1','LOCAL_TRANSACTION_FAILED');
    const mined=await rpc('eth_getTransactionByHash',[hash]);
    need(mined.input.toLowerCase()===data.toLowerCase()&&BigInt(mined.nonce)===BigInt(nonce)&&mined.from.toLowerCase()===inputs.owner.toLowerCase(),'MINED_INPUT_DRIFT');
    if(creation)need(receipt.contractAddress.toLowerCase()===expectedAddress.toLowerCase()&&getCreateAddress({from:inputs.owner,nonce})===expectedAddress,'CREATE_PREDICTION_DRIFT');
    await rpc('anvil_mine',['0x40','0x1']);
    const latest=await rpc('eth_getBlockByNumber',['latest',false]),finalized=await rpc('eth_getBlockByNumber',['finalized',false]);
    need(BigInt(latest.number)>=BigInt(receipt.blockNumber)+11n&&finalized&&BigInt(finalized.number)>=BigInt(receipt.blockNumber),'LOCAL_CONFIRMATION_FINALITY_MODEL');
    const canonical=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);need(canonical.hash===receipt.blockHash,'LOCAL_REORG');
    const record={id:step,nonce,transactionHash:hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,gasUsed:receipt.gasUsed,gasLimit:gas,feeCeiling:fee,calldataDigest:keccak256(data),privateInputOmitted:step==='T03'||step==='T04',localOnly:true,confirmationHead:latest.number,finalizedCoverage:finalized.number};
    result.steps.push(record);
    return{receipt,record,header:canonical};
  }
  function checkEvents(context,expected){
    need(context.receipt.logs.length===expected.length,'EVENT_COUNT');
    expected.forEach((e,n)=>{const actual=context.receipt.logs[n];need(actual.address.toLowerCase()===e.address.toLowerCase()&&actual.data.toLowerCase()===e.data.toLowerCase()&&JSON.stringify(actual.topics.map(x=>x.toLowerCase()))===JSON.stringify(e.topics.map(x=>x.toLowerCase())),'EVENT_FIELDS_ORDER');});
    context.record.verifiedEvents=expected.map(e=>({emitter:e.address,signature:e.signature}));
  }
  const quote=await call('ETHRegistrar','getRegisterPrice',[label,inputs.expiry.rootDurationSeconds,a.MockUSDC]);let price=quote[0]+quote[1];need(price===BigInt(observation.priceUnits),'QUOTE_DRIFT');
  need((await call('ETHRegistrar','isAvailable',[label]))[0],'ROOT_UNAVAILABLE');
  if(observation.includeMint){const amount=price-(await call('MockUSDC','balanceOf',[inputs.owner]))[0];const c=await transact('T01','MockUSDC','mint',[inputs.owner,amount]);checkEvents(c,[event('MockUSDC','Transfer',[ZERO,inputs.owner,amount])]);}
  if(observation.includeApprove){const c=await transact('T02','MockUSDC','approve',[a.ETHRegistrar,price]);checkEvents(c,[event('MockUSDC','Approval',[inputs.owner,a.ETHRegistrar,price])]);}
  const preimageBytes=randomBytes(32);let preimage='0x'+preimageBytes.toString('hex');upstreamProxy.protect(preimage);
  const commitment=(await call('ETHRegistrar','makeCommitment',[label,inputs.owner,preimage,ZERO,ZERO,inputs.expiry.rootDurationSeconds,ZERO32]))[0];
  const committed=await transact('T03','ETHRegistrar','commit',[commitment]);checkEvents(committed,[event('ETHRegistrar','CommitmentMade',[commitment])]);
  const age=BigInt((await rpc('eth_getBlockByNumber',['latest',false])).timestamp)-BigInt(committed.header.timestamp);
  need(age>=BigInt((await call('ETHRegistrar','MIN_COMMITMENT_AGE'))[0])&&age<BigInt((await call('ETHRegistrar','MAX_COMMITMENT_AGE'))[0]),'COMMITMENT_WINDOW');
  const freshQuote=await call('ETHRegistrar','getRegisterPrice',[label,inputs.expiry.rootDurationSeconds,a.MockUSDC]);need(freshQuote[0]+freshQuote[1]===price,'REVEAL_QUOTE_DRIFT');
  const absentRoot=await wasAbsent(label);
  const registered=await transact('T04','ETHRegistrar','register',[label,inputs.owner,preimage,ZERO,ZERO,inputs.expiry.rootDurationSeconds,a.MockUSDC,ZERO32]);
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
  const attachRoot=await transact('T06','ETHRegistry','setSubregistry',[root.tokenId,a.R1]);checkEvents(attachRoot,[event('ETHRegistry','SubregistryUpdated',[root.tokenId,a.R1,inputs.owner])]);
  const parent1=await transact('T07','R1','setParent',[a.ETHRegistry,label]);checkEvents(parent1,[event('R1','ParentUpdated',[a.ETHRegistry,label,inputs.owner])]);
  const lockReference=await rpc('eth_getBlockByNumber',['latest',false]);const lockExpiry=BigInt(lockReference.timestamp)+BigInt(inputs.expiry.lockDurationSeconds);need(lockExpiry<=root.expiry,'LOCK_EXPIRY_BOUND');
  const absentLock=await wasAbsent('lock');
  const lockRegistered=await transact('T08','R1','register',['lock',inputs.owner,ZERO,ZERO,LOCK_ROLES,lockExpiry]);
  const lock=(await call('R1','getState',[lockHash]))[0];checkEvents(lockRegistered,registrationEvents('R1','lock',lock,inputs.owner,inputs.owner,LOCK_ROLES,absentLock));
  await registry('T09','R2',inputs.salts.R2);
  const attachLock=await transact('T10','R1','setSubregistry',[lock.tokenId,a.R2]);checkEvents(attachLock,[event('R1','SubregistryUpdated',[lock.tokenId,a.R2,inputs.owner])]);
  const parent2=await transact('T11','R2','setParent',[a.R1,'lock']);checkEvents(parent2,[event('R2','ParentUpdated',[a.R1,'lock',inputs.owner])]);
  async function deploy(step,name,args){const predicted=observation.predictions[name];need(await rpc('eth_getCode',[predicted,'latest'])==='0x','PREDICTED_CREATE_NOT_EMPTY');const c=await transact(step,name,'constructor',args,{creation:true,expectedAddress:predicted});a[name]=predicted;checkEvents(c,[]);return c;}
  await deploy('T12','CredentialRegistrar',[inputs.owner,label,a.R1,a.R2]);
  const grant=await transact('T13','R2','grantRootRoles',[4097,a.CredentialRegistrar]);checkEvents(grant,[event('R2','EACRolesChanged',[0,a.CredentialRegistrar,0,4097])]);
  await deploy('T14','DoorKeys',[inputs.owner,label,a.R1,a.R2,inputs.deploymentEpoch]);
  const guestReference=await rpc('eth_getBlockByNumber',['latest',false]);const guestExpiry=BigInt(guestReference.timestamp)+BigInt(inputs.expiry.guestDurationSeconds);need(guestExpiry<=lock.expiry,'GUEST_EXPIRY_BOUND');
  const absentGuest=await wasAbsent('mira');
  const issued=await transact('T15','CredentialRegistrar','issue',['mira',inputs.mira,guestExpiry]);
  const guest=(await call('R2','getState',[guestHash]))[0];
  checkEvents(issued,[...registrationEvents('R2','mira',guest,inputs.mira,a.CredentialRegistrar,0n,absentGuest),event('CredentialRegistrar','CredentialIssued',[guestHash,guest.tokenId,inputs.mira,guestExpiry])]);
  need((await call('ETHRegistry','getSubregistry',[label]))[0].toLowerCase()===a.R1.toLowerCase()&&(await call('R1','getSubregistry',['lock']))[0].toLowerCase()===a.R2.toLowerCase(),'FORWARD_LINKS');
  const p1=await call('R1','getParent'),p2=await call('R2','getParent');need(p1[0].toLowerCase()===a.ETHRegistry.toLowerCase()&&p1[1]===label&&p2[0].toLowerCase()===a.R1.toLowerCase()&&p2[1]==='lock','BACK_LINKS');
  need((await call('ETHRegistry','getOwner',[rootHash]))[0].toLowerCase()===inputs.owner.toLowerCase()&&(await call('R1','getOwner',[lockHash]))[0].toLowerCase()===inputs.owner.toLowerCase()&&(await call('R2','getOwner',[guestHash]))[0].toLowerCase()===inputs.mira.toLowerCase(),'OWNERS');
  need((await call('R2','roles',[0,a.CredentialRegistrar]))[0]===4097n&&(await call('R2','roleCount',[guest.resource]))[0]===0n&&(await call('R2','roles',[0,inputs.mira]))[0]===0n&&(await call('R2','roles',[0,a.DoorKeys]))[0]===0n&&!(await call('R2','isEmancipated'))[0],'FINAL_ROLES');
  const doorId=keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','bytes32','bytes32','address','address','uint256','uint256','uint256'],[11155111,a.DoorKeys,rootHash,lockHash,a.R1,a.R2,root.tokenId,lock.tokenId,inputs.deploymentEpoch]));
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
  result.verified={allIncludedStepsSucceeded:true,exactEncodedInputsAndNonces:true,allReceiptEventsExact:true,confirmationAndFinalizedModel:true,hierarchyAndBothParentLinks:true,ownersRolesExpiries:true,fullProductionRuntimeBytes:true,fullProxyRuntimeBytes:true,readOnlyUnlockAcceptedNoPersistentEvent:true};
  result.totalReservedGasWei=spentWorstCase;result.localRpcCalls=localCalls;result.status='PASS';
}
try{await main();console.log('PASS: isolated candidate fork sequence completed; preimage withheld; no live writes or wallet requests');}
catch(error){result.status='BLOCKED';result.failure={stage,classification:'SANITIZED_LOCAL_SIMULATION_FAILURE',rpcCode:Number.isInteger(error.rpcCode)?error.rpcCode:null};console.error('BLOCKED: isolated candidate simulation failed at '+stage+'; private error details withheld');process.exitCode=1;}
finally{
  if(child && child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(2000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(child&&child.exitCode===null&&child.signalCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(1000)]);
  result.nodeStopped=!child||child.exitCode!==null||child.signalCode!==null;
  if(upstreamProxy){result.upstreamReadOnlyProxy=upstreamProxy.stats;await upstreamProxy.close();}await writeFile(path.join(OUT,'simulation-result.json'),stringify(result));
}
