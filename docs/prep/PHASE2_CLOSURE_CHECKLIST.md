# Phase 2 closure checklist — Phase 2b-LITE reconciliation

This checklist records the inspected human-local evidence and current dispositions. T6a and T6b were reconciled separately before this Phase 2b-LITE run. All fork evidence below is distinct from live Sepolia execution.

| Original task / item | Current disposition | Evidence / remaining work |
|---|---|---|
| E0: RPC/environment reconciliation | RESOLVED — USER-REPORTED | Human reported local `.env` loading and chain ID 11155111; no artifact retained. |
| T7a: address comparison | DEFERRED | Recheck before first live deployment or any Sepolia redeploy notice; existing address-page comparison is not chain association. |
| T7b: source diff | DEFERRED | Revisit on unexpected live Sepolia revert or redeploy notice. |
| T7c: deployed selector/implementation bytecode | DEFERRED | Revisit on unexpected live Sepolia revert or redeploy notice. |
| T8: selector table | DEFERRED / partial; `0xdab6c73c` UNKNOWN | Revisit if the selector appears in a Stage 2 test or UI path. Vendored matches do not establish runtime cause. |
| T10-design: S1–S6 and 16-cell design | RESOLVED as deliverable only | Inspected at `docs/prep/A3_EXPERIMENT_DESIGN.md:7-82`; source-derived, not runtime evidence. |
| A3-runtime: full matrix and remaining paths | DEFERRED | Only the five A3-LITE cells below have runtime evidence. Revisit for Stage 2 tests or before broader README non-transferability claims. |
| A3-runtime-lite: five scoped cells | RESOLVED — PASS, RUNTIME-VERIFIED | `docs/prep/evidence/A3lite-20261105-033934.log`; checksum `docs/prep/evidence/A3lite-20261105-033934.log.sha256` (`84e5f00b9d5790b886c5744e7d3f715109b022c2673ed3108aadc53768b71759`). 5 passed / 0 failed / 0 skipped; exit 0; local Sepolia fork, chain ID 11155111, block 12066912 → 12066913. Control unsafe transfer succeeded. Empty-bitmap unsafe transfer reverted with `0xe58f6d5a`; safe transfer reverted with `0x54838f98`; fixture `isEmancipated()` was false; self-grant reverted with `0xd1a3b355` (`EACCannotGrantRoles`). These observations apply only to the five test cases. |
| T6a: A4/A5 rerun | RESOLVED — PASS, RUNTIME-VERIFIED | Four closure tests passed on a local Sepolia fork (chain ID 11155111; block 12066685 → 12066686). Log: `docs/prep/evidence/T6a-20261105-025207.log`; checksum: `docs/prep/evidence/T6a-20261105-025207.log.sha256` (`b0be821dfa7ab33949995806583f0d93357c6bb817d117f3a9b86677bdaad7f1`). Not live onchain behavior. |
| T6b: A6 probe | RESOLVED — PASS, RUNTIME-VERIFIED | Local Anvil fork, chain ID 11155111; fork block 12066798. Both resolution paths matched the expected guest; no errors; exit 0. Log: `docs/prep/evidence/T6b-20261105-031548.log`; checksum: `docs/prep/evidence/T6b-20261105-031548.log.sha256` (`56a5977ebdcc1b93ab87c478a22a27df10855f29d716fde9ff556dd36e701a17`). Not live onchain behavior. |
| T6-consolidated: spike suite excluding A3-LITE | VERIFIED PASS — 17/17 | Authoritative rerun: `docs/prep/evidence/T6-suite-rerun-20261105-045526.log`; checksum `docs/prep/evidence/T6-suite-rerun-20261105-045526.log.sha256` (`56294ce7fcf0686430a72e69d42d13249cb792a07c534d749ae7b96fa05448c2`). Two test suites; 17 passed / 0 failed / 0 skipped; `exit_code=0`; chain ID after 11155111; block after 12067261; redaction verification PASS. The original `T6-suite-20261105-033849.log` (16 passed / 1 failed) remains preserved as historical evidence; Q11's assertion was corrected and independently retested before this successful full-suite rerun. |
| Q11-targeted: `testQ11_ObserveEventsExpiryAndLabelValidation` | VERIFIED PASS — targeted retest after assertion correction | `docs/prep/evidence/Q11-retest2-20261105-044757.log`; checksum `docs/prep/evidence/Q11-retest2-20261105-044757.log.sha256` (`d1682af09b1f4ca82b33c7ecbedb8f2fac3c02f539b928c64a3bc7745e09efab`). 1 passed / 0 failed / 0 skipped; exit 0; chain ID 11155111 before/after; block 12067224 → 12067226; redaction check passed. The earlier `Q11-retest-20261105-044506.log` ended at metadata preflight with DNS resolution failure (`exit_code=22`); no Forge test executed. |
| T9/A2 12-cell matrix | DEFERRED | Product rule is unique label per grant, with no reuse promise. Revisit if reuse/reassignment is promised or in Stage 2 tests; three outcomes are documented. |
| A1: `0xdab6c73c` | DEFERRED / UNKNOWN | Revisit if the selector appears in a Stage 2 test or UI path. |
| N1: source-vs-deployed bytecode match | DEFERRED | Revisit if a source-level guarantee about deployed code is required. |
| N2: dated Q8 evidence rerun | RESOLVED — RUNTIME-VERIFIED | Q8 result lines and passing `testQ8_OwnerRevokesRegistrarAndRecoversDirectControl` are retained in the authoritative 17/17 rerun: `docs/prep/evidence/T6-suite-rerun-20261105-045526.log`; checksum `docs/prep/evidence/T6-suite-rerun-20261105-045526.log.sha256` (`56294ce7fcf0686430a72e69d42d13249cb792a07c534d749ae7b96fa05448c2`). The older 16/1 log remains historical only. |
| N3: REVOKED vs EXPIRED state | DEFERRED to Stage 2 | Keep state distinction unclaimed; add runtime assertion to A2 test if that work is revisited. |
| N4: A6 `tsx`/`ethers` dependencies | RESOLVED as superseded by T6b/A6 | T6b paired-resolution run is resolved; no agent dependency installation. |
| N5: stale `SPIKE.md` 13/13 pointer | DEFERRED docs-only | Existing pointer discrepancy remains outside this reconciliation. |
| N6: Phase 1 human carry-overs | BLOCKED pending human decisions | AI attribution, event rules, pre-existing-code ruling, Git provenance, backup durability. |
| N7: evidence log metadata | OPEN | Historical Phase 2a logs omit fork block/chain ID; future runtime logs should record observed values. |
| N8: initializer bitmap wording | RESOLVED as reconciliation | Fixture-specific Q8 behavior remains distinct from unverified initializer bitmap. |

