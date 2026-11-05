# Pre-existing work and provenance

## Provenance status

[USER-REPORTED] Git was deliberately not initialized (human decision); `.git/` is empty; first-commit hashes and tracked-file status are UNKNOWN. This is a documented limitation. The inventory below is filesystem-based, not a claim about tracked status.

## Pre-existing project files and directories

Every path in this table existed before Phase 1. **First commit hash: UNKNOWN for every row** because commit metadata is unavailable.

| Path / path group | What it is | First commit |
|---|---|---|
| `SPIKE.md` | Stage 0 historical ENSv2 findings and runbook; its header points to later Stage 1 reports. | UNKNOWN |
| `contracts/README.md` | Contracts-local readme. | UNKNOWN |
| `contracts/foundry.toml`, `contracts/remappings.txt` | Foundry configuration and remappings. | UNKNOWN |
| `contracts/.gitignore`, `contracts/.env` | Contracts environment ignore rules and local ignored RPC environment file. `.env` was not read. | UNKNOWN |
| `contracts/deployments/sepolia.json` | Sepolia ENSv2 deployment-address manifest. | UNKNOWN |
| `contracts/scripts/run-spike.sh` | Fork test runner; reads `SEPOLIA_RPC_URL` from ignored environment and redacts endpoint output. | UNKNOWN |
| `contracts/scripts/resolve-test.ts` | Paired ethers v6 / direct Universal Resolver A6 probe. | UNKNOWN |
| `contracts/scripts/seed-anvil-resolution.ts` | Local Anvil fork setup for the A6 subname/address-record probe. | UNKNOWN |
| `contracts/src/spike/SpikeRegistrar.sol` | Spike-only registrar and `canUnlockV2`; not production DoorKeys. | UNKNOWN |
| `contracts/test/spike/ENSv2Questions.t.sol` | Stage 0 and A4/A5 fork experiments. | UNKNOWN |
| `contracts/test/spike/SepoliaDeploymentSmoke.t.sol` | Deployment smoke tests. | UNKNOWN |
| `contracts/src/ens-vendored/VENDOR.txt` | Vendoring note; ENSv2 tag `sepolia-deployment-2026-09-15`, commit `f2f0a05e6c1711134b73204a1e37f8e6c1aea6ab`. | UNKNOWN |
| `contracts/src/ens-vendored/access-control/{interfaces/IEACGrantInitializable.sol,interfaces/IEnhancedAccessControl.sol,libraries/EACBaseRolesLib.sol}` | ENSv2 access-control types, interfaces, and role bitmaps. | UNKNOWN |
| `contracts/src/ens-vendored/erc1155/interfaces/IERC1155Singleton.sol` | ENSv2 ERC1155 singleton interface. | UNKNOWN |
| `contracts/src/ens-vendored/interfaces/{IPublicResolverV2.sol,IUniversalResolver.sol}` | Resolver interfaces used by spike. | UNKNOWN |
| `contracts/src/ens-vendored/oz/{IERC1155.sol,IERC20.sol,IMockERC20.sol}` | Minimal token interfaces used by spike. | UNKNOWN |
| `contracts/src/ens-vendored/registrar/interfaces/{IETHRegistrar.sol,IETHRenewer.sol}` | Registrar/renewer interfaces. | UNKNOWN |
| `contracts/src/ens-vendored/registry/interfaces/{IOwnedRegistry.sol,IPermissionedRegistry.sol,IRegistry.sol,IRegistryEvents.sol,IRegistryURIRenderer.sol,IStandardRegistry.sol,ITemporalRegistry.sol,ITokenizedRegistry.sol}` | Registry interfaces and events used by tests/checks. | UNKNOWN |
| `contracts/src/ens-vendored/registry/libraries/RegistryRolesLib.sol` | Registry role bitmap constants, including transfer/emancipation masks. | UNKNOWN |
| `contracts/src/ens-vendored/resolver/interfaces/{IPermissionedResolverInitializable.sol,setters/IAddressSetter.sol}` | Permissioned resolver initializer and address setter interfaces. | UNKNOWN |
| `contracts/src/ens-vendored/resolver/libraries/PermissionedResolverLib.sol` | Resolver role constants copied for the spike. | UNKNOWN |
| `contracts/src/ens-vendored/reverse-registrar/interfaces/IContractNamer.sol` | Contract naming interface. | UNKNOWN |
| `contracts/src/ens-vendored/utils/{LibLabel.sol,interfaces/IUnsafeTransferable.sol}` | Label helper and unsafe transfer interface. | UNKNOWN |
| `contracts/src/ens-vendored/verifiable-factory/IVerifiableFactory.sol` | VerifiableFactory interface. | UNKNOWN |
| `contracts/lib/forge-std/**` | Foundry standard library checkout; not project product code. Its own commit metadata could not be inspected as repository provenance. | UNKNOWN |
| `contracts/spike-output-before-closure.log` | Preserved Stage 0 13/13 local-fork log. | UNKNOWN |
| `contracts/spike-output.log` | Current one-test Q9 direct resolver local-fork output. | UNKNOWN |
| `contracts/closure-test-attempt.log` | Earlier failed fork startup log; records DNS failure before tests. | UNKNOWN |
| `docs/ens-errors.md` | Selector/error notes. | UNKNOWN |
| `docs/closure-evidence.md` | Stage 1 Part A evidence and limitations. | UNKNOWN |
| `docs/stage-1-part-a-final-audit.md` | Stage 1 Part A evidence audit and conditional Part B recommendation. | UNKNOWN |
| `.agents/`, `.aws/`, `.codex/` | Pre-existing hidden directories; contents not inspected in Phase 0. | UNKNOWN |
| `contracts/script/` | Empty directory at Phase 0. | UNKNOWN |
| `contracts/node_modules/` | Existing installed JS dependency tree (including ethers/tsx); no project `package.json` was found. | UNKNOWN |
| `contracts/out/`, `contracts/cache/` | Existing Foundry build/cache artifacts. | UNKNOWN |

