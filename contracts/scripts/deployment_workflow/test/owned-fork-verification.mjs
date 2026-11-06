// Explicit opt-in integration verification. The fixture writes only to owned loopback Anvil.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Interface, toQuantity } from 'ethers';
import { loadCandidateBundle } from '../candidate_bundle.mjs';
import { estimateOnOwnedFork, privateEstimateHandler } from '../private_server.mjs';
import { privateEstimator } from '../private_transport.mjs';
import { OUT, UPSTREAM } from '../../deployment_candidate/common.mjs';
import { allowedForward } from '../../deployment_candidate/upstream_proxy.mjs';
import path from 'node:path';

const nativeFetch = globalThis.fetch;
const nativeEmit = Server.prototype.emit;
const nativeListen = Server.prototype.listen;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bundle = await loadCandidateBundle(path.join(OUT, 'reviewer-corrections'));
const { inputs, plan, addresses, abis, observation } = bundle;
const registrar = new Interface(abis.ETHRegistrar);
const token = new Interface(abis.MockUSDC);
const reveal = plan.transactions[3];
const secretBytes = randomBytes(32);
const secret = '0x' + secretBytes.toString('hex');
const args = [...reveal.candidateArguments];
args[2] = secret;
const data = registrar.encodeFunctionData(reveal.signature, args);
const absentBytes = randomBytes(32);
const absentSecret = '0x' + absentBytes.toString('hex');
const absentArgs = [...args];
absentArgs[2] = absentSecret;
const absentData = registrar.encodeFunctionData(reveal.signature, absentArgs);
const containsPrivate = text => [secret, data, absentSecret, absentData].some(value => text.toLowerCase().includes(value.slice(2).toLowerCase()));
const stats = { fixtureUpstreamReads: 0, estimatorIngress: {}, estimatorUpstreamReads: 0, privateIngress: 0, privateEgress: 0 };
let stage = 'setup';
let child, fixture, relay, endpoint, tracking = false, pinned, caseName;
const proxies = new Set(), probes = new Set(), verified = {};
let chainChecked = false, hashChecked = false;

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
const json = (method, params) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
const headers = { 'content-type': 'application/json' };

