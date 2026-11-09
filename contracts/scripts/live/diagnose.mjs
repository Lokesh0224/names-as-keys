// No Wallet, signer, private key, authorization writer or deployment journal writer on this path.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { Interface, getAddress, keccak256, toQuantity } from 'ethers';
import { INFRA, ROOT, CHAIN_ID } from './config.mjs';
import { artifacts, REPO, readJSON, need, same } from './context.mjs';
const BASELINE=12071963;
const READS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getStorageAt','eth_getBalance','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getProof','net_version']);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function revertBytes(value) {
  if(typeof value==='string'&&/^0x[0-9a-f]*$/i.test(value))return value;
  if(value&&typeof value==='object')for(const key of ['data','originalError','return','result']){const bytes=revertBytes(value[key]);if(bytes)return bytes;}
}
function oog(error){return typeof error==='string'&&/out.?of.?gas|outofgas/i.test(error);}
function decodedError(error,interfaces) {
  const data=error.revertData;
  if(data)for(const iface of interfaces){try{const decoded=iface.parseError(data);if(decoded)return decoded.name;}catch{}}
  if(oog(error.rpcMessage))return 'OutOfGas (RPC classification)';
  return data&&data!=='0x'?'UnknownRevert('+data.slice(0,10)+')':'RPCError (no decoded revert data)';
}
function rpcClient(url,allowed) {
  return async(method,params=[])=>{
    need(allowed.has(method),'Diagnostic RPC method not allowed');
    let response,value;
    try{
      response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'error',signal:AbortSignal.timeout(30000)});
      value=await response.json();
    }catch{need(false,'Diagnostic RPC unavailable (transport details suppressed)');}
    if(!response.ok||value.error||!('result' in value)){
      const error=new Error('Diagnostic RPC request failed (details suppressed)');
      // Held only for in-memory revert-name classification. Never printed verbatim.
      error.revertData=revertBytes(value.error?.data);error.rpcMessage=value.error?.message;throw error;
    }
    return value.result;
  };
}
async function listen(server){
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return 'http://127.0.0.1:'+server.address().port;
}
export function summarizeTrace(trace) {
  const frames=[];let innerOutOfGas=false;
  function walk(frame,depth=0){
    need(frame&&typeof frame==='object','Invalid callTracer frame');
    const gas=BigInt(frame.gasUsed??0),isCreate=['CREATE','CREATE2'].includes(frame.type);
    if(depth>0&&oog(frame.error))innerOutOfGas=true;
    frames.push({target:/^0x[0-9a-f]{40}$/i.test(frame.to??'')?frame.to:'(creation/unknown)',
      selector:isCreate?'(constructor)':/^0x[0-9a-f]{8}/i.test(frame.input??'')?frame.input.slice(0,10):'0x',gas:String(gas),depth});
    for(const child of frame.calls??[])walk(child,depth+1);
  }
  walk(trace);
  frames.sort((a,b)=>BigInt(a.gas)>BigInt(b.gas)?-1:BigInt(a.gas)<BigInt(b.gas)?1:0);
  return {frames:frames.slice(0,10),innerOutOfGas,caughtOutOfGas:innerOutOfGas&&!trace.error};
}
export async function diagnoseT12(env=process.env,{journalFile=path.join(REPO,'contracts/deployments/sepolia.live.json'),log=console.log}={}) {
  need(env.LIVE_RPC_URL&&env.LIVE_OWNER_ADDRESS,'Diagnosis requires LIVE_RPC_URL and LIVE_OWNER_ADDRESS; no private key required');
  let owner;try{owner=getAddress(env.LIVE_OWNER_ADDRESS);}catch{need(false,'Invalid diagnostic owner address');}
  const journal=await readJSON(journalFile);
  need(journal?.schema===1&&journal.chainId===String(CHAIN_ID)&&same(journal.owner,owner)&&journal.root===ROOT&&Array.isArray(journal.entries),'Diagnostic journal scope mismatch');
  const bindings={};
  for(const [step,name]of [['T05','R1'],['T09','R2']]){
    const entry=journal.entries.find(e=>e.step===step&&e.status==='VERIFIED');
    need(entry?.derivedAddresses?.[name],'Verified receipt-derived '+name+' required in journal');
    try{bindings[name]=getAddress(entry.derivedAddresses[name]);}catch{need(false,'Invalid receipt-derived registry address');}
  }
  const localArtifacts=await artifacts(),abi=new Interface(localArtifacts.CredentialRegistrar.abi);
  const initcode=localArtifacts.CredentialRegistrar.bytecode.object+abi.encodeDeploy([owner,ROOT,bindings.R1,bindings.R2]).slice(2);
  const initcodeHash=keccak256(initcode),recorded=journal.entries.find(e=>e.step==='T12');
  if(recorded)need(recorded.envelope?.dataHash===initcodeHash,'Recorded T12 initcode differs from current artifact/constructor args');
  const rpc=rpcClient(env.LIVE_RPC_URL,new Set([...READS,'eth_call','eth_estimateGas']));
  need(BigInt(await rpc('eth_chainId'))===CHAIN_ID,'Wrong chain: diagnosis requires Sepolia 11155111');
  const head=await rpc('eth_getBlockByNumber',['latest',false]);
  need(head?.number&&head.hash,'Current head unavailable');
  const anchor=head.number,blockNumber=Number(BigInt(anchor));
  log('T12 DIAGNOSE read-only upstream; head='+blockNumber+' blockHash='+head.hash+' baseline='+BASELINE);
  log('T12 initcodeHash='+initcodeHash+' constructor owner='+owner+' R1='+bindings.R1+' R2='+bindings.R2+(recorded?' recorded hash MATCH':' reconstructed from current artifact and journal bindings; no T12 envelope recorded'));
  const hashes=[];
  for(const name of ['ETHRegistry','RootRegistry','VerifiableFactory','UserRegistryImpl','ETHRegistrar','R1','R2']){
    const address=bindings[name]??INFRA[name];let oldHash=null;
    try{oldHash=keccak256(await rpc('eth_getCode',[address,toQuantity(BASELINE)]));}catch{}
    const currentHash=keccak256(await rpc('eth_getCode',[address,anchor]));
    const differs=oldHash===null?null:oldHash!==currentHash;
    hashes.push({name,address,baselineHash:oldHash,currentHash,differs});
    log('code '+name+' '+address+' baselineHash='+(oldHash??'UNKNOWN (historical read unavailable)')+' currentHash='+currentHash+' '+(differs===null?'UNKNOWN':differs?'DIFFER':'SAME'));
  }
  const interfaces=[abi,...Object.values(localArtifacts).map(a=>new Interface(a.abi))];
  const calls=[];
  for(const gas of [3000000,6000000,12000000]){
    let result;
    try{await rpc('eth_call',[{from:owner,data:initcode,value:'0x0',gas:toQuantity(gas)},anchor]);result={gas,success:true};}
    catch(error){result={gas,success:false,revert:decodedError(error,interfaces)};}
    calls.push(result);log('eth_call gas='+gas+' '+(result.success?'SUCCESS':'REVERT '+result.revert));
  }
  let providerEstimate=null;
  try{providerEstimate=String(BigInt(await rpc('eth_estimateGas',[{from:owner,data:initcode,value:'0x0',gas:toQuantity(12000000)},anchor])));log('provider estimatedGas='+providerEstimate);}
  catch{log('provider estimatedGas=UNKNOWN (request refused)');}
  let child,relay,nodeRPC,txHash,receipt,traceSummary=null;
  try{
    // A loopback relay keeps private upstream URLs out of child argv and blocks every upstream write.
    relay=createServer(async(req,res)=>{
      try{
        if(req.method!=='POST'){res.writeHead(405).end();return;}
        let text='';for await(const chunk of req){text+=chunk;if(text.length>1048576)throw new Error();}
        const input=JSON.parse(text),batch=Array.isArray(input)?input:[input];
        need(batch.length>0&&batch.length<=100&&batch.every(c=>c?.jsonrpc==='2.0'&&READS.has(c.method)&&Array.isArray(c.params??[])),'Fork upstream method refused');
        const replies=await Promise.all(batch.map(async c=>({jsonrpc:'2.0',id:c.id,result:await rpc(c.method,c.params??[])})));
        res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(Array.isArray(input)?replies:replies[0]));
      }catch{res.writeHead(403,{'content-type':'application/json'}).end('{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Read-only fork upstream refused"}}');}
    });
    const relayURL=await listen(relay),probe=createServer(),nodeURL=await listen(probe);
    await new Promise(resolve=>probe.close(resolve));
    child=spawn('anvil',['--host','127.0.0.1','--port',new URL(nodeURL).port,'--chain-id','11155111','--accounts','0','--fork-url',relayURL,'--fork-block-number',String(blockNumber),'--hardfork','prague','--no-storage-caching','--max-persisted-states','0','--disable-console-log','--disable-min-priority-fee','--no-mining'],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME}});
    // Require this child's bind announcement before contacting its port; do not mistake a raced port for our node.
    const expectedListen='Listening on 127.0.0.1:'+new URL(nodeURL).port;
    await new Promise((resolve,reject)=>{
      let tail='';
      const timer=setTimeout(()=>reject(new Error('Owned diagnostic Anvil bind timeout (details suppressed)')),30000);
      const failed=()=>{clearTimeout(timer);reject(new Error('Owned diagnostic Anvil startup failed (details suppressed)'));};
      child.once('error',failed);child.once('exit',failed);
      child.stdout.on('data',chunk=>{tail=(tail+String(chunk)).slice(-4096);if(tail.includes(expectedListen)){clearTimeout(timer);resolve();}});
      child.stderr.resume(); // discard native errors; they may contain transport metadata
    });
    const rawLocal=rpcClient(nodeURL,new Set([...READS,'anvil_impersonateAccount','eth_sendTransaction','anvil_mine','debug_traceTransaction']));
    nodeRPC=async(method,params=[])=>{need(child.pid&&child.exitCode===null&&child.signalCode===null,'Owned diagnostic Anvil is not running');return rawLocal(method,params);};
    let ready=false;
    for(let n=0;n<120;n++){
      if(child.exitCode!==null||child.signalCode!==null)break;
      try{ready=BigInt(await nodeRPC('eth_chainId'))===CHAIN_ID;if(ready)break;}catch{}
      await pause(250);
    }
    need(ready,'Owned diagnostic Anvil startup failed');
    need((await nodeRPC('eth_getBlockByNumber',[anchor,false]))?.hash===head.hash,'Owned fork head/hash mismatch');
    await nodeRPC('anvil_impersonateAccount',[owner]);
    const base=BigInt(head.baseFeePerGas??0);
    txHash=await nodeRPC('eth_sendTransaction',[{from:owner,data:initcode,value:'0x0',gas:toQuantity(12000000),gasPrice:toQuantity(base*2n+1n)}]);
    await nodeRPC('anvil_mine',['0x1']);
    receipt=await nodeRPC('eth_getTransactionReceipt',[txHash]);need(receipt?.gasUsed,'Local creation receipt unavailable');
    log('OWNED FORK creation gasUsed='+BigInt(receipt.gasUsed)+' status='+BigInt(receipt.status)+' (not a Sepolia broadcast)');
    const trace=await nodeRPC('debug_traceTransaction',[txHash,{tracer:'callTracer'}]);
    traceSummary=summarizeTrace(trace);
    log('Most expensive call frames (inclusive gasUsed; not additive):');
    for(const frame of traceSummary.frames)log('target='+frame.target+' selector='+frame.selector+' gas='+frame.gas+' depth='+frame.depth);
    log('Inner call out-of-gas: '+(traceSummary.innerOutOfGas?'YES':'NO')+'; caught by successful parent: '+(traceSummary.caughtOutOfGas&&BigInt(receipt.status)===1n?'YES':'NO'));
  }finally{
    if(child?.pid&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
    if(relay?.listening){relay.closeAllConnections();await new Promise(resolve=>relay.close(resolve));}
  }
  need((await rpc('eth_getBlockByNumber',[anchor,false]))?.hash===head.hash,'Diagnostic anchor reorged; discard conclusions');
  const gasUsed=BigInt(receipt.gasUsed),caught=traceSummary.caughtOutOfGas&&BigInt(receipt.status)===1n;
  const drift=hashes.some(h=>h.differs&&(!['R1','R2'].includes(h.name)||h.baselineHash!==keccak256('0x')));
  // Evidence classification, not a proof of the remote provider's implementation.
  const estimateIssue=BigInt(receipt.status)===1n&&(!calls.find(c=>c.gas===12000000).success||(providerEstimate!==null&&(BigInt(providerEstimate)<gasUsed||BigInt(providerEstimate)*100n>gasUsed*120n)));
  const conclusion=caught?'caught-OOG':drift?'drift':estimateIssue?'provider estimate':'other';
  log('Conclusion: '+conclusion+(conclusion==='other'?' (no drift/caught-OOG/provider mismatch demonstrated)':' (evidence category; not definitive root-cause proof)'));
  return {head:blockNumber,hashes,calls,providerEstimate,gasUsed:String(gasUsed),trace:traceSummary,conclusion};
}
