# Stage 1 Part A — final evidence audit

## Executive summary

A4 and A5 are **RUNTIME-VERIFIED PASS** from the inspected four-test T6a log on a local Sepolia fork. A6 is **RUNTIME-VERIFIED PASS** from the inspected paired-resolution T6b log on a local Anvil fork. These are local-fork results, not live Sepolia transactions or tests. A3 remains partial overall: only the five A3-LITE cases are runtime-verified; the full 16-cell matrix and remaining paths are unverified.

A1–A3 are partial. A1 leaves one observed selector unidentified. A2 has only three of twelve requested label reuse outcomes. A3 does not establish general non-transferability or test emancipation. Those gaps do not block a placeholder-only Part B scaffold if the safeguards below are kept. They do block any claim that names are generally non-transferable and should be closed before Stage 2 relies on that property.

## Verification status

| Part | Status | Question | Evidence present | Remaining gap / importance |
|---|---|---|---|---|
| A1 | **PARTIAL** | What ENSv2 errors correspond to observed revert selectors, and what UI message is appropriate? | [`docs/ens-errors.md`](ens-errors.md); selector-bearing observations in [`contracts/spike-output-before-closure.log`](../contracts/spike-output-before-closure.log); vendored declarations in `IStandardRegistry.sol`, `IPermissionedRegistry.sol`, `IEnhancedAccessControl.sol`. | `0xdab6c73c` from an over-long label input remains UNKNOWN. UI text must not infer its meaning until decoded or shown irrelevant. Vendored declarations are interface evidence from the Sept 15 tag, not complete source for a claimed current deployment. |
| A2 | **PARTIAL** | Can a label be reused after unregister or natural expiry, by the same/different owner, immediately/+1 day/+30 days? | `testQ5_ExpiredNameFailsUnlockAndRecordRawValues` and `testQ6_UnregisterAndProbeSameAndDifferentLabelReuse`; old log records natural expiry/same owner immediate success and unregister/same owner success vs different owner revert `0xdef545a4`. | Nine of twelve matrix outcomes are absent. The `latestOwner` mechanism is consistent with results but is not proven from implementation source. Implementation-critical for any UI that promises reassignment or release timing; optional if Part B only reports current availability and never promises a release date. |
| A3 | **PARTIAL — five A3-LITE cases RUNTIME-VERIFIED** | Does an empty token bitmap make a guest name non-transferable, and what changes after emancipation or a transfer-capable bitmap? | `docs/prep/evidence/A3lite-20261105-033934.log` (checksum `84e5f00b9d5790b886c5744e7d3f715109b022c2673ed3108aadc53768b71759`): 5 passed / 0 failed / 0 skipped. Control transfer-capable unsafe transfer succeeded; empty-bitmap unsafe/safe reverts were `0xe58f6d5a`/`0x54838f98`; fixture `isEmancipated()` was false; guest self-grant reverted with `0xd1a3b355`. | Only these five test cases are verified. The full 16-cell matrix, emancipated-state comparison, and remaining operator/root/batch paths are not verified. Do not claim general non-transferability; retain the Stage 2 security limitation. |
| A4 | **RUNTIME-VERIFIED PASS — local Sepolia fork** | What happens when a parent expires, is re-registered by another owner, and receives a different subregistry? | `docs/prep/evidence/T6a-20261105-025207.log` (checksum `b0be821dfa7ab33949995806583f0d93357c6bb817d117f3a9b86677bdaad7f1`): the four-test closure group passed; includes `testClosureV2RejectsExpiredParentAndDetachedSubregistry` and `testClosureA4ParentResaleAndReplacementSubregistry`. | Fork evidence only; no live Sepolia write tested. Earlier [`contracts/spike-output-before-closure.log`](../contracts/spike-output-before-closure.log) remains historical evidence of the original defect. |
| A5 | **RUNTIME-VERIFIED PASS — local Sepolia fork, 4/4** | Does the amended check reject invalid guest/child/parent states and enforce expiry bounds? | The same T6a log records 4 passed / 0 failed / 0 skipped, exit 0; source covers valid guest, wrong owner, expired/revoked child, expired parent, detached/replaced subregistry, parent resale, and expiry bounds. `SpikeRegistrar.canUnlockV2` performs the parent-aware and child checks. | Fork evidence only. Earlier [`contracts/closure-test-attempt.log`](../contracts/closure-test-attempt.log) is a DNS failure before execution, not the passing run. |
| A6 | **RUNTIME-VERIFIED PASS — local Anvil fork** | Do ethers v6 `provider.resolveName` and direct Universal Resolver resolution agree for the same ENSv2 child name? | `docs/prep/evidence/T6b-20261105-031548.log` (checksum `56a5977ebdcc1b93ab87c478a22a27df10855f29d716fde9ff556dd36e701a17`): chain ID 11155111; both paths returned the expected guest; `ethersMatches`, `directMatches`, `pathsAgree` true; exit 0. The seed/probe scripts are `contracts/scripts/seed-anvil-resolution.ts` and `contracts/scripts/resolve-test.ts`. | Local Anvil fork evidence only, not a live Sepolia transaction/test. |

## A1–A3 findings

### A1: selector decoding

`docs/ens-errors.md` identifies the requested selectors `0xdef545a4`, `0x54838f98`, `0xe58f6d5a` (decimal `3851382106`), `0x4b27a133`, and `0xf1d446c3` from the vendored interfaces. `0xdab6c73c` appears in the spike output for the oversized-label attempt but does not match an error declaration in the vendored interface tree. The suggested UI text for that selector should remain generic; the observation alone does not prove that its meaning is “label too long.”

