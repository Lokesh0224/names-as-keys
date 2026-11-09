import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Wallet, JsonRpcProvider, parseEther, id } from 'ethers';
import { createContext, loadSecret, readJSON, withLock, proofLabel, confirmedReceipt, atomicJSON } from '../context.mjs';
import { runStep, checkOrder, waitCommitAge, parseArgs, status, drySummary, main } from '../run.mjs';
import { STEPS } from '../steps.mjs';
import { liveRun } from '../live-run.mjs';
import { frontendEnv } from '../print-frontend-env.mjs';
import { INFRA, ROOT, GAS_CEILINGS, MAX_TRANSACTION_GAS } from '../config.mjs';
import { checkGasLimit, gasNumbers } from '../gas.mjs';
import { quoteFunding, checkFunding } from '../funding.mjs';
import { summarizeTrace } from '../diagnose.mjs';

// Test transport owns the node and upstream relay. No upstream write, call or estimate method allowed.
const upstream=process.env.SEPOLIA_RPC_URL??'https://sepolia.gateway.tenderly.co';
const allowed=new Set(['eth_chainId','net_version','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getStorageAt','eth_getBalance','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getProof']);
let secretBytes,privateEgress=0,upstreamCalls=0;
async function listen(server) {server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('owned Sepolia Anvil fork 12071963: terminal deployment and live proof', {timeout:540000}, async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'nak-terminal-test-'));
  let child,provider,relay;
  t.after(async()=>{
    provider?.destroy();
    if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}
    if(relay?.listening){relay.closeAllConnections();await new Promise(resolve=>relay.close(resolve));}
    await rm(dir,{recursive:true,force:true});
  });
  relay=createServer(async(req,res)=>{
    try{
      let body='';for await(const chunk of req)body+=chunk;
      const value=JSON.parse(body),calls=Array.isArray(value)?value:[value];
      if(secretBytes&&body.toLowerCase().includes(secretBytes)){privateEgress++;throw new Error();}
      assert.ok(calls.length&&calls.every(c=>c.jsonrpc==='2.0'&&allowed.has(c.method)));
      upstreamCalls++;
      const reply=await fetch(upstream,{method:'POST',headers:{'content-type':'application/json'},body,redirect:'error',signal:AbortSignal.timeout(25000)});
      const text=await reply.text();res.writeHead(reply.status,{'content-type':'application/json'}).end(text);
    }catch{res.writeHead(403).end('{"error":{"code":-32601,"message":"Test upstream refused"}}');}
  });
  const relayURL=await listen(relay);
  const portProbe=createServer();const localURL=await listen(portProbe);await new Promise(resolve=>portProbe.close(resolve));
  const versionChild=spawn('anvil',['--version'],{stdio:['ignore','pipe','ignore']});
  let version='';versionChild.stdout.on('data',chunk=>version+=String(chunk));await once(versionChild,'exit');
  t.diagnostic('Selected fork tool: '+version.split('\n')[0]);
  child=spawn('anvil',['--host','127.0.0.1','--port',new URL(localURL).port,'--chain-id','11155111','--accounts','0','--fork-url',relayURL,'--fork-block-number','12071963','--hardfork','prague','--no-storage-caching','--max-persisted-states','0','--quiet','--disable-console-log','--disable-min-priority-fee'],{stdio:'ignore'});
  child.on('error',()=>{});
  provider=new JsonRpcProvider(localURL,undefined,{cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=50;
  let ready=false;
  for(let i=0;i<120;i++){
    if(child.exitCode!==null||child.signalCode!==null)break;
    try{ready=await provider.send('eth_chainId',[])==='0xaa36a7';if(ready)break;}catch{}
    await pause(250);
  }
  assert.ok(ready,'Owned fork startup unavailable (upstream/transport details suppressed)');
  assert.equal((await provider.send('eth_getBlockByNumber',['latest',false])).number,'0xb8341b');
  const owner=Wallet.createRandom(),guest=Wallet.createRandom();
  for(const wallet of [owner,guest])await provider.send('anvil_setBalance',[wallet.address,'0x'+parseEther('10').toString(16)]);
  const env={LIVE_RPC_URL:localURL,LIVE_PRIVATE_KEY:owner.privateKey,LIVE_OWNER_ADDRESS:owner.address,LIVE_GUEST_ADDRESS:guest.address};
  const logs=[];let confirmationMines=0;
  const confirmationTick=async(hash,receipt)=>{
    const journal=await readJSON(path.join(dir,'journal.json'));
    assert.ok(!journal?.entries.some(e=>e.txHash===hash),'Step must not be recorded before sufficient confirmations');
    assert.ok(receipt,'Expected mined but unconfirmed local receipt');
    confirmationMines++;await provider.send('anvil_mine',['0x2']);
  };
  const context=()=>createContext(env,{provider,stateDir:path.join(dir,'state'),journalFile:path.join(dir,'journal.json'),proofFile:path.join(dir,'proof.md'),log:line=>logs.push(line),confirmationTick,waitTick:async()=>{await provider.send('evm_increaseTime',[61]);await provider.send('evm_mine',[]);}});
  let ctx=await context();
  const scenario=(name,fn)=>t.test(name,async()=>{try{return await fn();}catch(e){if(e.transaction||e.info||e.request||e.payload)throw new Error('RPC test failure; transport/payload suppressed; scenario: '+name);throw e;}});
  await scenario('dry default, strict CLI, step-order refusal',async()=>{
    assert.equal(parseArgs(['--step','T03']).execute,false);
    assert.equal(ctx.confirmations,3);
    assert.equal(parseArgs(['--status']).status,true);
    assert.equal(parseArgs(['--diagnose','T12']).diagnose,'T12');
    assert.throws(()=>parseArgs(['--diagnose','T12','--execute']),/alone/);
    assert.throws(()=>parseArgs(['--diagnose','T14']),/T12/);
    assert.throws(()=>parseArgs(['--status','--execute']));
    assert.throws(()=>parseArgs(['--step','T15']),/allow-mira/);
    assert.equal(parseArgs(['--step','T15','--allow-mira']).allowMira,true);
    assert.equal(parseArgs(['--from','T03','--to','T14']).to,'T14');
    await assert.rejects(runStep(ctx,'T15',{execute:true}),/allow-mira/);
    for(const value of ['', '0', '-1', '1.5', 'abc'])await assert.rejects(createContext({...env,LIVE_CONFIRMATIONS:value},{provider,stateDir:path.join(dir,'config-only'),journalFile:path.join(dir,'config-only.json'),proofFile:path.join(dir,'config-only.md')}),/CONFIRMATIONS/);
    const custom=await createContext({...env,LIVE_CONFIRMATIONS:'5'},{provider,stateDir:path.join(dir,'config-only'),journalFile:path.join(dir,'config-only.json'),proofFile:path.join(dir,'config-only.md')});assert.equal(custom.confirmations,5);
    for(const value of ['mira','ab','Aaa','-abc','abc-','a_b','a'.repeat(33)])assert.throws(()=>proofLabel(value),/PROOF_LABEL/);
    for(const value of ['proofrun','abc','a-1','a'.repeat(32)])assert.equal(proofLabel(value),value);
    const empty=await status(ctx);assert.equal(empty.rows.length,14);assert.equal(empty.nextRunnable,'T01');
    assert.ok(empty.rows.every(r=>r.state==='not-run'));
    assert.equal(await readJSON(ctx.journalFile),null);
    assert.throws(()=>parseArgs(['--step','T03','--execute=yes']));
    assert.throws(()=>checkOrder(ctx,'T03'),/Previous step/);
    await assert.rejects(runStep(ctx,'T03'),/Previous step/);
    const before=await provider.getTransactionCount(owner.address);
    assert.ok((await runStep(ctx,'T01')).dryRun);
    assert.equal(await provider.getTransactionCount(owner.address),before);
    assert.equal(await readJSON(ctx.journalFile),null);
    assert.ok(logs.some(line=>/T01 target=MockUSDC@.*function=mint estimatedGas=/.test(line)));
    assert.ok(logs.some(line=>line.includes('maxFeePerGasWei=2000000000')));
  });
  await scenario('per-step ceilings retain ordinary limits and enforce padded/transaction caps',async()=>{
    for(let n=1;n<=15;n++){
      const step='T'+String(n).padStart(2,'0');
      assert.equal(GAS_CEILINGS[step],[12,14].includes(n)?MAX_TRANSACTION_GAS:3000000n);
      assert.ok(GAS_CEILINGS[step]<=MAX_TRANSACTION_GAS);
    }
    const caught=summarizeTrace({type:'CREATE',gasUsed:'0x100',calls:[{type:'STATICCALL',to:INFRA.VerifiableFactory,input:'0x12345678dead',gasUsed:'0x80',error:'out of gas'}]});
    assert.equal(caught.innerOutOfGas,true);assert.equal(caught.caughtOutOfGas,true);assert.equal(caught.frames[1].selector,'0x12345678');
    assert.equal(summarizeTrace({type:'CREATE',gasUsed:'0x100',error:'out of gas'}).innerOutOfGas,false);
    for(let n=1;n<=15;n++){
      if([12,14].includes(n))continue;
      const step='T'+String(n).padStart(2,'0');
      assert.equal(checkGasLimit(step,2500000n).gasLimit,3000000n);
      assert.throws(()=>checkGasLimit(step,2500001n),/gasLimit=3000002.*ceiling=3000000.*per-step/);
    }
    for(const step of ['T12','T14']){
      for(const estimate of [1n,3000001n,14673850n,MAX_TRANSACTION_GAS*100n/105n]){
        const padded=(estimate*110n+99n)/100n;
        assert.equal(checkGasLimit(step,estimate).gasLimit,padded>MAX_TRANSACTION_GAS?MAX_TRANSACTION_GAS:padded);
      }
      assert.equal(checkGasLimit(step,14673850n).gasLimit,16141235n);
      const boundary=MAX_TRANSACTION_GAS*100n/105n;
      assert.equal(checkGasLimit(step,boundary).gasLimit,MAX_TRANSACTION_GAS);
      assert.throws(()=>checkGasLimit(step,boundary+1n),/minimum 5% headroom/);
      assert.throws(()=>checkGasLimit(step,MAX_TRANSACTION_GAS),/minimum 5% headroom/);
      assert.throws(()=>checkGasLimit(step,MAX_TRANSACTION_GAS+1n),/raw estimate protocol cap/);
    }
    assert.equal(ctx.reserveWei,1000000000000000n);
    const reserveContext=await createContext({...env,LIVE_RESERVE_WEI:'123'},{provider,stateDir:path.join(dir,'reserve-config'),journalFile:path.join(dir,'reserve-config.json')});
    assert.equal(reserveContext.reserveWei,123n);
    for(const value of ['-1','1.5','abc'])await assert.rejects(createContext({...env,LIVE_RESERVE_WEI:value},{provider,stateDir:path.join(dir,'reserve-config'),journalFile:path.join(dir,'reserve-config.json')}),/RESERVE/);
  });
  await scenario('wrong signer and actual wrong-chain refusal',async()=>{
    await assert.rejects(createContext({...env,LIVE_OWNER_ADDRESS:guest.address},{provider,stateDir:path.join(dir,'config-only'),journalFile:path.join(dir,'config-only.json'),proofFile:path.join(dir,'config-only.md')}),/Signer/);
    await provider.send('anvil_setChainId',[31337]);
    try{await assert.rejects(createContext(env,{provider,stateDir:path.join(dir,'config-only'),journalFile:path.join(dir,'config-only.json'),proofFile:path.join(dir,'config-only.md')}),/Wrong chain/);}finally{await provider.send('anvil_setChainId',[11155111]);}
  });
  await scenario('T01/T02 exact quote skip without broadcasts',async()=>{
    const snap=await provider.send('evm_snapshot',[]);
    try{
      await runStep(ctx,'T01',{execute:true});await runStep(ctx,'T02',{execute:true});
      const skip=await createContext(env,{provider,stateDir:path.join(dir,'skip'),journalFile:path.join(dir,'skip.json'),log:()=>{},confirmationTick});
      const before=await provider.getTransactionCount(owner.address);
      assert.ok((await runStep(skip,'T01',{execute:true})).skipped);
      assert.ok((await runStep(skip,'T02',{execute:true})).skipped);
      assert.equal(await provider.getTransactionCount(owner.address),before);
      assert.deepEqual(skip.journal.entries.map(e=>e.status),['SKIPPED','SKIPPED']);
      const extra=await ctx.signer.sendTransaction({to:INFRA.MockUSDC,data:ctx.interfaces.MockUSDC.encodeFunctionData('mint',[owner.address,1])});await extra.wait();
      const surplus=await createContext(env,{provider,stateDir:path.join(dir,'surplus'),journalFile:path.join(dir,'surplus.json'),log:()=>{},confirmationTick});
      const nonce=await provider.getTransactionCount(owner.address);
      assert.ok((await runStep(surplus,'T01',{execute:true})).skipped);
      assert.ok((await runStep(surplus,'T02',{execute:true})).skipped);
      assert.equal(await provider.getTransactionCount(owner.address),nonce);
      const seen=await status(surplus);assert.equal(seen.rows[0].state,'verified');assert.equal(seen.rows[1].state,'verified');
      const bad=await ctx.signer.sendTransaction({to:INFRA.MockUSDC,data:ctx.interfaces.MockUSDC.encodeFunctionData('approve',[INFRA.ETHRegistrar,BigInt(surplus.journal.entries[1].facts.price)+1n])});await bad.wait();
      await assert.rejects(STEPS.T03.preconditions(surplus),/Exact rent allowance/);
    }finally{await provider.send('evm_revert',[snap]);await rm(path.join(dir,'state'),{recursive:true,force:true});await rm(path.join(dir,'journal.json'),{force:true});ctx=await context();}
  });
  await scenario('T01–T03 signed locally; secret 0600 and recoverable across reload',async()=>{
    for(const step of ['T01','T02'])await runStep(ctx,step,{execute:true});
    const broadcast=provider.broadcastTransaction.bind(provider);let sends=0;
    provider.broadcastTransaction=async raw=>{sends++;await broadcast(raw);throw new Error('Synthetic lost send response');};
    try{await assert.rejects(runStep(ctx,'T03',{execute:true}),/Synthetic lost send response/);}finally{provider.broadcastTransaction=broadcast;}
    assert.equal(sends,1);
    const journalBefore=await readFile(ctx.journalFile,'utf8');
    const pending=await status(ctx);assert.equal(pending.rows[2].state,'pending');assert.ok(pending.rows[2].txHash);assert.equal(pending.nextRunnable,null);
    assert.equal(await readFile(ctx.journalFile,'utf8'),journalBefore);
    const hash=pending.rows[2].txHash;
    await assert.rejects(confirmedReceipt(ctx,hash),/confirmations/);
    await runStep(ctx,'T03',{execute:true}); // receipt reconciliation only
    assert.equal(sends,1);
    const secretFile=path.join(ctx.dir,'secret.json');assert.equal((await stat(secretFile)).mode&0o777,0o600);
    const a=JSON.parse(await readFile(secretFile,'utf8'));secretBytes=a.secret.slice(2);
    ctx=await context();await loadSecret(ctx);assert.ok(ctx.secret===a.secret,'Recovered secret differs (values suppressed)');
    const nonce=await provider.getTransactionCount(owner.address);
    await runStep(ctx,'T03',{execute:true});assert.equal(await provider.getTransactionCount(owner.address),nonce);
  });
  await scenario('commit age enforced; wait uses onchain time travel; T04 deletes secret only after verification',async()=>{
    await assert.rejects(STEPS.T04.preconditions(ctx),/too young/);
    const snapshot=await provider.send('evm_snapshot',[]);
    const committed=BigInt(ctx.derived.commitmentAt),maximum=await ctx.read('ETHRegistrar','MAX_COMMITMENT_AGE');
    try{
      await provider.send('evm_setNextBlockTimestamp',[Number(committed+maximum)]);await provider.send('evm_mine',[]);
      await assert.rejects(STEPS.T04.preconditions(ctx),/expired/);
    }finally{await provider.send('evm_revert',[snapshot]);}
    await waitCommitAge(ctx);
    const at=await ctx.read('ETHRegistrar','commitmentAt',[ctx.derived.commitment]);
    assert.ok(await ctx.time()>=at+await ctx.read('ETHRegistrar','MIN_COMMITMENT_AGE'));
    const dryStart=logs.length;
    await runStep(ctx,'T04');
    const dry=logs.slice(dryStart);assert.equal(dry.length,1);assert.match(dry[0],/^T04 function=register calldataBytes=\d+$/);
    await runStep(ctx,'T04',{execute:true});await assert.rejects(stat(path.join(ctx.dir,'secret.json')),{code:'ENOENT'});
    assert.ok(ctx.derived.rootTokenId);
  });
  await scenario('T05–T14 stop before Mira; dry expiries and read-only status',async()=>{
    for(let n=5;n<=14;n++){
      ctx=await context();
      if(n===8){const start=logs.length;await runStep(ctx,'T08');assert.ok(logs.slice(start).some(line=>/expiry=\d{4}-.*Z lockExpiry=.+rootExpiry=.+PASS/.test(line)));}
      if(n===12||n===14){
        const step='T'+n,start=logs.length;
        const measured=await runStep(ctx,step);
        assert.ok(measured.estimatedGas<GAS_CEILINGS[step]);
        assert.ok(measured.gasLimit<=GAS_CEILINGS[step]);
        assert.equal(measured.gasLimit,gasNumbers(step,measured.estimatedGas).gasLimit);
        assert.ok(logs.slice(start).some(line=>line.includes('estimatedGas='+measured.estimatedGas+' gasLimit='+measured.gasLimit+' gasCeiling='+MAX_TRANSACTION_GAS)));
        assert.ok(logs.slice(start).some(line=>line.includes('protocolCap='+MAX_TRANSACTION_GAS)&&line.includes('headroomPercent=')&&line.includes('requiredETH=')&&line.includes('currentBalanceETH=')));
        t.diagnostic('Measured owned-fork '+step+' estimatedGas='+measured.estimatedGas+' gasLimit='+measured.gasLimit+' ceiling='+measured.ceiling);
        if(n===12){
          const diagnosticEnv={LIVE_RPC_URL:localURL,LIVE_OWNER_ADDRESS:owner.address};
          Object.defineProperty(diagnosticEnv,'LIVE_PRIVATE_KEY',{get(){throw new Error('Diagnostic must never access live private key');}});
          const before=await readFile(ctx.journalFile,'utf8'),nonce=await provider.getTransactionCount(owner.address),head=await provider.send('eth_blockNumber',[]);
          const diagnosticLogs=[];
          const report=await main(['--diagnose','T12'],diagnosticEnv,{journalFile:ctx.journalFile,log:line=>diagnosticLogs.push(line)});
          assert.ok(BigInt(report.gasUsed)>0n);
          assert.equal(report.hashes.length,7);
          assert.deepEqual(report.calls.map(c=>c.gas),[3000000,6000000,12000000]);
          for(const call of report.calls){
            assert.equal(typeof call.success,'boolean');
            if(BigInt(call.gas)>=measured.gasLimit)assert.ok(call.success);
            if(!call.success)assert.equal(typeof call.revert,'string');
          }
          assert.equal(report.trace.frames.length,10);
          assert.equal(typeof report.trace.innerOutOfGas,'boolean');
          assert.ok(['drift','caught-OOG','provider estimate','other'].includes(report.conclusion));
          assert.ok(diagnosticLogs.some(line=>line.includes('gasUsed='+report.gasUsed)));
          for(const value of [localURL,upstream,owner.privateKey,guest.privateKey,secretBytes])assert.ok(!diagnosticLogs.join('\n').includes(value));
          assert.equal(await readFile(ctx.journalFile,'utf8'),before);
          assert.equal(await provider.getTransactionCount(owner.address),nonce);
          assert.equal(await provider.send('eth_blockNumber',[]),head,'Diagnostic must not mine or send on upstream');
          t.diagnostic('T12 diagnostic command on owned fork reports gasUsed='+report.gasUsed+' frames='+report.trace.frames.length);
        }

        const estimate=provider.estimateGas.bind(provider),broadcast=provider.broadcastTransaction.bind(provider);
        const beforeNonce=await provider.getTransactionCount(owner.address),beforeJournal=await readFile(ctx.journalFile,'utf8');
        let broadcasts=0;
        const refusedEstimate=MAX_TRANSACTION_GAS*100n/105n+1n;
        provider.estimateGas=async()=>refusedEstimate;
        provider.broadcastTransaction=async()=>{broadcasts++;throw new Error('Unexpected broadcast during refused gas test');};
        try{
          const refusedStart=logs.length;
          await assert.rejects(runStep(ctx,step),new RegExp(step+'.*estimatedGas='+refusedEstimate+'.*gasLimit='+MAX_TRANSACTION_GAS+'.*ceiling='+MAX_TRANSACTION_GAS+'.*minimum 5% headroom'));
          assert.ok(logs.slice(refusedStart).some(line=>line.includes('estimatedGas='+refusedEstimate+' gasLimit='+MAX_TRANSACTION_GAS+' gasCeiling='+MAX_TRANSACTION_GAS)),'Dry-run must print numbers before refusing');
          await assert.rejects(runStep(ctx,step,{execute:true}),/minimum 5% headroom/);
          provider.estimateGas=async()=>MAX_TRANSACTION_GAS+1n;
          await assert.rejects(runStep(ctx,step,{execute:true}),/raw estimate protocol cap/);
          assert.equal(broadcasts,0);
          assert.equal(await provider.getTransactionCount(owner.address),beforeNonce);
          assert.equal(await readFile(ctx.journalFile,'utf8'),beforeJournal);
          assert.equal(await readJSON(path.join(ctx.dir,'attempts',step+'.json')),null);
        }finally{provider.estimateGas=estimate;provider.broadcastTransaction=broadcast;}
        // Funding failure must report public amounts and refuse without a signed/broadcast transaction.
        const funding=await quoteFunding(ctx,measured.gasLimit),balance=provider.getBalance.bind(provider);
        checkFunding(step,{...funding,balanceWei:funding.requiredWei});
        assert.throws(()=>checkFunding(step,{...funding,balanceWei:funding.requiredWei-1n}),/requiredETH=.*currentBalanceETH=.*reserve/);
        let balanceSends=0;provider.getBalance=async()=>0n;
        provider.broadcastTransaction=async()=>{balanceSends++;throw new Error('Unexpected insufficient-funding broadcast');};
        try{
          const start=logs.length;
          await assert.rejects(runStep(ctx,step),/requiredETH=.*currentBalanceETH=0.0.*reserve/);
          assert.ok(logs.slice(start).some(line=>line.includes('requiredETH=')&&line.includes('currentBalanceETH=0.0')));
          await assert.rejects(runStep(ctx,step,{execute:true}),/balance >= gasLimit.*reserve/);
          assert.equal(balanceSends,0);
        }finally{provider.getBalance=balance;provider.broadcastTransaction=broadcast;}
        // Force an actual OOG CREATE on the owned node; production simulation is not bypassed.
        const snapshot=await provider.send('evm_snapshot',[]);
        const failed=await createContext(env,{provider,stateDir:path.join(dir,'failed-'+step),journalFile:path.join(dir,'failed-'+step+'.json'),log:line=>logs.push(line),confirmationTick});
        failed.journal=structuredClone(ctx.journal);failed.refresh();await atomicJSON(failed.journalFile,failed.journal);
        const call=provider.call.bind(provider);let failedSends=0;
        provider.call=async()=> '0x';provider.estimateGas=async()=>measured.estimatedGas/4n;
        provider.broadcastTransaction=async raw=>{failedSends++;return broadcast(raw);};
        try{
          await assert.rejects(runStep(failed,step,{execute:true}),new RegExp('STOP '+step+' CREATE FAILED txHash=0x'));
          const attempt=await readJSON(path.join(failed.dir,'attempts',step+'.json'));
          assert.equal(attempt.status,'FAILED');assert.equal(attempt.receiptStatus,0);
          assert.ok(BigInt(attempt.gasUsed)>0n);assert.equal(attempt.gasExhausted,true);
          assert.equal((await readJSON(failed.journalFile)).entries.length,n-1);
          await assert.rejects(runStep(failed,step,{execute:true}),/previous CREATE FAILED.*no automatic retry/);
          assert.equal(failedSends,1);
          assert.ok(logs.some(line=>line.includes('STOP '+step+' CREATE FAILED txHash='+attempt.txHash)));
        }finally{
          provider.call=call;provider.estimateGas=estimate;provider.broadcastTransaction=broadcast;
          await provider.send('evm_revert',[snapshot]);
        }

      }

      await runStep(ctx,'T'+String(n).padStart(2,'0'),{execute:true});
    }
    assert.equal(ctx.journal.entries.length,14);
    const mira=await ctx.read('R2','getState',[id('mira')]);assert.equal(mira.status,0n);assert.equal(mira.expiry,0n);
    const before=await readFile(ctx.journalFile,'utf8'),nonce=await provider.getTransactionCount(owner.address);
    const result=await status(ctx);assert.ok(result.rows.every(r=>r.state==='verified'));assert.equal(result.nextRunnable,null);
    assert.equal(await readFile(ctx.journalFile,'utf8'),before);assert.equal(await provider.getTransactionCount(owner.address),nonce);
    assert.ok(confirmationMines>=14);
  });
  await scenario('T15 needs explicit opt-in; dry expiry preserves pristine Mira',async()=>{
    await assert.rejects(runStep(ctx,'T15'),/allow-mira/);
    const start=logs.length;await runStep(ctx,'T15',{allowMira:true});
    assert.ok(logs.slice(start).some(line=>/T15 target=CredentialRegistrar@.*function=issue estimatedGas=/.test(line)));
    assert.ok(logs.slice(start).some(line=>line.includes('lockExpiry<=rootExpiry=PASS')));
    const snap=await provider.send('evm_snapshot',[]);
    try{
      const isolated=await createContext(env,{provider,stateDir:path.join(dir,'mira'),journalFile:path.join(dir,'mira.json'),log:()=>{},confirmationTick});
      isolated.journal=structuredClone(ctx.journal);isolated.refresh();
      await runStep(isolated,'T15',{execute:true,allowMira:true});
      assert.equal(await isolated.read('R2','getOwner',[id('mira')]),guest.address);
    }finally{await provider.send('evm_revert',[snap]);}
    assert.equal((await ctx.read('R2','getState',[id('mira')])).expiry,0n);
  });
  await scenario('proof label/guest refusal happens without sends',async()=>{
    const nonce=await provider.getTransactionCount(owner.address);
    await assert.rejects(liveRun({...ctx,proofLabel:'mira'},{execute:true,guestPrivateKey:guest.privateKey}),/PROOF_LABEL/);
    await assert.rejects(liveRun(ctx,{execute:true}),/GUEST_PRIVATE_KEY/);
    await assert.rejects(liveRun(ctx,{execute:true,guestPrivateKey:owner.privateKey}),/Guest signer/);
    await assert.rejects(liveRun({...ctx,guest:owner.address},{execute:true,guestPrivateKey:owner.privateKey}),/differ/);
    assert.equal(await provider.getTransactionCount(owner.address),nonce);
  });
  await scenario('live-run issues proofrun for one hour, unlocks, revokes, denies; Mira remains pristine',async()=>{
    const dryStart=logs.length,nonce=await provider.getTransactionCount(owner.address);
    await liveRun(ctx,{guestPrivateKey:guest.privateKey});
    assert.ok(logs.slice(dryStart).some(line=>line.includes('PROOF_ISSUE')&&line.includes('function=issue')));
    assert.ok(logs.slice(dryStart).some(line=>line.includes('lockExpiry<=rootExpiry=PASS')));
    assert.equal(await provider.getTransactionCount(owner.address),nonce);
    assert.equal(await readJSON(path.join(ctx.dir,'proof-proofrun.json')),null);
    const before=await ctx.time();
    const proof=await withLock(ctx,()=>liveRun(ctx,{execute:true,guestPrivateKey:guest.privateKey}));
    assert.equal(proof.label,'proofrun');assert.equal(BigInt(proof.expiry),before+3600n);
    assert.deepEqual(proof.rows.map(r=>r.action),['issue','unlock','revoke']);assert.equal(proof.denied,'InvalidCredential()');
    for(const row of proof.rows){const r=await provider.getTransactionReceipt(row.txHash);assert.ok(Number(BigInt(await provider.send('eth_blockNumber',[])))-r.blockNumber+1>=3);}
    assert.equal((await ctx.read('R2','getState',[id('mira')])).expiry,0n);
    assert.equal(ctx.journal.entries.length,14);
    assert.match(await readFile(ctx.proofFile,'utf8'),/sepolia.etherscan.io\/tx\//);
    const ownerNonce=await provider.getTransactionCount(owner.address),guestNonce=await provider.getTransactionCount(guest.address);
    await liveRun(ctx,{execute:true,guestPrivateKey:guest.privateKey});
    assert.equal(await provider.getTransactionCount(owner.address),ownerNonce);assert.equal(await provider.getTransactionCount(guest.address),guestNonce);
    const custom=await createContext({...env,LIVE_PROOF_LABEL:'proof-two'},{provider,stateDir:ctx.dir,journalFile:ctx.journalFile,proofFile:ctx.proofFile,confirmationTick,log:()=>{}});
    const other=await liveRun(custom,{execute:true,guestPrivateKey:guest.privateKey});assert.equal(other.label,'proof-two');assert.equal(other.denied,'InvalidCredential()');
    assert.equal((await ctx.read('R2','getState',[id('mira')])).expiry,0n);
  });
  await scenario('frontend values are runtime hashes/receipt-derived; output contains no secret/key/URL',async()=>{
    const result=await frontendEnv(ctx);assert.match(result,/NAK_DOOR_RUNTIME_HASH=0x[0-9a-f]{64}/);
    for(const value of [owner.privateKey,guest.privateKey,secretBytes,upstream])assert.ok(!result.includes(value));
    const output=logs.join('\n');for(const value of [owner.privateKey,guest.privateKey,secretBytes,upstream])assert.ok(!output.includes(value));
    assert.equal(privateEgress,0);assert.ok(upstreamCalls>0);
  });
});
