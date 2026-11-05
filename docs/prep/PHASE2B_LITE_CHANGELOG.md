# Phase 2b-LITE reconciliation changelog

Date: 2026-11-05

## Evidence inspected

No tests, Forge commands, probes, or RPC calls were run for this reconciliation. Both logs and checksum sidecars were inspected. `sha256sum -c` passed for each sidecar.

| Evidence | Verified checksum | Recorded run result |
|---|---|---|
| `docs/prep/evidence/T6-suite-20261105-033849.log` | `528a4a1894e9256e0b060026431d8d668d88bd62b2b986fb9af2c7f25eaea4e6` | Chain ID 11155111; block 12066909 → 12066910; build exit 0; Forge exit 1; 16 passed, 1 failed, 0 skipped across 17 tests. |
| `docs/prep/evidence/A3lite-20261105-033934.log` | `84e5f00b9d5790b886c5744e7d3f715109b022c2673ed3108aadc53768b71759` | Chain ID 11155111; block 12066912 → 12066913; build exit 0; Forge exit 0; 5 passed, 0 failed, 0 skipped. |
| `docs/prep/evidence/T6-suite-rerun-20261105-045526.log` | `56294ce7fcf0686430a72e69d42d13249cb792a07c534d749ae7b96fa05448c2` | Chain ID after 11155111; block after 12067261; build exit 0; Forge exit 0; 2 suites, 17 passed, 0 failed, 0 skipped. |

T6-suite and its rerun are consolidated local Sepolia-fork evidence, not live Sepolia execution. The initial run's 16 passed / 1 failed result and Q11 assertion failure remain preserved as historical evidence. Q8 output is retained: both Q8 error-selector result lines are `1260888371`, `Q8_ownerDirectUnregister true`, and `testQ8_OwnerRevokesRegistrarAndRecoversDirectControl` passed. N2 is resolved and cites the authoritative 17/17 rerun, `docs/prep/evidence/T6-suite-rerun-20261105-045526.log`; the earlier failing log remains historical only.

The A3-LITE log reports these five passing outcomes:

| Cell | Source prediction | Observation |
|---|---|---|
| Transfer-capable unsafe control | Succeeds | Succeeded; observed selector decimal 0; token bitmap was nonzero and included the configured transfer role. |
| Empty-bitmap unsafe single transfer | Reverts with `0xe58f6d5a` | Reverted with `0xe58f6d5a` (decimal 3851382106). |
| Empty-bitmap safe single transfer | Reverts first with `0x54838f98` | Reverted with `0x54838f98` (decimal 1417908120). |
| Fixture emancipation state | `false` | `false`; logged owner root bitmap and registrar root bitmap 4097. |
| Guest self-grant of transfer-admin role | Reverts | Reverted with `0xd1a3b355` (`EACCannotGrantRoles`, listed in `docs/ens-errors.md`). |

These observations support only the five listed cases in this local fork. They do not establish the remaining A3 matrix cells, operator/root/batch paths, general non-transferability, or live Sepolia behavior.

## Integrity and redaction checks

For both logs, the logged hashes match the current files: `ClosureA3Lite.t.sol` (`01b3e685ae340f18707b5bdea935dae139367e2a5b211b659ed5b272020fafe8`), `ENSv2Questions.t.sol` (`e6794a156260573fc1ed15a6a02a1f9d3c785ca159ee97bea2a19d00689b8257`), `SepoliaDeploymentSmoke.t.sol` (`9a3852e8b7c5564c8dfc3dc1d2b1726a0b3b7f2dfe1292101bf72ba91bea4d10`), `run-evidence.sh` (`e858041ea2459201cf8a970b82229e6583e24a5117a9bbdb446800a17246a597`), and `redact.py` (`2911c10281c91ae03cbe59c991e1f179b0f07c188c9db6406b28232899d105bb`).

The runner calls the redactor's fail-closed verification before writing the checksum sidecar. Both matching sidecars are present, so the runner's redaction check completed successfully. Its PASS message is printed to the local terminal, not embedded in the log. No RPC endpoint or provider host was found in either log; generic compiler-help URLs are present. The logs remain local-fork artifacts, not live-chain records.

## Tracker and checklist dispositions