Smallest additional experiment: inspect the full revert payload against a source/ABI matching the deployed implementation or obtain a reliable selector signature lookup. This is low priority if the app enforces its own 3–32 character label format and handles unknown errors generically.

### A2: label reuse

The saved Q5/Q6 output proves three immediate cases: natural expiry/same owner succeeds; unregister/same owner succeeds; unregister/different owner reverts with `0xdef545a4`. It does not prove the other nine cells or the exact internal `latestOwner` branch. The smallest completion is a fork matrix that records success/revert plus resulting status/current owner for all twelve combinations at the three timings. Until then, dashboard language should describe current availability only and must not promise when another owner can claim a label.

### A3: transfers

The A3-LITE tests add a transfer-capable unsafe-transfer control and query `isEmancipated()` in the fixture; those five cases are runtime-verified by the cited log. The empty-bitmap safe failure remains the emancipation guard, and the control is only an unsafe transfer in the specific fixture. The full transfer/emancipation matrix and the emancipated-state comparison remain untested.

Remaining work: run the full design matrix in an authorized phase, including safe/unsafe single/batch transfer with empty and transfer-capable bitmaps in the required registry states, and remaining operator/root paths. Until then, conclusions are limited to the five A3-LITE cases. Do not say the token is permanently or generally non-transferable.

## A4–A6 evidence reconciliation

Subsequent Phase 2 evidence supersedes the original audit-time status: T6a now retains the four-test A4/A5 local Sepolia-fork output; T6b retains the paired A6 local Anvil-fork output; and A3-LITE retains five passing cases. `SPIKE.md` remains a historical Stage 0 snapshot; its original “NO-GO” and unresolved ethers statements describe the earlier state. The old A4 vulnerability remains a valid historical observation that motivated `canUnlockV2`.

The repository log inventory at audit time:

- `contracts/spike-output-before-closure.log`: VERIFIED ARTIFACT: `contracts/spike-output-before-closure.log` exists and records 13 tests passing (inspectable). Provenance of the run itself: USER-REPORTED. It contains A1–A3 and original parent-expiry defect evidence.
- `contracts/spike-output.log`: one earlier Foundry Q9 direct Universal Resolver test, returning the guest address.
- `contracts/closure-test-attempt.log`: a failed fork startup due to DNS; not a test result.
- `docs/prep/evidence/T6a-20261105-025207.log`: four A4/A5 closure tests passed locally; checksum verified.
- `docs/prep/evidence/T6b-20261105-031548.log`: paired A6 probe passed on a local Anvil fork; checksum verified.
- `docs/prep/evidence/A3lite-20261105-033934.log`: five A3-LITE cases passed; checksum verified. The full A3 matrix remains incomplete.
- `docs/prep/evidence/T6-suite-rerun-20261105-045526.log`: current consolidated local-fork suite passed 17/17; the original 16/1 run remains historical.

## Risks and limitations

1. **Non-transferability is not established.** This matters to the product guarantee and must be resolved before Stage 2 relies on it.
2. **Label reassignment timing is incomplete.** Avoid UI promises or automatic reassignment assumptions.
3. **One selector remains unknown.** Use a safe generic fallback.
4. **Source/address/selector comparison outstanding:** manifest-reported, unverified: the 2026-10-01 redeployment date comes from notes in `contracts/deployments/sepolia.json` and has not been confirmed from an authoritative source. [USER-REPORTED] Relayed from a reviewer's page fetch dated 2026-11-04, NOT verified here: the official ENS deployments page (https://docs.ens.domains/learn/deployments/, Sepolia ENSv2 section) reportedly lists core addresses equal to the manifest's (ETHRegistry, ETHRegistrar, UserRegistryImpl, VerifiableFactory, PermissionedResolverImpl, Universal Resolver proxy), shows no deployment date, and links source at `contracts-v2` commit `07e55a056f5b6a9c90119f501bdd05714e67dddd`, while the vendored copy is `f2f0a05e6c1711134b73204a1e37f8e6c1aea6ab`. A commit-label difference is NOT evidence of behavioral drift. A source/address/selector comparison remains outstanding, is planned for Phase 2, and is not authorized yet.
5. **Fork boundary:** A4/A5/A6 results exercise a local fork; they do not prove current live Sepolia availability, production deployment state, or real transaction success.

## Recommendation: CONDITIONAL GO

Part B may begin as the requested static React/Vite scaffold and deployment/RPC wiring, with these safeguards:

- Keep `/door` as a locked placeholder; do not add DoorKeys or authorization calls.
- Use generic handling for unknown revert selectors, including `0xdab6c73c`.
- Validate labels to the spike’s documented format and show current availability only; do not promise release dates or different-owner reuse.
- Do not claim ENS subnames are generally or permanently non-transferable.
- Treat all reported A4/A5/A6 passes as local-fork evidence, not live Sepolia validation.

This recommendation does **not** authorize Stage 2 or production contract development. A3 is the blocking security experiment before relying on non-transferability; A2 should be completed before adding label reassignment or release-time UX. Wait for explicit authorization before starting Part B.

## Minimal next steps, in priority order

1. Before Stage 2: run and retain the A3 transfer/emancipation/token-role matrix output.
2. Before any label reassignment/release UI: complete the A2 12-case timing matrix and retain output.
3. Keep an unknown-selector fallback; optionally decode `0xdab6c73c` against current deployed source.
4. Before production deployment: complete the source/address/selector comparison described in Risk #4; do not infer behavioral drift from commit labels.
