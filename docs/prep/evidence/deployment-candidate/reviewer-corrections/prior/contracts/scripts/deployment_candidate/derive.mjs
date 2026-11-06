import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { load,readJSON,makeCall,publicRPC,stringify,OUT,ROOT,need } from './common.mjs';
import { factoryPrediction } from './prediction.mjs';
import { sha256 } from 'ethers';
const {inputs,interfaces,addresses}=await load();
const snapshot=await readJSON(path.join(OUT,'public-bindings.json'));
const logic=(await makeCall(publicRPC,interfaces,addresses,snapshot.block)('VerifiableFactory','proxyLogic'))[0];
const code=await publicRPC('eth_getCode',[logic,snapshot.block]);
const prior=await readJSON(path.join(ROOT,'docs/prep/evidence/stage3f-audit/semantic-runtime-reconciliation.json'));
need(sha256(code).slice(2)===prior.contracts.UUPSProxyLogic.patchedRuntimeSHA256,'Proxy logic runtime drift');
snapshot.factoryLogic=logic;
snapshot.independentFactoryDerivation={};
for(const name of ['R1','R2']){
 const derived=factoryPrediction(addresses.VerifiableFactory,logic,inputs.owner,inputs.salts[name]);
 need(derived.address===snapshot.predictions[name],'Factory prediction disagreement');snapshot.independentFactoryDerivation[name]=derived;
}
await writeFile(path.join(OUT,'public-bindings.json'),stringify(snapshot));
console.log('PASS: both factory RPC predictions independently reproduced from pinned clone bytecode/salt derivation; proxy logic runtime unchanged');
