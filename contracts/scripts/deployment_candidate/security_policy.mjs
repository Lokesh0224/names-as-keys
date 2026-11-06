import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256,toUtf8Bytes } from 'ethers';
import { ROOT,readJSON,need } from './common.mjs';
/** Compare policy numbers with retained upstream role definitions and unchanged reviewed source. */
export async function securityPolicy(manifest){
  const sources=(await readJSON(path.join(ROOT,'docs/prep/evidence/stage3e/ens-standard-input.json'))).sources;
  const lib=sources['project/src/registry/libraries/RegistryRolesLib.sol'].content;
  const registrar=sources['project/src/registrar/ETHRegistrar.sol'].content;
  const roles={};
  for(const name of ['REGISTRAR','SET_PARENT','UNREGISTER','RENEW','SET_SUBREGISTRY','SET_RESOLVER']){
    const full='ROLE_'+name,match=lib.match(new RegExp('uint256 internal constant '+full+' = 1 << (\\d+);'));need(match,'REVIEWED_ROLE_DEFINITION');roles[full]=1n<<BigInt(match[1]);
    need(lib.includes('uint256 internal constant '+full+'_ADMIN = '+full+' << 128;'),'REVIEWED_ADMIN_DEFINITION');roles[full+'_ADMIN']=roles[full]<<128n;
  }
  need(lib.includes('ROLE_CAN_TRANSFER_ADMIN = (1 << 28) << 128;'),'REVIEWED_TRANSFER_ADMIN_DEFINITION');roles.ROLE_CAN_TRANSFER_ADMIN=(1n<<28n)<<128n;
  const expression=registrar.match(/uint256 constant REGISTRATION_ROLE_BITMAP\s*=([^;]+);/);need(expression,'REGISTRATION_POLICY_SOURCE');
  const rootRoles=expression[1].split('|').reduce((n,value)=>{const name=value.trim().replace('RegistryRolesLib.','');need(name in roles,'UNKNOWN_REGISTRATION_ROLE');return n|roles[name];},0n);
  const ops=['REGISTRAR','SET_PARENT','UNREGISTER','RENEW','SET_SUBREGISTRY'].reduce((n,k)=>n|roles['ROLE_'+k],0n);
  const policy={ownerRootRoles:ops|(ops<<128n),rootRegistrationRoles:rootRoles,lockTokenRoles:roles.ROLE_SET_SUBREGISTRY|roles.ROLE_SET_SUBREGISTRY_ADMIN|roles.ROLE_CAN_TRANSFER_ADMIN,registrarRoles:roles.ROLE_REGISTRAR|roles.ROLE_UNREGISTER,rootResource:0n,chainId:11155111n};
  need(BigInt(manifest.roles.OWNER_OPERATIONS_AND_ADMINS)===policy.ownerRootRoles&&BigInt(manifest.roles.ROOT_REGISTRATION_ROLE_BITMAP)===rootRoles&&BigInt(manifest.roles.LOCK_OWNER_TOKEN_ROLES)===policy.lockTokenRoles&&BigInt(manifest.roles.REGISTRAR_ROOT_ROLES)===policy.registrarRoles&&manifest.roles.GUEST_TOKEN_ROLES===0&&manifest.roles.DOOR_KEYS_ROLES===0,'MANIFEST_SECURITY_POLICY_MISMATCH');
  need(/uint256 public constant ROOT_RESOURCE = 0;/.test(sources['project/src/access-control/EnhancedAccessControl.sol'].content),'REVIEWED_ROOT_RESOURCE');
  const baseline=await readJSON(path.join(ROOT,'docs/prep/evidence/stage3e/run.json'));
  for(const name of ['CredentialRegistrar','DoorKeys']){
    const file='contracts/src/'+name+'.sol',text=await readFile(path.join(ROOT,file),'utf8');
    need(sha256(toUtf8Bytes(text)).slice(2)===baseline.sources[file],'PRODUCTION_SOURCE_DRIFT');
    need(/SEPOLIA_CHAIN_ID = 11155111;/.test(text),'REVIEWED_CHAIN_DEFINITION');
    if(name==='CredentialRegistrar')need(/REGISTRAR_ROLE = 1;/.test(text)&&/UNREGISTER_ROLE = 4096;/.test(text)&&/ISSUE_ROLES = REGISTRAR_ROLE \| UNREGISTER_ROLE;/.test(text)&&/MIN_DURATION = 60;/.test(text)&&/MAX_DURATION = 30 days;/.test(text),'REVIEWED_REGISTRAR_DEFINITIONS');
  }
  return policy;
}
