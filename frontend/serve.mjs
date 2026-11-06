import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { isAddress, getAddress } from 'ethers';
import QRCode from 'qrcode';
import { createDemo } from './demo.mjs';
import { createSepolia } from './sepolia.mjs';

const assets = {
  '/app.mjs': ['./app.mjs', 'text/javascript'],
  '/styles.css': ['./styles.css', 'text/css'],
  '/ethers.js': ['./node_modules/ethers/dist/ethers.min.js', 'text/javascript'],
  '/connection.mjs': ['../contracts/scripts/deployment_workflow/connection.mjs', 'text/javascript'],
  '/protocol.mjs': ['./protocol.mjs', 'text/javascript'],
  '/docs/prep/stage3e/abis/DoorKeys.json': ['../docs/prep/stage3e/abis/DoorKeys.json', 'application/json'],
  '/docs/prep/stage3e/abis/CredentialRegistrar.json': ['../docs/prep/stage3e/abis/CredentialRegistrar.json', 'application/json'],
};

export async function createApp(env = process.env) {
  const mode = env.NAK_MODE ?? 'demo';
  const holdMs = Number(env.NAK_OPEN_SECONDS ?? 8) * 1000;
  if (!['demo', 'sepolia'].includes(mode) || !Number.isFinite(holdMs) || holdMs < 1000 || holdMs > 60000) {
    throw new Error('Choose demo or sepolia mode and an open interval between 1 and 60 seconds.');
  }
  const publicOrigin = env.NAK_PUBLIC_ORIGIN && new URL(env.NAK_PUBLIC_ORIGIN);
  if (publicOrigin && !['http:', 'https:'].includes(publicOrigin.protocol)) throw new Error('Use an HTTP(S) public origin.');
  if (mode === 'sepolia' && (publicOrigin?.protocol !== 'https:' || !env.NAK_SEPOLIA_RPC_URL)) {
    throw new Error('Sepolia mode requires a public HTTPS origin and a read-only Sepolia RPC URL.');
  }
  const adapter = mode === 'demo' ? createDemo() : await createSepolia(env);
  const path = mode === 'demo' ? adapter.state().guestPath : adapter.path;
  const expected = new URL(path, 'http://localhost').searchParams;
  const loaded = new Map(await Promise.all(Object.entries(assets).map(async ([key, [file, type]]) =>
    [key, [await readFile(new URL(file, import.meta.url)), type]])));
  const html = await readFile(new URL('./index.html', import.meta.url));

  return createServer(async (req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    };
    const json = (status, value) => send(status, 'application/json', JSON.stringify(value));
    try {
      const origin = new URL('http://' + req.headers.host).origin;
      const url = new URL(req.url, origin);
      if (req.method === 'GET') {
        if (url.pathname === '/api/state') {
          const account = url.searchParams.get('account');
          if (account && !isAddress(account)) return json(400, { error: 'Invalid wallet address.' });
          return json(200, { ...await adapter.state(account && getAddress(account)), holdMs });
        }
        if (url.pathname === '/qr.svg') {
          const qr = await QRCode.toString(new URL(path, publicOrigin ?? origin).href, {
            type: 'svg', errorCorrectionLevel: 'M', margin: 4,
          });
          return send(200, 'image/svg+xml', qr);
        }
        if (url.pathname === '/guest' &&
            ([...expected].some(([key, value]) => url.searchParams.get(key) !== value) ||
             url.searchParams.size !== expected.size)) {
          return send(404, 'text/plain', 'Door context does not match this server. Scan the current door QR.');
        }
        if (['/', '/owner', '/guest', '/door'].includes(url.pathname)) return send(200, 'text/html; charset=utf-8', html);
        const asset = loaded.get(url.pathname);
        if (asset) return send(200, asset[1], asset[0]);
      }
      if (req.method === 'POST' && ['/api/action', '/api/reset'].includes(url.pathname)) {
        if (mode !== 'demo') return json(403, { error: 'Sepolia transactions are disabled.' });
        if (!['same-origin', undefined].includes(req.headers['sec-fetch-site']) ||
            (req.headers.origin && ![origin, publicOrigin?.origin].includes(req.headers.origin)) ||
            req.headers['content-type'] !== 'application/json') {
          return json(403, { error: 'Use the same-origin demo page.' });
        }
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 2048) return json(413, { error: 'Request too large.' });
        }
        try {
          const { account, target, data } = JSON.parse(raw);
          const wallet = getAddress(account);
          if (url.pathname === '/api/reset') {
            if (wallet !== adapter.state().owner) return json(403, { error: 'Connect the demo owner to reset.' });
            adapter.reset();
            return json(200, { message: 'Demo reset.' });
          }
          const result = adapter.execute({ target, account: wallet, data });
          return json(result.denied ? 403 : 200, result);
        } catch (error) {
          return json(400, { error: error.shortMessage ?? error.message });
        }
      }
      return send(404, 'text/plain', 'Route not found.');
    } catch (error) {
      console.error(error.code ?? error.name);
      return json(503, { error: 'Door data is temporarily unavailable.' });
    }
  });
}

if (import.meta.main) {
  try {
    const host = process.env.NAK_HOST ?? '127.0.0.1';
    const port = Number(process.env.NAK_PORT ?? 8787);
    (await createApp()).listen(port, host, () => console.log(`Names as Keys · http://${host}:${port}/owner`));
  } catch (error) {
    // RPC errors can contain server-side credentials in the request URL.
    console.error(error.code ? `Startup failed (${error.code}). Check the Stage 3G environment.` : error.message);
    process.exitCode = 1;
  }
}
