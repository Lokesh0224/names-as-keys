import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { DeploymentWorkflow, ReadOnlyWallet, decodePacket, digest } from '../workflow.mjs';
import { fixture, packet, policy, OWNER, HASH, BLOCK, TOKEN, ABI } from './fixture.mjs';
const ready = async (f, p = f.packets[0]) => { const review = await f.workflow.prepare(p.id, p); f.workflow.acknowledge(p.id, digest(review)); return review; };
const submit = async f => { await ready(f); return f.workflow.submitTestOnly('T01'); };

test('shipped adapter refuses every write, signature and permission prompt', async () => {
  const f = fixture(), adapter = new ReadOnlyWallet(f.provider);
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'eth_sign', 'eth_requestAccounts', 'wallet_switchEthereumChain']) assert.throws(() => adapter.request({ method }), /disabled/);
  assert.equal(f.provider.calls.length, 0);
});
test('execution defaults disabled even with fake provider', async () => {
  const f = fixture([packet()], { testSubmission: false }); await assert.rejects(() => f.workflow.submitTestOnly('T01'), /disabled/);
  assert.equal(f.provider.calls.length, 0);
});
test('review displays account chain ABI types amount value nonce and fee limits', async () => {
  const f = fixture(); const r = await ready(f);
  assert.equal(r.account, OWNER); assert.equal(r.chain, '11155111'); assert.equal(r.destination, TOKEN);
  assert.deepEqual(r.argumentTypes, ['address', 'uint256']); assert.equal(r.token.amount, '8.000021'); assert.equal(r.ethValueWei, '0x0'); assert.equal(r.maxFeePerGasWei, '0x64');
});
test('correct lifecycle verifies raw receipt logs and state before advancing', async () => {
  const f = fixture([packet(), packet('T02', 1)]); await submit(f);
  assert.equal(f.workflow.state('T01').status, 'PENDING');
  await assert.rejects(() => f.workflow.prepare('T02', f.packets[1]), /preceding/);
  f.provider.mine(f.packets[0]); assert.equal(await f.workflow.reconcile('T01'), true);
  f.provider.nonce = '0x1'; await f.workflow.prepare('T02', f.packets[1]);
  assert.equal(f.workflow.state('T02').status, 'PREPARED');
});
for (const [name, mutate, pattern] of [
  ['wrong network', f => { f.provider.chain = '0x1'; }, /Wrong network/],
  ['wrong account', f => { f.provider.accounts = [TOKEN]; }, /Wrong selected account/],
  ['ENS read failure', f => { f.provider.state = '0x00'; }, /State mismatch/],
  ['runtime changed', f => { f.provider.code = '0x6001'; }, /Code mismatch/],
  ['nonce churn', f => { f.provider.nonce = '0x1'; }, /nonce changed/],
  ['stale header', f => { f.provider.header.timestamp = '0x1'; }, /Stale/],
]) test(name + ' blocks before any request', async () => {
  const f = fixture(); mutate(f); await assert.rejects(() => ready(f), pattern);
  assert.equal(f.provider.calls.filter(x => x.method === 'eth_sendTransaction').length, 0);
});
test('null inputs, bad calldata and wrong destination fail closed', async () => {
  for (const mutate of [p => { p.arguments[1] = null; }, p => { p.tx.data += '00'; }, p => { p.tx.to = OWNER; }]) {
    const p = packet(); mutate(p); const f = fixture([p]); await assert.rejects(() => ready(f));
  }
});
test('unresolved prerequisite gate blocks', async () => {
  const p = policy(); p.gates[0].status = 'UNRESOLVED'; const f = fixture([packet()], { policy: p }); await assert.rejects(() => ready(f), /gate/);
});
test('calldata cannot be swapped after frozen packet policy', async () => {
  const f = fixture(); const changed = packet(); changed.arguments[1] = '9000'; await assert.rejects(() => ready(f, changed), /frozen/);
});
test('fee and total budget ceilings block', async () => {
  for (const modify of [p => { p.maxFeePerGas = '50'; }, p => { p.maxTotalWei = '1'; }, p => { p.maxGasPerStep = '1'; }]) {
    const p = policy(); modify(p); const f = fixture([packet()], { policy: p }); await assert.rejects(() => ready(f));
  }
});
test('account change between review and submit invalidates acknowledgement', async () => {
  const f = fixture(); await ready(f); f.provider.emit('accountsChanged'); await assert.rejects(() => f.workflow.submitTestOnly('T01'), /acknowledgement/);
});
test('provider changes without an event are detected in fresh preflight', async () => {
  const f = fixture(); await ready(f); f.provider.chain = '0x1'; await assert.rejects(() => f.workflow.submitTestOnly('T01'), /Wrong network/);
});
test('async preflight chain changes invalidate result', async () => {
  const f = fixture(); let changed = false;
  f.provider.hook = async method => { if (method === 'eth_estimateGas' && !changed) { changed = true; f.provider.emit('chainChanged'); } };
  await assert.rejects(() => ready(f), /changed during preflight/);
});
test('explicit exact displayed review required', async () => {
  const f = fixture(); await f.workflow.prepare('T01', f.packets[0]); assert.throws(() => f.workflow.acknowledge('T01', 'incorrect'), /differs/);
  await assert.rejects(() => f.workflow.submitTestOnly('T01'), /acknowledgement/);
});
test('rejected requests remain recorded and never automatically retry', async () => {
  const f = fixture(); f.provider.sendError = { code: 4001 }; await assert.rejects(() => submit(f), /rejected/);
  assert.equal(f.workflow.state('T01').status, 'REJECTED'); assert.equal(f.workflow.state('T01').attempts.length, 1);
});
test('unknown send error locks nonce as uncertain', async () => {
  const f = fixture(); f.provider.sendError = { code: -32000 }; await assert.rejects(() => submit(f), /uncertain/);
  await assert.rejects(() => ready(f), /reconciliation/); assert.equal(f.workflow.state('T01').status, 'UNCERTAIN');
});
test('storage failure before request prevents provider submission', async () => {
  const f = fixture(); await ready(f); f.journal.write = () => { throw new Error('disk full'); };
  await assert.rejects(() => f.workflow.submitTestOnly('T01'), /disk full/); assert.equal(f.provider.calls.some(x => x.method === 'eth_sendTransaction'), false);
});
test('pending timeout and duplicate submission never resend', async () => {
  const f = fixture(); await submit(f); assert.equal(await f.workflow.reconcile('T01'), false);
  await assert.rejects(() => ready(f), /reconciliation/); await assert.rejects(() => f.workflow.submitTestOnly('T01'));
  assert.equal(f.provider.calls.filter(x => x.method === 'eth_sendTransaction').length, 1);
});
test('failed receipt is not confirmed', async () => {
  const f = fixture(); await submit(f); f.provider.mine(f.packets[0]); f.provider.receipts.get(HASH).status = '0x0';
  assert.equal(await f.workflow.reconcile('T01'), false); assert.equal(f.workflow.state('T01').status, 'FAILED');
});
for (const [name, mutate] of [
  ['wrong emitter', r => { r.logs[0].address = OWNER; }],
  ['wrong event value', r => { r.logs[0].data = '0x' + '0'.repeat(64); }],
  ['unexpected extra log', r => { r.logs.push(r.logs[0]); }],
  ['reorged receipt', r => { r.blockHash = '0x' + 'ff'.repeat(32); }],
  ['wrong receipt sender', r => { r.from = TOKEN; }],
  ['fee charged over cap', r => { r.effectiveGasPrice = '0xff'; }],
  ['missing receipt gas quantity', r => { r.gasUsed = null; }],
]) test(name + ' blocks confirmation', async () => {
  const f = fixture(); await submit(f); f.provider.mine(f.packets[0]); mutate(f.provider.receipts.get(HASH));
  await assert.rejects(() => f.workflow.reconcile('T01')); assert.notEqual(f.workflow.state('T01').status, 'CONFIRMED');
});
test('post-state changes block confirmation', async () => {
  const f = fixture(); await submit(f); f.provider.mine(f.packets[0]); f.provider.state = '0x00'; await assert.rejects(() => f.workflow.reconcile('T01'), /State mismatch/);
});
test('unfinalized receipt remains pending', async () => {
  const p = policy(); p.confirmations = 12; const f = fixture([packet()], { policy: p }); await submit(f); f.provider.mine(f.packets[0]);
  assert.equal(await f.workflow.reconcile('T01'), false); assert.equal(f.workflow.state('T01').status, 'PENDING');
});
test('reorg of previously confirmed ancestor blocks successor', async () => {
  const f = fixture([packet(), packet('T02', 1)]); await submit(f); f.provider.mine(f.packets[0]); await f.workflow.reconcile('T01');
  f.provider.receipts.clear(); f.provider.nonce = '0x1'; await assert.rejects(() => f.workflow.prepare('T02', f.packets[1]), /lost/);
});
test('reload never trusts previously confirmed journal state', async () => {
  const f = fixture(); await submit(f); f.provider.mine(f.packets[0]); await f.workflow.reconcile('T01');
  const reload = new DeploymentWorkflow(f.options); assert.equal(reload.state('T01').status, 'RECHECK_REQUIRED'); assert.equal(await reload.reconcile('T01'), true);
});
test('hash returned after chain change still retained as pending evidence', async () => {
  const f = fixture(); f.provider.hook = async method => { if (method === 'eth_sendTransaction') f.provider.emit('chainChanged'); };
  await submit(f); assert.equal(f.persisted().entries.T01.receiptHash, HASH); assert.equal(f.workflow.state('T01').status, 'PENDING');
});
test('replacement same frozen intent is reconciled without another request', async () => {
  const f = fixture(); await submit(f); const replacement = '0x' + '33'.repeat(32); f.provider.mine(f.packets[0], replacement);
  assert.equal(await f.workflow.adoptReplacement('T01', replacement), true); assert.equal(f.workflow.state('T01').attempts.length, 2);
});
test('changed-intent or over-ceiling replacement is blocked', async () => {
  const f = fixture(); await submit(f); const replacement = '0x' + '33'.repeat(32); f.provider.mine(f.packets[0], replacement);
  f.provider.transactions.get(replacement).maxFeePerGas = '0xff'; await assert.rejects(() => f.workflow.adoptReplacement('T01', replacement), /review/);
});
test('verified mined cancellation recorded, no automatic resend', async () => {
  const f = fixture(); await submit(f); const cancellation='0x'+'44'.repeat(32); f.provider.mine(f.packets[0],cancellation);
  const tx = f.provider.transactions.get(cancellation); tx.to = OWNER; tx.input = '0x';
  const receipt=f.provider.receipts.get(cancellation); receipt.to=OWNER; receipt.logs=[];
  assert.equal(await f.workflow.recordCancellation('T01', cancellation), true); assert.equal(f.workflow.state('T01').status, 'CANCELLED');
});
test('review and recovery journal do not disclose private registration preimage', async () => {
  const f = fixture(); const p = packet(); p.abi = ['function secret(bytes32)']; p.signature = 'secret(bytes32)'; p.arguments = ['0x' + 'ab'.repeat(32)]; p.privateArgumentIndices = [0]; p.tx.data = new Interface(p.abi).encodeFunctionData('secret', p.arguments);
  const privateFixture = fixture([p]); const review = await ready(privateFixture); await privateFixture.workflow.submitTestOnly('T01');
  assert.equal(JSON.stringify(review).includes(p.arguments[0]), false); assert.equal(JSON.stringify(privateFixture.persisted()).includes(p.arguments[0]), false);
});

