import path from 'node:path';

import { load, readJSON, OUT, ROOT } from '../deployment_candidate/common.mjs';
import { securityPolicy } from '../deployment_candidate/security_policy.mjs';

export async function loadCandidateBundle(directory = path.join(OUT, 'fresh-preflight')) {
  const { inputs, abis, addresses, original, artifacts } = await load();
  const [plan, observation, baseline, proofs, runtime, policy] = await Promise.all([
    readJSON(path.join(directory, 'review-plan.json')),
    readJSON(path.join(directory, 'public-bindings.json')),
    readJSON(path.join(ROOT, 'docs/prep/evidence/stage3e/current-sepolia.json')),
    readJSON(path.join(OUT, 'local-artifact-proof.json')),
    readJSON(path.join(ROOT, 'docs/prep/evidence/stage3f-audit/semantic-runtime-reconciliation.json')),
    securityPolicy(original),
  ]);
  const creation = Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [name, artifact.bytecode.object]));
  const runtimeHashes = Object.fromEntries(Object.entries(baseline.contracts).map(([name, record]) => [name, record.runtimeKeccak256]));
  // The upstream proof uses SHA-256, unlike the other runtime records.
  const logicSha256 = '0x' + runtime.contracts.UUPSProxyLogic.patchedRuntimeSHA256;
  return { plan, observation, inputs, abis, addresses, creation, runtimeHashes, proofs, logicSha256,
    registrationRoles: policy.rootRegistrationRoles.toString() };
}
