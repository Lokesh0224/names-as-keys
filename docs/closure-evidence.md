# Stage 1 Part A closure evidence

This report distinguishes retained local-fork evidence from live onchain behavior and preserves narrower USER-REPORTED claims where no run artifact exists. Phase 2b evidence now includes checksummed T6a, T6b, A3-LITE, Q11, and consolidated T6 suite logs.

## A1 — selector decoding: PARTIAL

`docs/ens-errors.md` maps all requested selectors that match the vendored error declarations: `0xdef545a4` (`LabelAlreadyRegistered(string)`), `0x54838f98` (`TransferUnsafeUntilRegistryIsEmancipated()`), decimal `3851382106` / `0xe58f6d5a` (`TransferDisallowed(uint256,address)`), `0x4b27a133` (`EACUnauthorizedAccountRoles(uint256,uint256,address)`), and `0xf1d446c3` (`CannotSetPastExpiry(uint64)`). The spike log associates `0xdab6c73c` with a 256-byte label attempt, but the signature is UNKNOWN in the vendored interface-only tree. Do not assign a precise UI cause to it; the app's own 3–32 character validation makes this input out of scope for the planned guest flow, and a generic error fallback is appropriate.

The vendored tree is explicitly not a full ENSv2 source checkout. It references the `sepolia-deployment-2026-09-15` tag; manifest-reported, unverified: the 2026-10-01 redeployment date comes from notes in `contracts/deployments/sepolia.json` and has not been confirmed from an authoritative source. Selector mappings are interface evidence, not a substitute for matching the live implementation source.

[USER-REPORTED] Relayed from a reviewer's page fetch dated 2026-11-04, NOT verified by this author: the official ENS deployments page (https://docs.ens.domains/learn/deployments/, Sepolia ENSv2 section) reportedly lists core addresses equal to the manifest's (ETHRegistry, ETHRegistrar, UserRegistryImpl, VerifiableFactory, PermissionedResolverImpl, Universal Resolver proxy), shows no deployment date, and links source at `contracts-v2` commit `07e55a056f5b6a9c90119f501bdd05714e67dddd`; the vendored copy is `f2f0a05e6c1711134b73204a1e37f8e6c1aea6ab`. A commit-label difference is NOT evidence of behavioral drift. A source/address/selector comparison remains outstanding (planned for Phase 2; not authorized yet).

## A2 — label reuse: PARTIAL

The preserved Stage 0 output `contracts/spike-output-before-closure.log` records the following immediate outcomes:

| Event | Same owner, immediately | Different owner, immediately |
|---|---|---|
| Unregister | Re-registration succeeded | Re-registration reverted with `0xdef545a4` |
| Natural expiry | Re-registration succeeded (`Q5_registerAfterExpiry true`) | NOT RUN |

The +1 day and +30 day cases for both events remain NOT RUN. The requested full matrix therefore has 3 observed outcomes and 9 outstanding outcomes. The vendored interface names `0xdef545a4` `LabelAlreadyRegistered(string)`, but the implementation source that decides the condition is absent. The `latestOwner` explanation is plausible from the observed pattern and exposed state, but not source-proven. The owner dashboard should query current state and show a generic unavailable/retry result; it should not promise a release time or support different-owner reassignment based on this partial matrix.

## A3 — transfer control: PARTIAL

`testQ7_EmptyBitmapBlocksGuestAndAllowsParentOwnerOverride` and the preserved Stage 0 log show safe single/batch attempts reverted with `0x54838f98`, while unsafe single/batch attempts reverted with `0xe58f6d5a`, for a child registered with an empty token role bitmap. The Phase 2b-LITE local-fork log `docs/prep/evidence/A3lite-20261105-033934.log` (checksum `84e5f00b9d5790b886c5744e7d3f715109b022c2673ed3108aadc53768b71759`) adds exactly five passing probes: transfer-capable unsafe control succeeded; empty-bitmap unsafe transfer reverted with `0xe58f6d5a`; empty-bitmap safe transfer reverted with `0x54838f98`; fixture `isEmancipated()` was false; and guest self-grant reverted with `0xd1a3b355` (`EACCannotGrantRoles`). These five cases are runtime-verified on a local Sepolia fork.

