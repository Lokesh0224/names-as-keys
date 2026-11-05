# Phase 2b changelog

## 2026-11-05 — Human-local execution procedure prepared

- Added `docs/prep/runners/run-evidence.sh` and `docs/prep/runners/redact.py` for human-local sanitized, timestamped, hash-checked evidence capture. The wrapper loads `.env` silently, avoids putting the RPC URL in argv, runs `forge build` before the requested command, records chain/block metadata before and after, refuses overwrite, and deletes the log if secret verification fails.
- Ran only `bash -n` and the offline synthetic redactor self-test; self-test result: PASS. No RPC, Forge, Anvil, install, or package operation was run.
- Added `docs/prep/PHASE2B_LOCAL_RUNBOOK.md` with the exact T6a command, four matched existing test names, expected evidence, and pass/fail criteria.
- Updated `docs/prep/PHASE2A_CLOSURE_TRACKER.md` with the sanitized environment diagnosis: inherited RPC variables UNSET, `.env` exists and loads `SEPOLIA_RPC_URL`, and DNS resolution fails in the agent execution environment. T6a, T6b, A3-runtime, T9/A2, and N4 await human-local execution; no runtime result is marked resolved.
- N1 and N2 remain blocked pending their separate human approvals. No test source or validated file was modified. No backup was needed because only new documentation and runner files were created.

## 2026-11-05 — T6a evidence reconciled

- Inspected `docs/prep/evidence/T6a-20261105-025207.log` and its `.sha256` sidecar; `sha256sum -c` passed.
- Verified log SHA-256: `b0be821dfa7ab33949995806583f0d93357c6bb817d117f3a9b86677bdaad7f1`.
- Header records `executed_by=HUMAN-LOCAL`, Forge 1.3.5, chain ID 11155111, and block 12066685 → 12066686. `forge_build_exit_code=0`, all four expected `testClosure` tests passed, overall result 4 passed / 0 failed / 0 skipped, and exit code is 0.
- Verified both test-source hashes and the runner/redactor hashes in the log against current files. The supplied redaction-check result is PASS; no endpoint or `.env` value appears in the inspected log.
- Marked T6a RESOLVED / PASS / RUNTIME-VERIFIED in the tracker and checklist. This is human-executed local Sepolia fork evidence, not live onchain behavior. No phase movement occurred; T6b, A3-runtime, and T9/A2 remain open.

## 2026-11-05 — T6b A6 local procedure prepared

- Inspected `contracts/scripts/seed-anvil-resolution.ts`, `contracts/scripts/resolve-test.ts`, and the local runbook. Confirmed the seed writes only through the configured local Anvil provider; the paired probe asserts Sepolia chain ID and outputs `ethersMatches`, `directMatches`, and `pathsAgree`.
- Confirmed `tsx` and `ethers` resolve from the existing `contracts/node_modules`; no package install or dependency edit was made. Offline `anvil --help` confirms the `--fork-url`, `--chain-id`, and `--host` flags.
- Added `docs/prep/runners/run-a6-pair.sh` to hash the A6 scripts, run seed and probe through the approved evidence runner, and stop if local script dependencies are missing.
- Expanded `docs/prep/PHASE2B_LOCAL_RUNBOOK.md` with the private Anvil terminal procedure, exact runner command, expected assertions, pass/fail conditions, and safe evidence handoff.
- At procedure-preparation time, T6b remained OPEN / AWAITING HUMAN LOCAL RUN. No Anvil, Forge, RPC, or A6 script was run by the agent. A3-runtime and T9/A2 were not started; no phase movement occurred.

## 2026-11-05 — T6b evidence reconciled

- Inspected `docs/prep/evidence/T6b-20261105-031548.log` and its `.sha256` sidecar; `sha256sum -c` passed. Recorded log SHA-256: `56a5977ebdcc1b93ab87c478a22a27df10855f29d716fde9ff556dd36e701a17`.
- Verified the recorded hashes for `seed-anvil-resolution.ts`, `resolve-test.ts`, `run-a6-pair.sh`, `run-evidence.sh`, and `redact.py` match current files. The log identifies `executed_by=HUMAN-LOCAL`, chain ID 11155111, and records upstream head 12066800 → 12066801 plus local Anvil fork block 12066798 and local head 12066808 after simulation.
- Probe output shows both resolution paths equal the expected guest address; `ethersMatches`, `directMatches`, and `pathsAgree` are all true; both error fields are null; build and overall exit codes are zero. The supplied redaction result is PASS.
- Marked T6b RESOLVED / PASS / RUNTIME-VERIFIED in the tracker and checklist. This is local Anvil fork evidence, not live Sepolia execution. No phase movement occurred; A3-runtime and T9/A2 remain open and unchanged.