try {
  // Fixture fallback uses native fetch directly, so the test override cannot
  // recurse or redirect these allowlisted, secret-filtered public state reads.
  relay = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      if (containsPrivate(body)) { stats.privateEgress++; throw new Error(); }
      assert.ok(allowedForward(JSON.parse(body), secret));
      stats.fixtureUpstreamReads++;
      const reply = await nativeFetch(UPSTREAM, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(25000) });
      const text = await reply.text();
      assert.ok(!containsPrivate(text));
      res.writeHead(reply.status, headers).end(text);
    } catch { res.writeHead(400).end(); }
  });
  const relayURL = await listen(relay);
  const portProbe = createServer();
  const probeURL = await listen(portProbe);
  await close(portProbe);
  fixture = probeURL;
  child = spawn('anvil', ['--host','127.0.0.1','--port',new URL(fixture).port,'--accounts','0',
    '--chain-id','11155111','--hardfork','prague','--quiet','--disable-console-log','--no-storage-caching',
    '--max-persisted-states','0','--disable-min-priority-fee','--fork-url',relayURL,
    '--fork-block-number',observation.blockNumber], { stdio: 'ignore' });
  child.on('error', () => {});
  async function fixtureRPC(method, params = []) {
    assert.ok(child.pid && child.exitCode === null && child.signalCode === null);
    const res = await nativeFetch(fixture, { method: 'POST', headers, body: json(method, params), redirect: 'error', signal: AbortSignal.timeout(25000) });
    const reply = await res.json();
    if (reply.error || !('result' in reply)) throw new Error('Fixture RPC failed: ' + method);
    return reply.result;
  }
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { ready = await fixtureRPC('eth_chainId') === '0xaa36a7'; if (ready) break; }
    catch { await sleep(250); }
  }
  assert.ok(ready);
  assert.equal((await fixtureRPC('eth_getBlockByNumber',[observation.block,false])).hash, observation.blockHash);
  const call = async (address, iface, name, values, block = 'latest') =>
    iface.decodeFunctionResult(name, await fixtureRPC('eth_call',[{to:address,data:iface.encodeFunctionData(name,values)},block]));
  await fixtureRPC('anvil_impersonateAccount',[inputs.owner]);
  async function send(step, address, iface, name, values) {
    const nonce = await fixtureRPC('eth_getTransactionCount',[inputs.owner,'pending']);
    assert.equal(nonce, plan.transactions[step].candidateNonce);
    const head = await fixtureRPC('eth_getBlockByNumber',['latest',false]);
    const tx = {from:inputs.owner,to:address,nonce,
      data:iface.encodeFunctionData(name,values),chainId:'0xaa36a7',value:'0x0',
      maxFeePerGas:toQuantity(2n*BigInt(head.baseFeePerGas)+1n),maxPriorityFeePerGas:'0x1'};
    const gas = BigInt(await fixtureRPC('eth_estimateGas',[tx]));
    assert.ok(gas > 0n && gas <= BigInt(inputs.fees.maxGasPerStep));
    const hash = await fixtureRPC('eth_sendTransaction',[{...tx,gas:toQuantity((gas*BigInt(inputs.fees.gasLimitMultiplierPercent)+99n)/100n)}]);
    let receipt;
    for (let n=0;n<60 && !receipt;n++) {
      receipt = await fixtureRPC('eth_getTransactionReceipt',[hash]);
      if (!receipt) await sleep(100);
    }
    assert.equal(receipt?.status,'0x1');
  }
  stage = 'fixture-funding';
  await send(0, addresses.MockUSDC, token, 'mint', plan.transactions[0].candidateArguments);
  stage = 'fixture-approval';
  await send(1, addresses.MockUSDC, token, 'approve', plan.transactions[1].candidateArguments);
  stage = 'fixture-commitment-calculation';
  const commitment = (await call(addresses.ETHRegistrar,registrar,'makeCommitment',[...args.slice(0,6),args[7]]))[0];
  assert.equal((await call(addresses.ETHRegistrar,registrar,'commitmentAt',[commitment]))[0],0n);
  stage = 'fixture-commit';
  await send(2, addresses.ETHRegistrar, registrar, 'commit', [commitment]);
  const minimum = (await call(addresses.ETHRegistrar,registrar,'MIN_COMMITMENT_AGE',[]))[0];
  const maximum = (await call(addresses.ETHRegistrar,registrar,'MAX_COMMITMENT_AGE',[]))[0];
  await fixtureRPC('evm_increaseTime',[Number(minimum)+1]);
  await fixtureRPC('evm_mine');
  const committed = await fixtureRPC('eth_getBlockByNumber',['latest',false]);
  const committedAt = (await call(addresses.ETHRegistrar,registrar,'commitmentAt',[commitment],committed.number))[0];
  const age = BigInt(committed.timestamp)-committedAt;
  assert.ok(committedAt > 0n && age >= minimum && age < maximum);
  assert.equal(await fixtureRPC('eth_getTransactionCount',[inputs.owner,committed.number]),reveal.candidateNonce);
  const absentCommitment = (await call(addresses.ETHRegistrar,registrar,'makeCommitment',[...absentArgs.slice(0,6),absentArgs[7]]))[0];
  assert.notEqual(absentCommitment,commitment);
  assert.equal((await call(addresses.ETHRegistrar,registrar,'commitmentAt',[absentCommitment],committed.number))[0],0n);

  // Observe the actual production upstream proxy ingress before its filter.
  // Keep method counts only. Raw bodies never leave process memory.
  Server.prototype.listen = function (...parameters) {
    if (tracking) proxies.add(this);
    return nativeListen.apply(this, parameters);
  };
  Server.prototype.emit = function (event, ...parameters) {
    if (event === 'request' && proxies.has(this)) {
      let text = '';
      parameters[0].on('data', chunk => { text += chunk; });
      parameters[0].on('end', () => {
        if (containsPrivate(text)) stats.privateIngress++;
        try {
          const payload = JSON.parse(text);
          for (const message of Array.isArray(payload) ? payload : [payload]) {
            const method = allowedForward(message) ? message.method : 'blocked-or-invalid-method';
            stats.estimatorIngress[method] = (stats.estimatorIngress[method] ?? 0) + 1;
          }
        } catch { stats.estimatorIngress.invalid = (stats.estimatorIngress.invalid ?? 0) + 1; }
      });
    }
    return nativeEmit.call(this,event,...parameters);
  };
  globalThis.fetch = async (url, options) => {
    if (url === UPSTREAM) {
      if (containsPrivate(options.body)) { stats.privateEgress++; throw new Error('Fixture upstream guard'); }
      assert.ok(allowedForward(JSON.parse(options.body),secret));
      stats.estimatorUpstreamReads++;
      return nativeFetch(fixture, { ...options, redirect: 'error' });
    }
    const response = await nativeFetch(url,options);
    if (tracking && String(url).startsWith('http://127.0.0.1:') && options?.body) {
      const payload = JSON.parse(options.body);
      probes.add(String(url));
      const reply = await response.clone().json();
      if (payload.method === 'eth_getBlockByNumber' && payload.params[0] === pinned.number)
        hashChecked ||= reply.result?.hash === pinned.hash;
      if (payload.method === 'eth_chainId') chainChecked ||= reply.result === '0xaa36a7';
    }
    return response;
  };
  endpoint = createServer(privateEstimateHandler(bundle, estimateOnOwnedFork));
  const origin = await listen(endpoint);
  const client = privateEstimator(new URL(origin), (route,options) => nativeFetch(origin+route, {
    ...options, headers: { ...options.headers, origin },
  }));
  for (const name of ['committed','absent']) {
    const header = committed;
    stage = 'estimate-' + name;
    caseName = name;
    pinned = header;
    hashChecked = chainChecked = false;
    probes.clear();
    proxies.clear();
    tracking = true;
    const tx = {from:inputs.owner,to:reveal.candidateDestination,data:name==='committed' ? data : absentData,nonce:reveal.candidateNonce,
      value:'0x0',chainId:'0xaa36a7',maxFeePerGas:toQuantity(2n*BigInt(header.baseFeePerGas)+1n),maxPriorityFeePerGas:'0x1'};
    if (name === 'committed') {
      const gas = await client(tx,header);
      assert.ok(BigInt(gas)>0n && BigInt(gas)<=BigInt(inputs.fees.maxGasPerStep));
      verified[name] = { gas:BigInt(gas).toString(), commitmentAgeSeconds:age.toString() };
    } else {
      // Compare the fixture's revert selector to the registrar ABI before using
      // the production HTTP endpoint, which intentionally suppresses details.
      const response = await nativeFetch(fixture,{method:'POST',headers,body:json('eth_call',[tx,header.number])});
      const failure = (await response.json()).error;
      const revert = typeof failure?.data === 'string' ? failure.data : failure?.data?.data;
      assert.equal(typeof revert,'string');
      assert.equal(registrar.parseError(revert)?.name,'CommitmentTooOld');
      const reply = await nativeFetch(origin+'/private-estimate',{method:'POST',headers:{...headers,origin},
        body:JSON.stringify({tx,header:{number:header.number,hash:header.hash}})});
      assert.equal(reply.status,400);
      const text = await reply.text();
      assert.ok(!containsPrivate(text));
      assert.deepEqual(JSON.parse(text),{error:'Private estimate blocked'});
      verified[name] = { status:400, fixtureRevert:'CommitmentTooOld', redacted:true };
    }
    tracking = false;
    assert.ok(hashChecked && chainChecked);
    assert.ok(probes.size === 1 && proxies.size === 2);
    for (const server of proxies) assert.equal(server.listening,false);
    for (const url of probes)
      await assert.rejects(nativeFetch(url,{method:'POST',headers,body:json('eth_chainId',[]),signal:AbortSignal.timeout(1000)}));
    Object.assign(verified[name],{block:header.number,hash:header.hash,chainId:11155111,ownedListenersClosed:true});
  }
  assert.equal(stats.privateIngress,0);
  assert.equal(stats.privateEgress,0);
  assert.ok(stats.estimatorUpstreamReads>0);
  assert.equal((await fixtureRPC('eth_getBlockByNumber',['latest',false])).hash,committed.hash);
  assert.equal((await call(addresses.ETHRegistrar,registrar,'commitmentAt',[commitment]))[0],committedAt);
} catch (error) {
  const line = String(error.stack).match(/owned-fork-verification\.mjs:(\d+):\d+/);
  if (line) console.error('Verification assertion line '+line[1]);
  // Never serialize assertion details, RPC responses, stack traces or calldata.
  console.error('FAIL: owned-fork verification at '+stage+(caseName ? ' ('+caseName+')' : ''));
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  Server.prototype.emit = nativeEmit;
  Server.prototype.listen = nativeListen;
  secretBytes.fill(0);
  absentBytes.fill(0);
  await close(endpoint);
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const exited = once(child,'exit');
    child.kill('SIGKILL');
    await exited;
  }
  await close(relay);
}
if (!process.exitCode) console.log(JSON.stringify({ status:'PASS', verified, stats, fixtureStopped:true },null,2));