## Checkpoint R findings

- Contradiction found: `SPIKE.md:84` attributes the historical 13/13 Stage 0 result to `contracts/spike-output.log`, while the inspected reconciliation and closure documents identify `contracts/spike-output-before-closure.log` as the preserved 13/13 log and `spike-output.log` as one Q9 test. The stale file is outside the Checkpoint R edit allowlist; it remains N5.
- Initializer bitmap statements are not contradictory when scoped correctly: a fixture-specific Q8 owner-recovery test passed in the preserved log; the exact intended/deployed initializer bitmap is still unverified.
- At the time of Checkpoint R, no inspected document claimed the transfer matrix, A2 matrix, or live Sepolia behavior was verified. The later Phase 2b-LITE A3 evidence is limited to its five listed local-fork cells; local fork evidence remains distinct from live Sepolia evidence.
- Nine evidence logs were inventoried with filename timestamps and sizes in `docs/prep/PHASE2A_CLOSURE_TRACKER.md`. Their headers lack fork block and chain ID; failed/source-only activity has no observed fork identifiers.

## Phase 2b-LITE follow-up disposition

1. T6a and T6b remain separately resolved. Q11 is VERIFIED PASS in its targeted retest, and T6-consolidated is now VERIFIED PASS (17/17) from the later full-suite rerun. The earlier 16 passed / 1 failed run remains historical evidence. Q8 retention is resolved under N2.
2. The five A3-LITE cells are resolved on their observed outcomes. Remaining A3 cells and operator/root/batch/emancipated paths are deferred to Stage 2 or before broader README non-transferability claims.
3. T9/A2, T7b/T7c, T8/A1, and N1 remain deferred under the triggers in the table above. N3 remains deferred to Stage 2.

## Human decisions still needed

- Resolve N6 carry-overs listed above.

## Confirmation for this checkpoint

Checkpoint R was document reconciliation only. No tests, Forge, forks, or RPC calls were run in that checkpoint. No environment file was opened. No Stage 2/3 files or validated files were modified. No live transactions, signing, or deployment occurred. An incidental read-only `git status` command was attempted at the start and failed because the working directory is not a Git repository; it made no changes. At the time of that checkpoint the consolidated suite failure was still open; the later Q11 retest and T6 suite rerun are recorded above.
