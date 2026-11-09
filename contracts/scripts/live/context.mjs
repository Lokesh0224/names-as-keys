import { readFile, mkdir, open, rename, lstat, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, Wallet, Interface, getAddress, id, AbiCoder, keccak256, version } from 'ethers';
import { CHAIN_ID, ROOT, INFRA, INTERFACES, ZERO, ZERO32, ROOT_DURATION } from './config.mjs';
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function need(ok, message) { if (!ok) { const error=new Error(message); error.safe=true; throw error; } }
export const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
export const stringify = x => JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
export async function readJSON(file) { try { return JSON.parse(await readFile(file,'utf8')); } catch(e) { if(e.code==='ENOENT')return null; throw new Error('Invalid local JSON state; manual review required'); } }
export async function atomicJSON(file, value) {
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';
  const f=await open(temp,'wx',0o600);
  try { await f.writeFile(stringify(value)); await f.sync(); } finally { await f.close(); }
  await rename(temp,file);
}
export async function artifacts() {
  const result={};
  for(const name of ['CredentialRegistrar','DoorKeys']) {
    // Required exception to restricted reading: deployment bytecode cannot be obtained from an ABI.
    const a=JSON.parse(await readFile(path.join(REPO,'contracts/out',name+'.sol',name+'.json'),'utf8'));
    need(a.metadata?.compiler?.version?.startsWith('0.8.25+'),'Build application artifacts with solc 0.8.25');
    const { keccak256:hash, toUtf8Bytes }=await import('ethers');
    for(const [source,entry] of Object.entries(a.metadata.sources)) {
      // Check only application sources here; vendored imported source checking is outside this task's read allowance.
      if(source==='src/'+name+'.sol') need(hash(toUtf8Bytes(await readFile(path.join(REPO,'contracts',source),'utf8')))===entry.keccak256,'Stale application artifact');
    }
    result[name]=a;
  }
  return result;
}
export async function createContext(env=process.env, options={}) {
  need(Number(process.versions.node.split('.')[0])>=22&&version==='6.17.0','Require Node 22+ and ethers 6.17.0');
  need(env.LIVE_RPC_URL && env.LIVE_PRIVATE_KEY && env.LIVE_OWNER_ADDRESS && env.LIVE_GUEST_ADDRESS,'Required LIVE_* environment configuration missing');
  let provider, signer, owner, guest;
  try {
    provider=options.provider??new JsonRpcProvider(env.LIVE_RPC_URL,undefined,{cacheTimeout:-1,batchMaxCount:1});
    signer=new Wallet(env.LIVE_PRIVATE_KEY,provider); owner=getAddress(env.LIVE_OWNER_ADDRESS); guest=getAddress(env.LIVE_GUEST_ADDRESS);
  } catch { throw new Error('Invalid live configuration (values suppressed)'); }
  need(same(signer.address,owner),'Signer does not equal LIVE_OWNER_ADDRESS');
  need(!same(owner,guest)&&!same(guest,ZERO),'Guest must be nonzero and different from owner');
  const confirmations=Number(env.LIVE_CONFIRMATIONS??3);
  need(Number.isSafeInteger(confirmations)&&confirmations>=1,'LIVE_CONFIRMATIONS must be a positive integer');
  const reserveValue=env.LIVE_RESERVE_WEI??'1000000000000000';
  need(/^[0-9]+$/.test(reserveValue),'LIVE_RESERVE_WEI must be a nonnegative integer in wei');
  const reserveWei=BigInt(reserveValue);
  const dir=options.stateDir??path.join(REPO,'.live');
  const ctx={provider,signer,owner,guest,root:ROOT,dir,confirmations,reserveWei,proofLabel:env.LIVE_PROOF_LABEL??'proofrun',
    journalFile:options.journalFile??path.join(REPO,'contracts/deployments/sepolia.live.json'),
    proofFile:options.proofFile??path.join(REPO,'contracts/deployments/live-proof.md'),
    interfaces:{...INTERFACES},addresses:{...INFRA},work:{},issueDuration:86400n,log:options.log??console.log,
    confirmationTick:options.confirmationTick??(()=>new Promise(resolve=>setTimeout(resolve,4000))),
    waitTick:options.waitTick??(()=>new Promise(resolve=>setTimeout(resolve,4000)))};
  ctx.artifacts=await artifacts();
  for(const [name,a] of Object.entries(ctx.artifacts))ctx.interfaces[name]=new Interface(a.abi);
  ctx.identity=async()=>{
    need(BigInt(await provider.send('eth_chainId',[]))===CHAIN_ID,'Wrong chain: require Sepolia 11155111');
    need(same(signer.address,owner),'Wrong signer');
    need(await provider.getCode(owner)==='0x','Owner must be an undelegated EOA');
  };
  ctx.read=async(name,method,args=[],tag=ctx.blockTag??'latest')=>{
    const to=ctx.addresses[name];need(to,'Missing receipt-derived address: '+name);
    const i=ctx.interfaces[name];need(i,'Missing interface: '+name);
    const raw=await provider.send('eth_call',[{to,data:i.encodeFunctionData(method,args)},typeof tag==='number'?'0x'+tag.toString(16):tag]);
    const values=i.decodeFunctionResult(method,raw);return values.length===1?values[0]:values;
  };
  ctx.time=async()=>BigInt((await provider.send('eth_getBlockByNumber',['latest',false])).timestamp);
  await ctx.identity();
  ctx.journal=await readJSON(ctx.journalFile)??{schema:1,chainId:String(CHAIN_ID),owner,guest,root:ROOT,entries:[]};
  need(ctx.journal.schema===1&&ctx.journal.chainId===String(CHAIN_ID)&&same(ctx.journal.owner,owner)&&same(ctx.journal.guest,guest)&&ctx.journal.root===ROOT,'Journal scope mismatch');
  need(Array.isArray(ctx.journal.entries),'Malformed journal entries');
  ctx.refresh=()=>{ctx.derived=Object.assign({},...ctx.journal.entries.map(e=>e.derivedAddresses??{}));Object.assign(ctx.addresses,ctx.derived);};
  ctx.refresh();
  return ctx;
}
export function revealArgs(ctx) { return [ROOT,ctx.owner,ctx.secret,ZERO,ZERO,ROOT_DURATION,INFRA.MockUSDC,ZERO32]; }
export function commitment(ctx) {
  const a=revealArgs(ctx);
  return keccak256(AbiCoder.defaultAbiCoder().encode(['string','address','bytes32','address','address','uint64','bytes32'],[...a.slice(0,6),a[7]]));
}
export async function loadSecret(ctx,{persist=false,create=false}={}) {
  const file=path.join(ctx.dir,'secret.json');let record;
  try {
    const stat=await lstat(file);need(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600,'Secret must be regular file mode 0600');
    record=await readJSON(file);
  } catch(e) { if(e.code!=='ENOENT')throw e; }
  if(record) {
    need(record.chainId===String(CHAIN_ID)&&same(record.owner,ctx.owner)&&record.root===ROOT&&/^0x[0-9a-f]{64}$/.test(record.secret),'Secret scope mismatch');
    ctx.secret=record.secret;
  } else {
    need(create,'Missing registration secret; do not recreate an existing commitment');
    ctx.secret='0x'+randomBytes(32).toString('hex');
    if(persist) {
      await mkdir(ctx.dir,{recursive:true,mode:0o700});
      const f=await open(file,'wx',0o600);
      try {await f.writeFile(stringify({chainId:String(CHAIN_ID),owner:ctx.owner,root:ROOT,secret:ctx.secret}));await f.sync();}finally{await f.close();}
    }
  }
}
export async function removeSecret(ctx) {try{await unlink(path.join(ctx.dir,'secret.json'));}catch(e){if(e.code!=='ENOENT')throw e;}ctx.secret=undefined;}
export async function maskedRuntime(ctx,name,address) {
  let actual=(await ctx.provider.getCode(address)).slice(2).toLowerCase();
  const artifact=ctx.artifacts[name];let expected=artifact.deployedBytecode.object.replace(/^0x/,'').toLowerCase();
  need(actual.length===expected.length&&actual.length>0,name+' runtime length mismatch');
  for(const slots of Object.values(artifact.deployedBytecode.immutableReferences??{}))for(const {start,length}of slots) {
    actual=actual.slice(0,start*2)+'0'.repeat(length*2)+actual.slice((start+length)*2);
    expected=expected.slice(0,start*2)+'0'.repeat(length*2)+expected.slice((start+length)*2);
  }
  need(actual===expected,name+' runtime template mismatch');
}
export async function withLock(ctx,fn) {
  await mkdir(ctx.dir,{recursive:true,mode:0o700});const lock=path.join(ctx.dir,'operator.lock');
  try{await mkdir(lock,{mode:0o700});}catch{throw new Error('Operator lock exists; inspect outstanding attempt before manual recovery');}
  try{
    // A second process may have completed between createContext and lock acquisition.
    const latest=await readJSON(ctx.journalFile);
    if(latest){
      need(latest.schema===1&&latest.chainId===String(CHAIN_ID)&&same(latest.owner,ctx.owner)&&same(latest.guest,ctx.guest)&&latest.root===ROOT,'Journal scope changed before lock');
      ctx.journal=latest;ctx.refresh();
    }
    return await fn();
  }finally{await import('node:fs/promises').then(fs=>fs.rmdir(lock));}
}

export async function confirmedReceipt(ctx,hash,{wait=false}={}) {
  const deadline=Date.now()+180000;
  while(true){
    const receipt=await ctx.provider.getTransactionReceipt(hash);
    if(receipt){
      need(receipt.status===1,'Receipt reverted; never auto-retry');
      const block=await ctx.provider.getBlock(receipt.blockNumber);
      need(block?.hash===receipt.blockHash,'Receipt lost canonicality');
      const head=Number(BigInt(await ctx.provider.send('eth_blockNumber',[])));
      if(head-receipt.blockNumber+1>=ctx.confirmations)return receipt;
    }
    need(wait&&Date.now()<deadline,'Receipt pending or lacks required confirmations');
    await ctx.confirmationTick(hash,receipt);
  }
}
export function proofLabel(value) {
  need(typeof value==='string'&&/^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/.test(value)&&value!=='mira',
    'LIVE_PROOF_LABEL must be 3–32 lowercase letters/digits/hyphens, no edge hyphens, and must not be mira');
  return value;
}
