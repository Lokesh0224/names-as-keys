import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { keccak256 } from 'ethers';
import { createContext, need } from './context.mjs';
import { verifyPrefix } from './run.mjs';
export async function frontendEnv(ctx) {
  await ctx.identity();await verifyPrefix(ctx);
  const t14=ctx.journal.entries.find(e=>e.step==='T14'&&e.status==='VERIFIED');need(t14,'Verified T14 required');
  const door=await ctx.provider.getCode(ctx.addresses.DoorKeys),registrar=await ctx.provider.getCode(ctx.addresses.CredentialRegistrar);
  need(door!=='0x'&&registrar!=='0x','Deployment runtime missing');
  const values={NAK_MODE:'sepolia',NAK_DOOR_KEYS_ADDRESS:ctx.addresses.DoorKeys,NAK_CREDENTIAL_REGISTRAR_ADDRESS:ctx.addresses.CredentialRegistrar,
    NAK_DOOR_RUNTIME_HASH:keccak256(door),NAK_REGISTRAR_RUNTIME_HASH:keccak256(registrar),NAK_T14_TX_HASH:t14.txHash,NAK_OWNER_ADDRESS:ctx.owner,NAK_MIRA_ADDRESS:ctx.guest};
  // Never echo LIVE_RPC_URL or a credential-bearing URL into frontend output.
  return Object.entries(values).map(([key,value])=>key+'='+value).join('\n')+'\n# Set NAK_SEPOLIA_RPC_URL, NAK_PUBLIC_ORIGIN and NAK_GUEST_URL privately.\n';
}
export async function main() {const ctx=await createContext();try{console.log(await frontendEnv(ctx));}finally{ctx.provider.destroy();}}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('STOP: verified deployment configuration unavailable; details suppressed.');process.exitCode=1;});
