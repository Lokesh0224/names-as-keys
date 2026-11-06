import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

export const MARKER = Buffer.from('NAK PUBLIC WALLET TRACE FIXTURE').toString('hex');
const chain = '0x7a6a'; // 31338
const networkId = '31338';
const upstream = 'http://127.0.0.1:18546';
const allowed = new Set([
  'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_getBalance', 'eth_getCode', 'eth_getTransactionCount', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_feeHistory', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_estimateGas', 'eth_call', 'eth_simulateV1',
]);

export async function traceRpc(call, forward, record) {
  const { method, params, id } = call ?? {};
  // MetaMask can omit params on this parameterless network read.
  const netVersion = method === 'net_version';
  const validParams = netVersion ? params === undefined || (Array.isArray(params) && params.length === 0)
    : Array.isArray(params);
  const valid = call?.jsonrpc === '2.0' && validParams && allowed.has(method);
  record({
    method: typeof method === 'string' && /^(eth|net|wallet|anvil|debug)_[A-Za-z]{1,50}$/.test(method) ? method : 'other',
    marker: JSON.stringify(params ?? []).toLowerCase().includes(MARKER),
    disposition: valid ? 'forwarded-to-local-node' : 'blocked',
  });
  if (!valid) return { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: 'Probe permits local reads only' } };
  return forward(netVersion ? { jsonrpc: '2.0', id, method, params: [] } : call);
}

async function forward(payload) {
  const response = await fetch(upstream, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  return response.json();
}

if (import.meta.main) {
  const check = await forward({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
  const network = await forward({ jsonrpc: '2.0', id: 2, method: 'net_version', params: [] });
  if (check.result !== chain || network.result !== networkId) throw new Error('Start the disposable Anvil chain 31338 on port 18546 first.');
  const script = await readFile(new URL('./wallet.mjs', import.meta.url));
  createServer(async (req, res) => {
    if (req.headers.host !== '127.0.0.1:18545') return res.writeHead(403).end();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (req.method === 'GET' && req.url === '/') {
      return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
        '<title>Disposable wallet probe</title><h1>Public marker · local chain 31338</h1>' +
        '<p>Use a disposable MetaMask profile. Reject the wallet prompt.</p>' +
        '<button id="connect">Connect disposable wallet</button>' +
        '<p id="connection">Wallet disconnected.</p>' +
        '<button id="probe" disabled>Open disposable wallet prompt</button><p id="status" role="status"></p>' +
        '<script type="module" src="/wallet.mjs"></script>');
    }
    if (req.method === 'GET' && req.url === '/wallet.mjs') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(script);
    if (req.method !== 'POST' || req.url !== '/rpc') return res.writeHead(404).end();
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 65536) return res.writeHead(413).end();
      }
      const value = JSON.parse(body);
      const invoke = call => traceRpc(call, forward, row => console.log(JSON.stringify({ at: new Date().toISOString(), ...row })));
      if (Array.isArray(value) && (value.length === 0 || value.length > 30)) return res.writeHead(400).end();
      const result = Array.isArray(value) ? await Promise.all(value.map(invoke)) : await invoke(value);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch { res.writeHead(400).end(); }
  }).listen(18545, '127.0.0.1', () => console.error('Fixture at http://127.0.0.1:18545/'));
}