test('live adapter submission seam stays disabled even with a forged GO flag', async () => {
  const f = fixture(); const adapter = new ReadOnlyWallet(f.provider);
  await assert.rejects(() => adapter.submitReviewed(packet().tx, { stage: 'GO', planDigest: HASH, packetDigest: HASH }), /disabled/);
  assert.equal(f.provider.calls.length, 0);
});
test('removed receipt log fails closed', async () => {
  const f = fixture(); await submit(f); f.provider.mine(f.packets[0]); f.provider.receipts.get(HASH).logs[0].removed = true;
  await assert.rejects(() => f.workflow.reconcile('T01'), /Removed/);
});
test('chain change while verifying receipt cannot confirm', async () => {
  const f = fixture(); await submit(f); f.provider.mine(f.packets[0]); let changed = false;
  f.provider.hook = async method => { if (method === 'eth_getTransactionReceipt' && !changed) { changed = true; f.provider.emit('chainChanged'); } };
  await assert.rejects(() => f.workflow.reconcile('T01'), /changed during receipt/);
  assert.notEqual(f.workflow.state('T01').status, 'CONFIRMED');
});
test('unresolved expected event blocks preparation, not just later reconciliation', async () => {
  const p = packet(); p.expectedEvents[0].arguments[2] = null; const f = fixture([p]);
  await assert.rejects(() => ready(f), /Unresolved receipt/);
});
test('commitment time window is enforced before request', async () => {
  const p = packet(); p.timeWindows = [{ minimum: '1700000060', maximum: '1700086400' }]; const f = fixture([p]);
  await assert.rejects(() => ready(f), /time window/);
});
test('duplicate concurrent requests are refused', async () => {
  const f = fixture(); await ready(f); let release;
  f.provider.hook = method => method === 'eth_sendTransaction' ? new Promise(resolve => { release = resolve; }) : undefined;
  const first = f.workflow.submitTestOnly('T01');
  while (!release) await new Promise(resolve => setTimeout(resolve,0));
  await assert.rejects(() => f.workflow.submitTestOnly('T01'), /busy/); release(); await first;
  assert.equal(f.provider.calls.filter(x => x.method === 'eth_sendTransaction').length,1);
});
test('browser journal persists public locks but rejects calldata and raw arguments', async () => {
  const { BrowserJournal } = await import('../workflow.mjs'); let stored;
  const storage = { getItem: () => stored, setItem: (_key,value) => { stored = value; } }; const journal = new BrowserJournal(storage,'test-only');
  journal.write({ schema:1,planDigest:HASH,entries:{T01:{status:'UNCERTAIN',attempts:[{nonce:'0x0',hash:null}]}},history:[] });
  assert.equal(journal.read().entries.T01.status,'UNCERTAIN');
  assert.throws(() => journal.write({schema:1,planDigest:HASH,entries:{arguments:['private']},history:[]}), /forbidden/);
});
test('hierarchy builders use the retained deployed ABIs and forbid wrong-owner snapshots', async () => {
  const { readFile } = await import('node:fs/promises'); const { hierarchyChecks, FIXED } = await import('../guards.mjs');
  const abis={}; for(const name of ['ETHRegistry','RootRegistry','UserRegistryImpl','VerifiableFactory']) abis[name]=JSON.parse(await readFile(new URL('../../../..'+'/docs/prep/stage3e/abis/'+name+'.json',import.meta.url),'utf8'));
  const b={owner:OWNER,r1:TOKEN,r2:'0x0000000000000000000000000000000000002345',rootLabel:'nak-test-only',rootState:[2,1800000000,OWNER,1,2],lockState:[2,1750000000,OWNER,3,4],referenceTimestamp:1700000000,registrar:'0x0000000000000000000000000000000000003456'};
  const { keccak256 }=await import('ethers'); b.runtimeHashes=Object.fromEntries([...Object.values(FIXED),b.r1,b.r2].map(a=>[a.toLowerCase(),keccak256('0x6000')]));
  const checks=hierarchyChecks(abis,b); assert.equal(checks.length,28); assert.ok(checks.some(x=>x.id==='EXACT_REGISTRAR_ROLES'));
  b.rootState[2]=TOKEN; assert.throws(()=>hierarchyChecks(abis,b),/wrong-owner/);
});