The `contracts/lib/forge-std/` subtree contained 72 files at inspection; its files are the installed Forge Std dependency. The exact per-file first commits are unavailable without Git metadata. `contracts/node_modules/` contained 1,897 files and `contracts/out/` plus `contracts/cache/` contained 59 files at inspection; they are dependency/build/cache artifacts, not established source history. Their first-commit status is likewise UNKNOWN.

## Hackathon work status

[VERIFIED ARTIFACT — Phase 0 snapshot] The initial inventory found no `web/`, root README, LICENSE, production `DoorKeys.sol`, production tests, or production deployment scripts at that time. This historical statement does not describe later Phase 2 closure preparation.

[UNKNOWN] Whether spike or research files may be submitted as hackathon work, and the required disclosure language, must be confirmed from the event organizer's official rules page. No organizer approval is claimed.

**Historical Phase 0/1 status:** “Hackathon implementation work: NONE YET.” At that point, Stage 1 Part B had not started and only Phase 1 documentation/hygiene was authorized. Subsequent Phase 2 closure and fork-test work is recorded below; this does not authorize Stage 2/3 implementation.

## Phase 2 pre-hackathon work addendum — 2026-11-05

This addendum records later ENSv2 technical preparation and closure work. It supplements the Phase 0 inventory; it does not establish event-rule approval or claim live Sepolia behavior.

- **Spike development and ENSv2 integration experiments:** The repository contains the spike-only `contracts/src/spike/SpikeRegistrar.sol`, `contracts/test/spike/ENSv2Questions.t.sol`, and deployment smoke tests. Experiments covered parent registration/subregistry lifecycle, guest child registration and unlock checks, expiry/revocation/resale, role behavior, resolver writes, and label reuse observations. `contracts/scripts/seed-anvil-resolution.ts` seeds a local fork and `contracts/scripts/resolve-test.ts` compares ethers v6 `provider.resolveName` with a direct Universal Resolver call.
- **Fork test verification:** T6a/A4-A5 has a retained four-test pass on a local Sepolia fork in `docs/prep/evidence/T6a-20261105-025207.log` (4 passed, exit 0). T6b/A6 has a retained paired-resolution pass on a local Anvil fork in `docs/prep/evidence/T6b-20261105-031548.log`. The current consolidated T6 run is `docs/prep/evidence/T6-suite-rerun-20261105-045526.log` (2 suites, 17 passed, 0 failed, 0 skipped, exit 0); the earlier 16/1 run remains historical evidence. Q11's child-only assertion was corrected, passed its targeted retest, and then passed in the full suite.
- **A3-LITE scope:** `contracts/test/spike/ClosureA3Lite.t.sol` and `docs/prep/evidence/A3lite-20261105-033934.log` record five passing cases: transfer-capable unsafe control; empty-bitmap unsafe and safe transfers; fixture emancipation state; and guest self-grant. This is five scoped local-fork cases only. The full A3 matrix, emancipated-state comparison, and remaining operator/root/batch paths are not verified; general non-transferability is not established.
- **Evidence tooling and records:** The human-local evidence workflow uses `docs/prep/runners/run-evidence.sh`, `docs/prep/runners/redact.py`, and the A6 helper `docs/prep/runners/run-a6-pair.sh`. Runbooks and logs record command scope, metadata, hashes, redaction checks, exit codes, and checksum sidecars. The successful fork runs are explicitly local execution artifacts, not live transactions.
- **Supporting documentation:** Work is documented in `docs/closure-evidence.md`, `docs/stage-1-part-a-final-audit.md`, `docs/prep/PHASE2A_CLOSURE_TRACKER.md`, `docs/prep/PHASE2_CLOSURE_CHECKLIST.md`, `docs/prep/PHASE2B_LITE_CHANGELOG.md`, `docs/prep/EVIDENCE_LEDGER.md`, `docs/prep/A3_EXPERIMENT_DESIGN.md`, `docs/prep/vendor-drift.md`, `docs/ens-errors.md`, `docs/prep/RISK_REGISTER.md`, `docs/prep/DOC_RECONCILIATION.md`, and the preparation/compliance records.

These activities are pre-hackathon spike, integration, test, and documentation work. They do not by themselves establish production DoorKeys implementation, live transactions, or authorization for Stage 2/3 work. The separate AI attribution record is in `docs/prep/AI_USAGE.md`.
