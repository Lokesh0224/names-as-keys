import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadCandidateBundle } from './candidate_bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = '/tmp/nak-local-deployment-review';
const bundle = await loadCandidateBundle();
await mkdir(out, { recursive: true });
await build({ entryPoints: { app: path.join(here,'browser.mjs'), demo: path.join(here,'demo.mjs') },
  bundle: true, format: 'esm', outdir: out, platform: 'browser', target: 'es2022' });
for (const name of ['index.html','demo.html','style.css']) await copyFile(path.join(here,name),path.join(out,name));
await writeFile(path.join(out,'candidate-bundle.json'), JSON.stringify(bundle));
console.log('PASS: unsigned browser review and separate synthetic demo built at ' + out);