`RegistryRolesLib` identifies `ROLE_CAN_TRANSFER_ADMIN` as the transfer-control role and defines root roles that prevent emancipation. The A3-LITE probe now does query `isEmancipated()` and attempts an unsafe transfer with a transfer-capable token bitmap, but only in its specific fixture setup. The full 16-cell matrix remains unexecuted: there is no comparison in an emancipated registry, no full single/batch/operator/root-path coverage, and no generalized security guarantee. The exact claim is limited to the five logged cases and their observed outcomes. Do not claim general or permanent non-transferability. This remains security-critical before relying on such a guarantee in Stage 2; it is not a blocker for a placeholder-only Part B scaffold that makes no transferability claim.

## A4 — parent lifecycle: RUNTIME-VERIFIED PASS (local fork)

The four-test T6a run passed on a local Sepolia fork: `docs/prep/evidence/T6a-20261105-025207.log` (checksum `b0be821dfa7ab33949995806583f0d93357c6bb817d117f3a9b86677bdaad7f1`), 4 passed / 0 failed / 0 skipped, chain ID 11155111, block 12066685 → 12066686, Forge exit 0. It includes `testClosureV2RejectsExpiredParentAndDetachedSubregistry` and `testClosureA4ParentResaleAndReplacementSubregistry`. Earlier Stage 0 evidence in `contracts/spike-output-before-closure.log` remains a valid historical observation of the original child-only-check defect. T6a is local-fork evidence, not live Sepolia behavior.

## A5 — amended unlock check: RUNTIME-VERIFIED PASS (4/4, local fork)

The checked-in T6a log cited under A4 records the complete four-test closure group passing: 4 passed / 0 failed / 0 skipped, exit 0. The source covers valid guest, wrong guest, expired/revoked child, expired parent, detached/replaced subregistry, parent resale, and expiry bounds. The implementation under test is the spike-only `SpikeRegistrar.canUnlockV2`; it checks parent status, future expiry, expected parent owner and attached subregistry, then child status, owner, future expiry and parent-bounded expiry. The earlier `contracts/closure-test-attempt.log` remains a DNS failure before tests and is not the passing run. T6a is local-fork evidence only.

## A6 — ENSv2 resolution compatibility: RUNTIME-VERIFIED PASS (local Anvil fork)

The inspected paired-run log `docs/prep/evidence/T6b-20261105-031548.log` (checksum `56a5977ebdcc1b93ab87c478a22a27df10855f29d716fde9ff556dd36e701a17`) is RUNTIME-VERIFIED local Anvil fork evidence, not a live Sepolia transaction/test. On chain ID `11155111`, ethers v6 `provider.resolveName` and direct Universal Resolver `resolve(bytes,bytes)` both returned the seeded expected guest address; `ethersMatches`, `directMatches`, and `pathsAgree` were true; no errors; exit 0. The log records local Anvil fork block 12066798 (local head 12066808 after seed/probe) and upstream pre/post head 12066800 → 12066801. The scripts `contracts/scripts/seed-anvil-resolution.ts` and `contracts/scripts/resolve-test.ts` implement the seed and paired calls. The older `contracts/spike-output.log` is only the separate Q9 direct resolver test.

## Evidence artifacts and commands

- `contracts/spike-output-before-closure.log`: VERIFIED ARTIFACT: `contracts/spike-output-before-closure.log` exists and records 13 tests passing (inspectable). Provenance of the run itself: USER-REPORTED. It contains Q5/Q6/Q7/Q11 observations for A1–A3, the Q8 owner-recovery result, and the original parent-expiry defect.
- `contracts/spike-output.log`: a single Q9 direct Universal Resolver Foundry test, not a full closure run or paired ethers probe.
- `contracts/closure-test-attempt.log`: an earlier Foundry fork start failed on DNS before tests executed.
- `docs/prep/evidence/T6a-20261105-025207.log` and `.sha256`: A4/A5 closure group, 4/4 pass on a local Sepolia fork.
- `docs/prep/evidence/T6b-20261105-031548.log` and `.sha256`: A6 paired resolution, pass on a local Anvil fork.
- `docs/prep/evidence/A3lite-20261105-033934.log` and `.sha256`: five A3-LITE cases, 5/5 pass; does not complete the full A3 matrix.
- `docs/prep/evidence/T6-suite-rerun-20261105-045526.log` and `.sha256`: consolidated local fork suite, 17/17 pass. The earlier 16/1 result and Q11 correction/retest remain in the Phase 2b evidence trail.

No claim in this document means the corresponding behavior was tested on live Sepolia. The fork executes against Sepolia state locally; transactions and simulated writes remain fork-local.
