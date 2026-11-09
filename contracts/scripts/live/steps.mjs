import { id, Interface, keccak256, AbiCoder } from 'ethers';
import { ROOT, LOCK, GUEST, ZERO, ZERO32, INFRA, SALTS, ROOT_DURATION, LOCK_DURATION,
  OWNER_ROLES, LOCK_ROLES, ROOT_ROLES, ISSUER_ROLES, MAX_RENT, STEP_IDS } from './config.mjs';
import { need, same, revealArgs, commitment, maskedRuntime } from './context.mjs';
const asBig = v => BigInt(v);
export const state = (c,n,label) => c.read(n,'getState',[id(label)]);
export function events(c,r,n,event) {
  const address=c.addresses[n]; const iface=c.interfaces[n];
  return r.logs.filter(l=>same(l.address,address)).flatMap(l=>{try{const x=iface.parseLog(l);return x?.name===event?[x]:[];}catch{return [];}});
}
export function one(c,r,n,event) {const matches=events(c,r,n,event);need(matches.length===1,'Expected exactly one '+n+'.'+event);return matches[0].args;}
function eventEquals(c,r,n,event,args) {
  const actual=one(c,r,n,event); need(args.length===actual.length&&args.every((a,i)=>same(a,actual[i])),'Event mismatch: '+n+'.'+event);return actual;
}
function tx(c,n,method,args) {return {to:c.addresses[n],data:c.interfaces[n].encodeFunctionData(method,args),value:0n};}
async function code(c,n) {need(c.addresses[n]&&await c.provider.getCode(c.addresses[n])!=='0x','Missing code: '+n);}
async function common(c) {
  await c.identity();
  for(const n of ['RootRegistry','ETHRegistry','ETHRegistrar'])await code(c,n);
  need(same(await c.read('RootRegistry','getSubregistry',['eth']),INFRA.ETHRegistry),'Global eth attachment changed');
  need(same(await c.read('ETHRegistrar','ETH_REGISTRY'),INFRA.ETHRegistry),'Registrar registry changed');
}
async function rent(c) {
  await common(c);for(const n of ['MockUSDC','StandardRentPriceOracle'])await code(c,n);
  need(same(await c.read('ETHRegistrar','rentPriceOracle'),INFRA.StandardRentPriceOracle),'Rent oracle changed');
  need(await c.read('ETHRegistrar','isAvailable',[ROOT]),'Root unavailable; never substitute');
  const [base,premium]=await c.read('ETHRegistrar','getRegisterPrice',[ROOT,ROOT_DURATION,INFRA.MockUSDC]);
  const price=base+premium; need(price>0n&&price<=MAX_RENT,'Quote exceeds rent ceiling');
  c.work={base:String(base),premium:String(premium),price:String(price),
    balance:String(await c.read('MockUSDC','balanceOf',[c.owner])),allowance:String(await c.read('MockUSDC','allowance',[c.owner,INFRA.ETHRegistrar]))};
  const paid=c.journal.entries.find(e=>e.step==='T02');
  if(paid)need(BigInt(paid.facts.price)===price,'Quote changed since T02; stop for operator review');
}
async function registry(c,n) {
  await code(c,n);need(same(await c.read('VerifiableFactory','verifyContract',[c.addresses[n]]),INFRA.UserRegistryImpl),'Unexpected registry implementation: '+n);
  need(await c.read(n,'ROOT_RESOURCE')===0n,'Unexpected root resource');
  need(await c.read(n,'roles',[0,c.owner])===OWNER_ROLES,'Owner root roles changed: '+n);
}
async function ancestor(c,n,label,token,bitmap) {
  const s=await state(c,n,label);
  need(s.status===2n&&s.expiry>await c.time(),'Inactive ancestor: '+label);
  need(s.tokenId===BigInt(token),'Ancestor generation changed: '+label);
  need(same(await c.read(n,'getOwner',[id(label)]),c.owner),'Ancestor owner changed: '+label);
  need(await c.read(n,'roles',[s.resource,c.owner])===bitmap,'Ancestor roles changed: '+label);
  return s;
}
async function rootReady(c) {await common(c);need(c.derived.rootTokenId,'Missing verified root token');return ancestor(c,'ETHRegistry',ROOT,c.derived.rootTokenId,ROOT_ROLES);}
async function lockReady(c) {
  const r=await rootReady(c);await registry(c,'R1');
  need(same(await c.read('ETHRegistry','getSubregistry',[ROOT]),c.addresses.R1),'R1 detached');
  const l=await ancestor(c,'R1',LOCK,c.derived.lockTokenId,LOCK_ROLES);
  need(l.expiry<=r.expiry,'Lock exceeds root expiry');return l;
}
export async function hierarchy(c) {
  const l=await lockReady(c);await registry(c,'R2');
  need(same(await c.read('R1','getSubregistry',[LOCK]),c.addresses.R2),'R2 detached');
  for(const [n,p,label]of [['R1',INFRA.ETHRegistry,ROOT],['R2',c.addresses.R1,LOCK]]){
    const [parent,text]=await c.read(n,'getParent');need(same(parent,p)&&text===label,'Canonical metadata mismatch: '+n);
  }
  need(!await c.read('R2','isEmancipated'),'R2 emancipated');return l;
}
async function pristine(c,n,label) {
  const s=await state(c,n,label), initial=BigInt(id(label))&~0xffffffffn;
  need(s.status===0n&&s.expiry===0n&&same(s.latestOwner,ZERO)&&s.tokenId===initial&&s.resource===initial+1n,'Label is not pristine: '+label);
}
async function registered(c,r,n,label,owner,expiry,bitmap,sender) {
  const e=one(c,r,n,'LabelRegistered');
  need(e.label===label&&same(e.labelHash,id(label))&&same(e.owner,owner)&&e.expiry===expiry&&same(e.sender,sender),'Registration event mismatch');
  const s=await state(c,n,label);
  need(s.status===2n&&s.tokenId===e.tokenId&&s.expiry===expiry&&same(await c.read(n,'getOwner',[id(label)]),owner),'Registration state mismatch');
  need(await c.read(n,'roles',[s.resource,owner])===bitmap,'Registered roles mismatch');
  if(bitmap===0n)need(await c.read(n,'roleCount',[s.resource])===0n,'Credential has resource roles');
  need(same(await c.read(n,'getSubregistry',[label]),ZERO)&&same(await c.read(n,'getResolver',[label]),ZERO),'Unexpected registration child/resolver');
  return s;
}
async function product(c,name) {
  await maskedRuntime(c,name,c.addresses[name]);
  need(same(await c.read(name,name==='DoorKeys'?'administrator':'owner'),c.owner),'Product owner mismatch');
  need(await c.read(name,'rootLabel')===ROOT,'Product label mismatch');
  for(const [field,key]of [['parentRegistry','R1'],['guestRegistry','R2']])need(same(await c.read(name,field),c.addresses[key]),'Product registry mismatch');
  for(const field of ['rootTokenId','lockTokenId'])need(await c.read(name,field)===BigInt(c.derived[field]),'Product generation mismatch');
}
const descriptions=[
  'Mint exact MockUSDC rent deficit','Approve exact MockUSDC rent quote','Commit root registration (secret never displayed)',
  'Reveal/register root (calldata suppressed)','Deploy R1 with explicit owner grants','Attach R1 to root','Set R1 parent metadata',
  'Register lock with owner token roles','Deploy R2 with explicit owner grants','Attach R2 under lock','Set R2 parent metadata',
  'Deploy CredentialRegistrar','Grant registrar exactly 4097 root roles','Deploy DoorKeys epoch 1','Issue Mira credential',
];
async function pre(c,n) {
  c.work={};
  if(n<=4){
    await rent(c);
    if(n>=2)need(asBig(c.work.balance)>=asBig(c.work.price),'Insufficient rent token funding');
    if(n>=3)need(asBig(c.work.allowance)===asBig(c.work.price),'Exact rent allowance missing');
    if(n===1)return {skip:asBig(c.work.balance)>=asBig(c.work.price)};
    if(n===2)return {skip:c.work.allowance===c.work.price};
    need(c.secret,'Registration secret unavailable');c.work.commitment=commitment(c);
    const at=await c.read('ETHRegistrar','commitmentAt',[c.work.commitment]);
    if(n===3)need(at===0n,'Commitment exists; reconcile rather than recommit');
    else {
      need(at>0n&&String(at)===String(c.derived.commitmentAt),'Commitment timestamp differs from verified T03');
      const min=await c.read('ETHRegistrar','MIN_COMMITMENT_AGE'),max=await c.read('ETHRegistrar','MAX_COMMITMENT_AGE'),now=await c.time();
      need(now>=at+min,'Commitment too young; wait for minimum age');need(now<at+max,'Commitment expired; stop without recreating secret');
    }
    return {};
  }
  const root=await rootReady(c);
  for(const name of ['VerifiableFactory','UserRegistryImpl','LabelStore'])await code(c,name);
  need(same(await c.read('UserRegistryImpl','LABEL_STORE'),INFRA.LabelStore),'LabelStore linkage changed');
  need(same(await c.read('VerifiableFactory','proxyLogic'),INFRA.FactoryLogic),'Factory proxy logic changed');
  if(n===5||n===9){
    if(n===9)await lockReady(c);
    c.work.salt=String(SALTS[n===5?'R1':'R2']);
    // No address prediction is used or persisted. Factory verifies any deployment collision.
    return {};
  }
  await registry(c,'R1');
  if(n===6)need(same(await c.read('ETHRegistry','getSubregistry',[ROOT]),ZERO),'Root already attached');
  if(n>=7)need(same(await c.read('ETHRegistry','getSubregistry',[ROOT]),c.addresses.R1),'R1 attachment mismatch');
  if(n===8){await pristine(c,'R1',LOCK);c.work.expiry=String(await c.time()+LOCK_DURATION);need(BigInt(c.work.expiry)<=root.expiry,'Lock expiry beyond root');}
  if(n>=10)await lockReady(c);
  if(n>=10)await registry(c,'R2');
  if(n===10)need(same(await c.read('R1','getSubregistry',[LOCK]),ZERO),'Lock already attached');
  if(n>=11)need(same(await c.read('R1','getSubregistry',[LOCK]),c.addresses.R2),'R2 attachment mismatch');
  if(n>=12)await hierarchy(c);
  if(n===13){await product(c,'CredentialRegistrar');need(await c.read('R2','roles',[0,c.addresses.CredentialRegistrar])===0n&&await c.read('R2','roleCount',[0])===OWNER_ROLES,'R2 role census changed before grant');}
  if(n>=14){await product(c,'CredentialRegistrar');need(await c.read('R2','roles',[0,c.addresses.CredentialRegistrar])===ISSUER_ROLES&&await c.read('R2','roleCount',[0])===OWNER_ROLES+ISSUER_ROLES,'Exact registrar roles/census missing');}
  if(n===15){
    await product(c,'DoorKeys');await pristine(c,'R2',GUEST);
    need(await c.provider.getCode(c.guest)==='0x','Guest must be undelegated EOA');
    for(const a of [c.guest,c.addresses.DoorKeys])need(await c.read('R2','roles',[0,a])===0n,'Guest/door root roles must be zero');
    const lock=await state(c,'R1',LOCK);c.work.expiry=String(await c.time()+c.issueDuration);
    need(BigInt(c.work.expiry)<=lock.expiry&&c.issueDuration>=600n&&c.issueDuration<=2592000n,'Guest expiry outside bounds');
  }
  return {};
}
async function build(c,n) {
  const w=c.work,d=c.derived;
  if(n===1)return tx(c,'MockUSDC','mint',[c.owner,asBig(w.price)-asBig(w.balance)]);
  if(n===2)return tx(c,'MockUSDC','approve',[INFRA.ETHRegistrar,asBig(w.price)]);
  if(n===3)return tx(c,'ETHRegistrar','commit',[w.commitment]);
  if(n===4)return tx(c,'ETHRegistrar','register',revealArgs(c));
  if(n===5||n===9)return tx(c,'VerifiableFactory','deployProxy',[INFRA.UserRegistryImpl,asBig(w.salt),c.interfaces.R1.encodeFunctionData('initialize',[[[c.owner,OWNER_ROLES]]])]);
  if(n===6)return tx(c,'ETHRegistry','setSubregistry',[d.rootTokenId,c.addresses.R1]);
  if(n===7)return tx(c,'R1','setParent',[INFRA.ETHRegistry,ROOT]);
  if(n===8)return tx(c,'R1','register',[LOCK,c.owner,ZERO,ZERO,LOCK_ROLES,w.expiry]);
  if(n===10)return tx(c,'R1','setSubregistry',[d.lockTokenId,c.addresses.R2]);
  if(n===11)return tx(c,'R2','setParent',[c.addresses.R1,LOCK]);
  if(n===12||n===14){
    const name=n===12?'CredentialRegistrar':'DoorKeys',args=[c.owner,ROOT,c.addresses.R1,c.addresses.R2,...(n===14?[1]:[])];
    return {data:c.artifacts[name].bytecode.object+c.interfaces[name].encodeDeploy(args).slice(2),value:0n};
  }
  if(n===13)return tx(c,'R2','grantRootRoles',[ISSUER_ROLES,c.addresses.CredentialRegistrar]);
  if(n===15)return tx(c,'CredentialRegistrar','issue',[GUEST,c.guest,w.expiry]);
  throw new Error('Unknown step');
}
async function verify(c,r,n) {
  need(r.status===1,'Transaction reverted');const w=c.work;
  if(n===1){eventEquals(c,r,'MockUSDC','Transfer',[ZERO,c.owner,asBig(w.price)-asBig(w.balance)]);need(await c.read('MockUSDC','balanceOf',[c.owner])===asBig(w.price),'Mint postcondition mismatch');}
  if(n===2){eventEquals(c,r,'MockUSDC','Approval',[c.owner,INFRA.ETHRegistrar,asBig(w.price)]);need(await c.read('MockUSDC','allowance',[c.owner,INFRA.ETHRegistrar])===asBig(w.price),'Allowance postcondition mismatch');}
  if(n===3){eventEquals(c,r,'ETHRegistrar','CommitmentMade',[w.commitment]);const at=await c.read('ETHRegistrar','commitmentAt',[w.commitment]);need(at===BigInt((await c.provider.getBlock(r.blockNumber)).timestamp),'Commit timestamp mismatch');return {commitmentAt:String(at),commitment:w.commitment};}
  if(n===4){
    const e=one(c,r,'ETHRegistrar','NameRegistered');
    need(e.label===ROOT&&same(e.owner,c.owner)&&same(e.subregistry,ZERO)&&same(e.resolver,ZERO)&&e.duration===ROOT_DURATION&&same(e.paymentToken,INFRA.MockUSDC)&&same(e.referrer,ZERO32)&&e.base===asBig(w.base)&&e.premium===asBig(w.premium),'Root registration event mismatch');
    const expiry=BigInt((await c.provider.getBlock(r.blockNumber)).timestamp)+ROOT_DURATION;
    const s=await registered(c,r,'ETHRegistry',ROOT,c.owner,expiry,ROOT_ROLES,INFRA.ETHRegistrar);
    need(s.tokenId===e.tokenId&&await c.read('ETHRegistrar','commitmentAt',[w.commitment])===0n,'Root token/commit consumption mismatch');
    eventEquals(c,r,'MockUSDC','Transfer',[c.owner,await c.read('ETHRegistrar','BENEFICIARY'),asBig(w.price)]);
    return {rootTokenId:String(s.tokenId),rootResource:String(s.resource),rootExpiry:String(s.expiry)};
  }
  if(n===5||n===9){
    const e=one(c,r,'VerifiableFactory','ProxyDeployed');need(same(e.sender,c.owner)&&e.salt===asBig(w.salt)&&same(e.implementation,INFRA.UserRegistryImpl),'Proxy deployment event mismatch');
    const name=n===5?'R1':'R2',address=e.proxyAddress;c.addresses[name]=address;
    await registry(c,name);need(await c.read(name,'roleCount',[0])===OWNER_ROLES&&!await c.read(name,'isEmancipated'),'Proxy initialization roles mismatch');
    const logic=await c.read('VerifiableFactory','proxyLogic');
    const outer=keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256'],[c.owner,w.salt]));
    const expected='0x363d3d373d3d3d363d73'+logic.slice(2).toLowerCase()+'5af43d82803e903d91602b57fd5bf3'+outer.slice(2);
    need(same(await c.provider.getCode(address),expected),'Proxy runtime mismatch');return {[name]:address};
  }
  if(n===6||n===10){const name=n===6?'ETHRegistry':'R1',label=n===6?ROOT:LOCK,child=c.addresses[n===6?'R1':'R2'],token=c.derived[n===6?'rootTokenId':'lockTokenId'];eventEquals(c,r,name,'SubregistryUpdated',[token,child,c.owner]);need(same(await c.read(name,'getSubregistry',[label]),child),'Attachment postcondition mismatch');}
  if(n===7||n===11){const name=n===7?'R1':'R2',parent=n===7?INFRA.ETHRegistry:c.addresses.R1,label=n===7?ROOT:LOCK;eventEquals(c,r,name,'ParentUpdated',[parent,label,c.owner]);const actual=await c.read(name,'getParent');need(same(actual[0],parent)&&actual[1]===label,'Parent metadata mismatch');}
  if(n===8){const s=await registered(c,r,'R1',LOCK,c.owner,asBig(w.expiry),LOCK_ROLES,c.owner);return {lockTokenId:String(s.tokenId),lockResource:String(s.resource),lockExpiry:String(s.expiry)};}
  if(n===12||n===14){const name=n===12?'CredentialRegistrar':'DoorKeys';need(r.contractAddress,'Creation receipt missing contractAddress');c.addresses[name]=r.contractAddress;await product(c,name);
    if(n===14){need(await c.read(name,'deploymentEpoch')===1n&&await c.read(name,'requestNonce')===0n,'Door epoch/nonce mismatch');
      const expected=keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','bytes32','bytes32','address','address','uint256','uint256','uint256'],[11155111,r.contractAddress,id(ROOT),id(LOCK),c.addresses.R1,c.addresses.R2,c.derived.rootTokenId,c.derived.lockTokenId,1]));need(same(await c.read(name,'doorId'),expected),'Door identity mismatch');}
    return {[name]:r.contractAddress};}
  if(n===13){eventEquals(c,r,'R2','EACRolesChanged',[0,c.addresses.CredentialRegistrar,0,ISSUER_ROLES]);need(await c.read('R2','roles',[0,c.addresses.CredentialRegistrar])===ISSUER_ROLES&&await c.read('R2','roleCount',[0])===OWNER_ROLES+ISSUER_ROLES,'Grant postcondition mismatch');}
  if(n===15){const s=await registered(c,r,'R2',GUEST,c.guest,asBig(w.expiry),0n,c.addresses.CredentialRegistrar);eventEquals(c,r,'CredentialRegistrar','CredentialIssued',[id(GUEST),s.tokenId,c.guest,s.expiry]);return {guestTokenId:String(s.tokenId),guestExpiry:String(s.expiry)};}
  return {};
}
function definition(n){return Object.freeze({id:STEP_IDS[n-1],describe:descriptions[n-1],preconditions:c=>pre(c,n),build:c=>build(c,n),verify:(c,r)=>verify(c,r,n)});}
// One exported factory per step, all with the requested descriptor surface.
export const T01=()=>definition(1),T02=()=>definition(2),T03=()=>definition(3),T04=()=>definition(4),T05=()=>definition(5);
export const T06=()=>definition(6),T07=()=>definition(7),T08=()=>definition(8),T09=()=>definition(9),T10=()=>definition(10);
export const T11=()=>definition(11),T12=()=>definition(12),T13=()=>definition(13),T14=()=>definition(14),T15=()=>definition(15);
export const STEPS=Object.fromEntries(STEP_IDS.map((id,i)=>[id,definition(i+1)]));
