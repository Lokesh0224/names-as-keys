// Deployment read-check builders only. ENS remains the onchain authorization source.
import { Interface, id } from 'ethers';
export const FIXED = Object.freeze({ root: '0xb458d6a3a77919449d03e7a6903c26827c1ec43f', eth: '0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4', factory: '0xda70306c98e97ece36f997a21368e53298572991', implementation: '0x9bd8a88719068d09ecee662f36c0e3856708366a', labelStore: '0xed8246ff02203a4d4cb262bd78beaa7408a57cae' });
export function callCheck(abi, to, signature, args, outputs, name = signature) {
  const iface = new Interface(abi);
  return { id: name, kind: 'call', to, data: iface.encodeFunctionData(signature,args), expected: iface.encodeFunctionResult(signature,outputs) };
}
export function hierarchyChecks(abis, b) {
  if ([b.owner,b.r1,b.r2,b.rootLabel,b.rootState,b.lockState].some(x => x === null || x === undefined)) throw new Error('Unresolved hierarchy bindings');
  const root = b.rootState, lock = b.lockState;
  if (BigInt(root[0]) !== 2n || BigInt(lock[0]) !== 2n || BigInt(lock[1]) > BigInt(root[1]) || BigInt(lock[1]) <= BigInt(b.referenceTimestamp) || String(root[2]).toLowerCase() !== b.owner.toLowerCase() || String(lock[2]).toLowerCase() !== b.owner.toLowerCase()) throw new Error('Inactive/unbounded/wrong-owner hierarchy snapshot');
  const checks = [], add = (abi,to,sig,args,out,name) => checks.push(callCheck(abi,to,sig,args,out,name));
  const grants = 380593917518227438537563280301172632627253505n;
  for (const address of [FIXED.root,FIXED.eth,FIXED.factory,FIXED.implementation,FIXED.labelStore,b.r1,b.r2]) {
    const expectedHash = b.runtimeHashes?.[address.toLowerCase()];
    if (!/^0x[0-9a-fA-F]{64}$/.test(expectedHash ?? '')) throw new Error('Unverified hierarchy runtime hash');
    checks.push({id:'RUNTIME_'+address,kind:'code',to:address,expectedHash});
  }
  for (const registry of [b.r1,b.r2]) {
    add(abis.UserRegistryImpl,registry,'ROOT_RESOURCE()',[],[0],'ROOT_RESOURCE_'+registry);
    add(abis.UserRegistryImpl,registry,'roles(uint256,address)',[0,b.owner],[grants],'OWNER_ROLES_'+registry);
    add(abis.UserRegistryImpl,registry,'roleCount(uint256)',[0],[grants+(registry===b.r2 && b.registrar?4097n:0n)],'ROOT_ROLE_COUNTS_'+registry);
  }
  add(abis.ETHRegistry,FIXED.eth,'roles(uint256,address)',[root[4],b.owner],[97409655027181761882228017414928043058140282880n],'ROOT_TOKEN_ROLES');
  add(abis.UserRegistryImpl,b.r1,'roles(uint256,address)',[lock[4],b.owner],[91700664256357922357994873537130062512592519168n],'LOCK_TOKEN_ROLES');
  add(abis.RootRegistry,FIXED.root,'getSubregistry(string)',['eth'],[FIXED.eth],'ETH_ATTACHMENT');
  for (const registry of [b.r1,b.r2]) add(abis.VerifiableFactory,FIXED.factory,'verifyContract(address)',[registry],[FIXED.implementation],'IMPLEMENTATION_'+registry);
  add(abis.ETHRegistry,FIXED.eth,'getState(uint256)',[id(b.rootLabel)],[root],'ROOT_STATE_GENERATION');
  add(abis.ETHRegistry,FIXED.eth,'getOwner(uint256)',[id(b.rootLabel)],[b.owner],'ROOT_OWNER');
  add(abis.ETHRegistry,FIXED.eth,'getSubregistry(string)',[b.rootLabel],[b.r1],'ROOT_R1_ATTACHMENT');
  add(abis.UserRegistryImpl,b.r1,'getState(uint256)',[id('lock')],[lock],'LOCK_STATE_GENERATION');
  add(abis.UserRegistryImpl,b.r1,'getOwner(uint256)',[id('lock')],[b.owner],'LOCK_OWNER');
  add(abis.UserRegistryImpl,b.r1,'getSubregistry(string)',['lock'],[b.r2],'LOCK_R2_ATTACHMENT');
  add(abis.UserRegistryImpl,b.r1,'getParent()',[],[FIXED.eth,b.rootLabel],'R1_PARENT_METADATA');
  add(abis.UserRegistryImpl,b.r2,'getParent()',[],[b.r1,'lock'],'R2_PARENT_METADATA');
  add(abis.UserRegistryImpl,b.r2,'isEmancipated()',[],[false],'UNEMANCIPATED');
  if (b.registrar) add(abis.UserRegistryImpl,b.r2,'roles(uint256,address)',[0,b.registrar],[4097],'EXACT_REGISTRAR_ROLES');
  if (b.guest) add(abis.UserRegistryImpl,b.r2,'roles(uint256,address)',[0,b.guest],[0],'ZERO_GUEST_ROOT_ROLES');
  if (b.door) add(abis.UserRegistryImpl,b.r2,'roles(uint256,address)',[0,b.door],[0],'ZERO_DOOR_ROLES');
  return checks;
}
