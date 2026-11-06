/** Owned loopback fork upstream. Reject writes, eth_call and any private-preimage bytes. */
import { createServer } from 'node:http';
import { UPSTREAM } from './common.mjs';
export const FORK_READS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getStorageAt','eth_getBalance','eth_getTransactionCount','eth_gasPrice','eth_getProof','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getTransactionByBlockHashAndIndex','eth_getTransactionByBlockNumberAndIndex']);
export function allowedForward(payload,privateHex=null){
  const text=JSON.stringify(payload).toLowerCase();
  if(privateHex && text.includes(privateHex.replace(/^0x/,'').toLowerCase()))return false;
  const batch=Array.isArray(payload)?payload:[payload];
  return batch.length>0 && batch.length<=100 && batch.every(p=>p?.jsonrpc==='2.0'&&FORK_READS.has(p.method)&&Array.isArray(p.params));
}
export async function startUpstreamProxy(){
  let privateHex=null;
  const stats={forwarded:{},blocked:0};
  const server=createServer(async(req,res)=>{
    try{
      if(req.method!=='POST')throw new Error();
      let body='';for await(const chunk of req){body+=chunk; if(body.length>2_000_000)throw new Error();}
      const payload=JSON.parse(body);
      if(!allowedForward(payload,privateHex)){++stats.blocked;throw new Error();}
      for(const p of Array.isArray(payload)?payload:[payload])stats.forwarded[p.method]=(stats.forwarded[p.method]??0)+1;
      const response=await fetch(UPSTREAM,{method:'POST',headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(25000)});
      const text=await response.text();
      if(privateHex&&text.toLowerCase().includes(privateHex.slice(2).toLowerCase()))throw new Error();
      res.writeHead(200,{'content-type':'application/json'});res.end(text);
    }catch{res.writeHead(400,{'content-type':'application/json'});res.end('{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Read-only fork upstream guard"}}');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:'http://127.0.0.1:'+server.address().port,stats,protect:value=>{privateHex=value;},close:async()=>{server.closeIdleConnections();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));privateHex=null;}};
}
