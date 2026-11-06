import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Interface } from 'ethers';
import { startUpstreamProxy } from '../deployment_candidate/upstream_proxy.mjs';

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const quantity = x => typeof x === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(x);
const hash = x => typeof x === 'string' && /^0x[0-9a-f]{64}$/i.test(x);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function revealRequest(bundle, payload) {
  const { tx, header } = payload;
  const step = bundle.plan.transactions.find(s => s.id === 'T04');
  const iface = new Interface(bundle.abis.ETHRegistrar);
  if (!tx || Object.keys(tx).length !== 8 || !header || !quantity(header.number) || !hash(header.hash) ||
      !same(tx.from, bundle.inputs.owner) || !same(tx.to, step.candidateDestination) || tx.chainId !== '0xaa36a7' ||
      tx.value !== '0x0' || tx.nonce !== step.candidateNonce ||
      !quantity(tx.maxFeePerGas) || !quantity(tx.maxPriorityFeePerGas) ||
      BigInt(tx.maxFeePerGas) > BigInt(bundle.inputs.fees.maxFeePerGasWei) ||
      BigInt(tx.maxPriorityFeePerGas) > BigInt(bundle.inputs.fees.maxPriorityFeePerGasWei) ||
      BigInt(tx.maxPriorityFeePerGas) > BigInt(tx.maxFeePerGas)) throw new Error('Invalid reveal envelope');
  const args = Array.from(iface.decodeFunctionData(step.signature, tx.data));
  if (!hash(args[2]) || !same(iface.encodeFunctionData(step.signature, args), tx.data) ||
      !step.candidateArguments.every((value, index) => index === 2 || same(value, args[index])))
    throw new Error('Invalid reveal binding');
  return { tx, header, secret: args[2] };
}

export function privateEstimateHandler(bundle, estimate) {
  let busy = false;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const origin = 'http://' + req.headers.host;
    if (req.method !== 'POST' || req.url !== '/private-estimate' ||
        !/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '') || req.headers.origin !== origin ||
        req.headers['content-type'] !== 'application/json') return send(403, { error: 'Private estimate denied' });
    if (busy) return send(409, { error: 'Private estimate busy' });
    busy = true;
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) throw new Error('Request too large');
      }
      const gas = await estimate(revealRequest(bundle, JSON.parse(body)));
      if (!quantity(gas) || BigInt(gas) === 0n) throw new Error('Invalid estimate');
      send(200, { gas });
    } catch { send(400, { error: 'Private estimate blocked' }); }
    finally { busy = false; }
  };
}

export async function estimateOnOwnedFork({ tx, header, secret }) {
  const upstream = await startUpstreamProxy();
  upstream.protect(secret);
  let child;
  try {
    const portProbe = createServer();
    portProbe.listen(0, '127.0.0.1');
    await once(portProbe, 'listening');
    const port = portProbe.address().port;
    await new Promise(resolve => portProbe.close(resolve));
    child = spawn('anvil', ['--host','127.0.0.1','--port',String(port),'--accounts','0','--quiet',
      '--disable-console-log','--fork-url',upstream.url,'--fork-block-number',BigInt(header.number).toString(),
      '--chain-id','11155111','--hardfork','prague','--disable-min-priority-fee','--no-storage-caching','--max-persisted-states','0'],
      { stdio: 'ignore' });
    let spawnFailed = false;
    child.on('error', () => { spawnFailed = true; });
    const rpc = async (method, params) => {
      if (spawnFailed || child.exitCode !== null) throw new Error('Owned fork unavailable');
      const response = await fetch('http://127.0.0.1:' + port, {
        method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(25_000),
      });
      const reply = await response.json();
      if (reply.error || !('result' in reply)) throw new Error('Owned fork read failed');
      return reply.result;
    };
    let pinned;
    for (let attempt = 0; attempt < 40 && !spawnFailed && child.exitCode === null; attempt++) {
      try { pinned = await rpc('eth_getBlockByNumber', [header.number, false]); if (pinned) break; }
      catch { await sleep(250); }
    }
    if (pinned?.hash !== header.hash || await rpc('eth_chainId', []) !== '0xaa36a7')
      throw new Error('Fork reference mismatch');
    return await rpc('eth_estimateGas', [tx, header.number]);
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await upstream.close();
  }
}