test('direct CREATE review binds sender nonce constructor ABI and predicted address', async () => {
  const { getCreateAddress } = await import('ethers'); const p=packet();
  p.creation=true; p.abi=['constructor(address)']; p.signature='constructor(address)'; p.arguments=[OWNER]; p.creationBytecode='0x6000';
  p.expectedAddress=getCreateAddress({from:OWNER,nonce:0}); p.tx.to=''; p.tx.data=p.creationBytecode+new Interface(p.abi).encodeDeploy(p.arguments).slice(2); p.expectedEvents=[];
  const f=fixture([p]); const r=await ready(f); assert.ok(r.destination.includes(p.expectedAddress));
  const bad=structuredClone(p); bad.expectedAddress=TOKEN; const invalid=fixture([bad]); await assert.rejects(()=>ready(invalid),/predicted CREATE/);
});
test('unreviewed transaction fields are rejected', async () => {
  const p=packet(); p.tx.authorizationList=[]; const f=fixture([p]); await assert.rejects(()=>ready(f),/transaction fields/);
});
test('noncanonical JSON-RPC integer encodings rejected', async () => {
  const p=packet(); p.tx.nonce='0x00'; const f=fixture([p]); await assert.rejects(()=>ready(f),/quantity/);
});
test('two event values cannot be reordered or duplicated', async () => {
  const { verifyEvents }=await import('../workflow.mjs'); const iface=new Interface(ABI);
  const events=[1,2].map(n=>({address:TOKEN,abi:ABI,signature:'Transfer(address,address,uint256)',arguments:[OWNER,TOKEN,n]}));
  const logs=events.map((e,i)=>({address:TOKEN,...iface.encodeEventLog(iface.getEvent('Transfer'),e.arguments),logIndex:'0x'+i}));
  verifyEvents({logs},events);
  assert.throws(()=>verifyEvents({logs:[logs[1],logs[0]]},events));
  assert.throws(()=>verifyEvents({logs:[logs[0],logs[0]]},events));
});
test('insufficient ETH and estimate growth block the request', async () => {
  const p=packet(); p.prerequisites.push({id:'GAS_ETH',kind:'balance',to:OWNER,minimumWei:'999999999999999999999999999999999999'});
  await assert.rejects(()=>ready(fixture([p])),/Insufficient ETH/);
  const f=fixture(); f.provider.hook=method=>{if(method==='eth_estimateGas')throw new Error('estimate unavailable');};
  await assert.rejects(()=>ready(f),/estimate unavailable/);
});
test('live submission flag cannot override the compiled disabled policy', async () => {
  const f=fixture([packet()],{testSubmission:false,executionEnabled:true});
  await assert.rejects(()=>f.workflow.submitReviewed('T01'),/disabled/); assert.equal(f.provider.calls.length,0);
});

test('token display cannot hide a different decoded amount or spender', async () => {
  const p=packet(); p.tokenReview.units='1'; await assert.rejects(()=>ready(fixture([p])),/Token summary/);
  const q=packet(); q.tokenReview.amount='0.000001'; await assert.rejects(()=>ready(fixture([q])),/Token display/);
  const a=packet(); a.abi=['function approve(address,uint256)','event Approval(address indexed owner,address indexed spender,uint256 value)']; a.signature='approve(address,uint256)';
  a.tx.data=new Interface(a.abi).encodeFunctionData('approve',a.arguments); a.tokenReview.spender=TOKEN;
  await assert.rejects(()=>ready(fixture([a])),/spender display/);
});
