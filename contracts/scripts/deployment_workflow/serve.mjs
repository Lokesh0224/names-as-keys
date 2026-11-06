import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { isT01IntentAuthorization } from './t01_intent.mjs';
import { privateEstimateHandler, estimateOnOwnedFork } from './private_server.mjs';

const root = '/tmp/nak-local-deployment-review';
const bundle = JSON.parse(await readFile(root + '/candidate-bundle.json', 'utf8'));
const estimate = privateEstimateHandler(bundle, estimateOnOwnedFork);
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json' };
const files = new Set(['index.html','demo.html','app.js','demo.js','style.css','candidate-bundle.json']);
createServer(async (req, res) => {
  if (req.headers.host !== '127.0.0.1:8769') { res.writeHead(403).end(); return; }
  if (req.url === '/private-estimate') return estimate(req, res);
  if (req.method === 'GET' && req.url === '/step-authorization.json') {
    // Read per request so the registration preimage can stay in the same tab.
    let auth = null;
    try {
      const record = JSON.parse(await readFile(new URL('./step-authorization.json', import.meta.url), 'utf8'));
      if (isT01IntentAuthorization(record) || (record?.stage === 'GO' && /^T(0[1-9]|1[0-5])$/.test(record.step) &&
          Object.keys(record).length === 4 &&
          [record.planDigest, record.packetDigest].every(value => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value)))) {
        auth = record;
      }
    } catch { /* Invalid configuration leaves authorization closed. */ }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(auth));
    return;
  }
  const file = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (req.method !== 'GET' || !files.has(file)) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(root + '/' + file);
    res.writeHead(200, { 'content-type': types[file.split('.').at(-1)], 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
}).listen(8769, '127.0.0.1', () => console.log('Unsigned review at http://127.0.0.1:8769/'));