- T6a and T6b/A6 remain separately resolved from their earlier evidence; neither was rerun or altered.
- T6-consolidated is VERIFIED PASS (17/17) from the later full-suite rerun; the original 16/1 result remains historical. Q11's targeted retest is separately VERIFIED PASS, and Q8 retention is RESOLVED under N2.
- N2's resolving citation is the successful `docs/prep/evidence/T6-suite-rerun-20261105-045526.log` (17/17), not the historical 16/1 run.
- A3-runtime-lite is RESOLVED for the five inspected passing cells. Full A3-runtime and the remaining operator/root/batch/emancipated paths are DEFERRED to Stage 2 testing, or until broader README non-transferability claims are considered.
- E0 is RESOLVED as USER-REPORTED (local `.env` loads, chain ID 11155111; no retained artifact).
- T7a is DEFERRED until before the first live deployment or a Sepolia redeploy notice. T7b/T7c are DEFERRED unless an unexpected live Sepolia revert or redeploy notice prompts investigation.
- T8/A1 remain DEFERRED with `0xdab6c73c` UNKNOWN; revisit if it appears in a Stage 2 test or UI path.
- T9/A2 is DEFERRED while product rules require a unique label per grant and make no reuse/reassignment promise. Revisit if such a promise is made or in Stage 2 tests.
- N1 is DEFERRED unless a source-level guarantee about deployed code is required. N3 remains deferred to Stage 2. N4 is resolved as superseded by T6b/A6. N5/N6 are unchanged.

Every movement is recorded in the tracker Movement log with approver `human, APPROVE 2b-LITE`. The tracker, checklist, and this changelog are the only files changed for this reconciliation. Pre-edit copies are in `/tmp/names-as-keys-backups/phase2b-lite-reconcile-20261105/`.

## Q11 targeted retest reconciliation

Inspected the following human-local evidence and sidecars:

- `docs/prep/evidence/Q11-retest2-20261105-044757.log`
- `docs/prep/evidence/Q11-retest2-20261105-044757.log.sha256` — verified; log SHA-256 `d1682af09b1f4ca82b33c7ecbedb8f2fac3c02f539b928c64a3bc7745e09efab`.
- `docs/prep/evidence/Q11-retest-20261105-044506.log`
- `docs/prep/evidence/Q11-retest-20261105-044506.log.sha256` — verified; log SHA-256 `98a18b463c5d01cbafab2f6704684e6e6749862ce119c0eedc6c5069ba155891`.

The retest log records `testQ11_ObserveEventsExpiryAndLabelValidation` PASS, 1 passed / 0 failed / 0 skipped, `exit_code=0`, `chain_id_before=11155111`, `chain_id_after=11155111`, and blocks 12067224 → 12067226. `forge_build_exit_code=0`. The evidence runner's fail-closed redaction verification passed before it created the checksum sidecar; the PASS line is emitted to the runner terminal and is not embedded in the log.

The earlier `Q11-retest-20261105-044506` is a metadata preflight DNS failure, not a Forge test failure: it records `chain_id_before=FAILED (DNS resolution)` and `exit_code=22 (metadata preflight stopped)`, with no test execution. Its checksum is valid and the evidence runner's redaction verification completed before sidecar creation.

Confirmed the current source at `contracts/test/spike/ENSv2Questions.t.sol:616` contains `assertFalse(spikeRegistrar.canUnlock("parentbound", guest))`. This corrects the former assertion mismatch: `canUnlock()` checks child registration status, child expiry, and child owner; `canUnlockV2()` performs the parent-aware checks. The targeted retest verifies this Q11 assertion only.

`Q11-targeted` is recorded as **VERIFIED PASS — targeted retest after assertion correction**. At the time of that reconciliation the complete suite had not yet been rerun; the successful rerun below supersedes the open T6 status without deleting the original evidence. A3-LITE remains at its previously verified 5/5 pass status. T6a/T6b, deferred tasks, and Phase 2a/2b scope boundaries are unchanged. No source, test, contract, evidence, or other non-documentation file was modified for the Q11 reconciliation; no new test was run then.

## T6 consolidated suite rerun — authoritative current result

Verified `docs/prep/evidence/T6-suite-rerun-20261105-045526.log` against `docs/prep/evidence/T6-suite-rerun-20261105-045526.log.sha256`; SHA-256 is `56294ce7fcf0686430a72e69d42d13249cb792a07c534d749ae7b96fa05448c2`. The log records two test suites, 17 passed / 0 failed / 0 skipped, `exit_code=0`, `chain_id_after=11155111`, and `block_after=12067261`. Redaction verification passed before the evidence runner wrote the checksum sidecar; its PASS message is emitted by the runner and is not embedded in the log.

T6 consolidated is now **VERIFIED PASS (17/17)**. The earlier 16 passed / 1 failed suite result remains intact as historical evidence. The subsequent Q11 targeted retest independently confirmed the corrected assertion, and the successful full rerun then passed Q11 in suite context. A3-LITE remains PASS (5/5). No source, test, contract, evidence, or unrelated file was modified for this documentation reconciliation, and no new test was run.
