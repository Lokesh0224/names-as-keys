// Builds a local static review bundle only. Does not start a server or open a wallet.
import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const out = '/tmp/nak-local-deployment-review';
await mkdir(out, { recursive: true });
await build({ entryPoints: [path.join(here,'browser.mjs')], bundle: true, format: 'esm', outfile: path.join(out,'app.js'), platform: 'browser', target: 'es2022' });
for (const name of ['index.html','style.css']) await copyFile(path.join(here,name),path.join(out,name));
const abiNames = ['ETHRegistrar','ETHRegistry','UserRegistryImpl','VerifiableFactory','MockUSDC','CredentialRegistrar','DoorKeys'];
const abis = {}; for (const name of abiNames) abis[name] = JSON.parse(await readFile(path.join(repo,'docs/prep/stage3e/abis',name+'.json'),'utf8'));
await writeFile(path.join(out,'verified-abis.json'), JSON.stringify(abis));
for (const name of ['review-plan.json','gate-status.json']) await copyFile(path.join(repo,'docs/prep/stage3f-audit',name),path.join(out,name));
const data = JSON.parse(await readFile(path.join(out,'review-plan.json'),'utf8'));
data.workflowProposals = JSON.parse(await readFile(path.join(repo,'docs/prep/workflow/PROPOSED_DEFAULTS.json'),'utf8'));
await writeFile(path.join(out,'review-plan.json'),JSON.stringify(data,null,2)+'\n');
console.log('PASS: local review-only bundle built at '+out+'; no server, wallet or network started');
