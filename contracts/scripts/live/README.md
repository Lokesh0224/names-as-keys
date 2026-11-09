# Terminal Sepolia toolkit — Stage A only

Deploy stops at **T14**. Keep **mira pristine for the frontend**. Proof runs use a separate label (default proofrun), never mira. T15 requires an explicit `--allow-mira` opt-in.

New terminal path; no MetaMask. Existing deployment_workflow, its hard block, authorizations and journals are untouched. Stage A tests use only a test-owned Anvil fork. No public deployment was run by the implementer. This code does not import or rewrite the old deployment journal. It cannot start at T03 without its own independently verified T01/T02 prefix. Migration from old receipts is NOT IMPLEMENTED; do not invent prefix entries.

## Requirements and commands

Node 22, ethers **6.17.0**, Anvil, historical Sepolia RPC access at block **12071963**, and existing solc 0.8.25 application artifacts under `contracts/out`. No artifact rebuilding is done by this toolkit. If dependencies are not already resolvable through contracts/node_modules, install only this package with `npm --prefix contracts/scripts/live install`. No keys belong in package scripts, files, command arguments or Git.

Required variable **names only**:

| Name | Purpose |
| --- | --- |
| LIVE_RPC_URL | Sepolia RPC; never printed |
| LIVE_PRIVATE_KEY | Owner signer; memory only; never printed or stored |
| LIVE_OWNER_ADDRESS | Must exactly match derived owner signer |
| LIVE_GUEST_ADDRESS | Nonzero distinct guest EOA |
| LIVE_GUEST_PRIVATE_KEY | Guest signer, required only for live-run; must match guest address |
| LIVE_PROOF_LABEL | Proof credential label; default proofrun; 3–32 lowercase letters/digits/hyphens, no edge hyphens; mira forbidden |
| LIVE_RESERVE_WEI | Minimum residual sender balance after maximum transaction gas cost; nonnegative integer wei, default 0.001 ETH |
| LIVE_CONFIRMATIONS | Required confirmations, including the receipt block; positive integer, default 3 |
| SEPOLIA_RPC_URL | Optional test-only archive upstream; tests otherwise use a built-in public endpoint |

No .env loader is included. Supply variables securely in the process environment. Do not enable shell tracing.

```sh
# Stage A: owned local fork only; random in-memory owner/guest keys, isolated temp files
npm --prefix contracts/scripts/live test
# Equivalent exact test command:
node --test --test-concurrency=1 contracts/scripts/live/test/*.test.mjs

# Default: READS ONLY. No secret, journal or attempt file is created by dry-run.
node contracts/scripts/live/run.mjs --step T03
node contracts/scripts/live/run.mjs --from T03 --to T14
# npm-style equivalent:
npm --prefix contracts/scripts/live run run -- --step T03

# Operator-only commands for a separately reviewed future run; NOT run by Stage A:
node contracts/scripts/live/run.mjs --step T01 --execute
node contracts/scripts/live/run.mjs --from T02 --to T14 --execute
# Separate opt-in only: consumes Mira and is not part of deployment/proof flow
node contracts/scripts/live/run.mjs --step T15 --allow-mira --execute
node contracts/scripts/live/live-run.mjs
node contracts/scripts/live/live-run.mjs --execute
node contracts/scripts/live/print-frontend-env.mjs
node contracts/scripts/live/run.mjs --status
```

Execute waits for LIVE_CONFIRMATIONS (default 3), verifies the receipt and resulting state, then atomically appends to `contracts/deployments/sepolia.live.json`. This is intentionally a separate configurable-confirmation workflow, NOT satisfaction of the old Stage 3F twelve-confirmation/finalized gates. An executed prefix is always rechecked from canonical receipts and historical block state; RPC must support those reads. A normal dry-run range stops at the first unsent transaction because dependent state/receipt-derived addresses do not exist. Skipped T01/T02 are persisted only with --execute after verifying the exact state; dry-run skips never invent progress.

## Secret and recovery

Execution T03 creates fresh random 32-byte registration secret at repository `.live/secret.json`, regular file mode 0600, with root/owner/chain binding. T04 loads it, reads commitment timestamp and MIN/MAX_COMMITMENT_AGE, waits using onchain time, and refuses expiry. Only verified T04 followed by persisted journal progression deletes it. A completed T04 rerun can finish interrupted cleanup. Never print, export or commit this file. Deletion is ordinary unlink, not a secure filesystem-erasure claim. Secret encryption/backups are NOT IMPLEMENTED.

An operator lock serializes writes. Each transaction is signed in memory; its hash and public envelope digest/facts are durably persisted in `.live/attempts/` BEFORE one broadcast. Raw signed transaction bytes, key and reveal calldata are never saved there. Rerunning an outstanding step reconciles only its precomputed hash; a pending, missing or reverted attempt stops. There is no resend, replacement, fee bump or automatic retry. A stale lock after a process crash needs explicit manual investigation; it is never automatically cleared. Partial external filesystem loss or a compromised host is outside this guarantee.

## Confidentiality boundary

Local signing avoids the MetaMask extension path. **T04 eth_call and estimateGas intentionally send the secret-bearing reveal calldata to LIVE_RPC_URL before broadcast**, including in dry-run. Use only an independently approved trusted RPC/owned local execution boundary. This is not proof that a public RPC keeps preimages confidential. No old T04 gate is removed, and Stage A does not authorize a real commitment/reveal. Test upstream relay permits only state reads, rejects calls/estimates/writes/signing and filters test preimage bytes, so secret-bearing execution remains in its owned node. Complete browser/network confidentiality is not claimed.

## Deliberate differences from candidate_steps.mjs

| Area | Difference / reason |
| --- | --- |
| Encodings | Same canonical signatures and constructor arguments. Root is mandated production label on the owned fork, not ordered-test synthetic root. Owner/guest are env-bound. No real project secret is read. |
| R1/R2 salts | Public 31001/31002 from ordered fixture, not existing candidate defaults. Factory deployer-bound. Collision reverts; no prediction is used for address bindings. |
| T01 | Balance >= quote skips; only a positive quote-minus-balance deficit is minted. |
| T02 | Exact allowance skips; other values use approve(exact quote). Both skips require verified scope-bound journal entries. Surplus balances are accepted; allowance remains exact. |
| Price | Fresh quote read each early step, capped at 8100000; after T02 it must remain identical to that record, instead of a frozen candidate bundle observation. |
| Secret | Explicitly requested 0600 disk persistence; original runner keeps the preimage only in memory. No candidate bundle, old authorizations or journal imports. |
| T04 | Trusted terminal RPC eth_call/estimateGas plus local signing instead of blocked MetaMask path/private estimator. Operator must review that RPC confidentiality boundary. |
| Identity/source | All required upstream code must exist; fixed linkage/factory identities checked. Full historical upstream runtime hash/immutable proof files are not imported, as requested read/scope restrictions exclude them. No independent upstream role-history census. |
| Products | Existing local application artifacts checked against current application source hash. Deployed runtime template masked only at compiler-declared immutable spans; immutable getter values and door identity checked separately. |
| Address derivation | Factory ProxyDeployed event or successful creation receipt and state reads only. No conditional CREATE/CREATE2 predicted address is a binding. |
| Verification | Selected exact event arguments and state/roles/runtime checks, not byte-for-byte complete ordered log inventory (LabelStore conditional log, ERC1155/initialization logs not exhaustively compared). |
| Timing/finality | LIVE_CONFIRMATIONS (default 3) required before verification/recording and on receipt recovery; canonical historical receipt revalidation; no 12-confirmation or finalized requirement, no two-block/120-second frozen packet review. |
| Preparation | Owner local signer, no trusted DOM click, no browser Web Locks, no MetaMask confirmation packet/GO file. Filesystem exclusive operator lock and durable attempt hash instead. |
| Fees | Explicit max fee 2 gwei, max priority 0.1 gwei, gas multiplier 120% for ordinary steps; CREATE T12/T14 use capped 110% with at least 5% headroom; ordinary ceiling 3000000, CREATE ceiling 16777216, cumulative deployment reserve <=0.03 ETH. Priority fee = min(RPC suggestion, 0.1 gwei); maximum fee = 2×current base fee + selected priority; a result above 2 gwei refuses. No auto retry. |
| Live proof run | Starts after T14, issues only LIVE_PROOF_LABEL with now+3600, unlocks/revokes that proof credential. Never issues or revokes mira, even if T15 was run separately. |

## Live proof and frontend output

live-run requires actual owner and guest signers; checks the exact active token, exactly one correct DoorUnlocked, reads R2.getState(tokenId), revokes expected token, and verifies static unlock reverts with exact InvalidCredential(). The denial is read-only, never a failing broadcast. Records confirmed issue/unlock/revoke links in `.live/proof-<label>.json` and `contracts/deployments/live-proof.md`. An interrupted run can reconcile saved successful hashes; a revoked proof label cannot be issued again by this registrar. No reset or label substitution is offered.

print-frontend-env revalidates receipts and reads code, prints only public addresses/runtime hashes/T14 hash and mode. RPC/public origin/exact guest URL must be configured privately by the operator; the toolkit never edits frontend. This does not attest a stable HTTPS origin or a public-network E2E run.

## Limits

- No current chain state or intended owner signing control is assumed from historical project progress.
- Signer/guest are EOAs without delegation; no multisig or smart-account support.
- Root/lock durations are 365/90 days; explicit opt-in T15 duration one day; separate proof issue one hour; no silent expiry clamping.
- No key custody, secret vault, root substitution, renewal/replacement, physical actuator or deployment journal migration.
- No production security audit or claim that the selected confirmation depth prevents reorgs.
- Tests never skip when RPC/Anvil is absent: unavailable archive access is a FAIL, not a simulated PASS.

## Status and dry-run output

`node contracts/scripts/live/run.mjs --status` is read-only: it prints T01–T14 as not-run, pending or verified with hash/block. It checks the saved journal, durable attempt hashes, canonical receipts, confirmation depth and historical verification state. A mined attempt not yet reconciled into the journal remains pending; a receipt with insufficient confirmations also remains pending. The next step is ordering eligibility only; fresh contract preconditions, funding and commit age still apply. Pending failures/reorgs block automatic advancement and require manual review. The command never mines, waits for confirmations, writes files, creates secrets or reconciles a journal.

Dry-run prints step/target/function, estimated gas, fee ceilings and ISO expiries for T08/T15/proof issuance, including a checked lockExpiry<=rootExpiry result. Skipped token steps show gas as N/A. T04 is a deliberate exception: output contains only the step, register function name and calldata byte length; no secret, raw bytes, target or fee details. Dry-runs stop at the first unexecuted dependent write as before.

The tests mine confirmation blocks using `anvil_mine` exclusively against their owned node. Production code only polls; it never mines or adjusts chain time. Raising LIVE_CONFIRMATIONS can make existing shallow journal entries/proof rows pending until the chain advances; lowering it below 1 or providing a non-integer is rejected. No old authorization or journal is changed by these settings.

## Per-step gas ceilings

T01–T11, T13, T15 and proof actions retain `ceil(estimate * 120 / 100)` and a 3,000,000 gas ceiling. CREATE steps T12/T14 instead use `min(ceil(estimate * 110 / 100), 16777216)`, with their soft ceiling equal to that protocol cap. CREATE gas policy rejects a raw estimate above the cap or `estimate * 105 > cap * 100` (less than 5% headroom); integer arithmetic preserves the exact boundary. A 14,673,850 estimate selects a 16,141,235 limit. Fee ceilings and the separate cumulative deployment budget are unchanged; funding/fee/budget guards can still independently refuse a send.

CREATE dry-runs print estimatedGas, padded/capped gasLimit, protocolCap, actual headroomPercent (relative to the estimate, rounded down to two decimal places), selected max fee, required ETH and current balance before gas/funding policy checks. Required balance is `gasLimit * selectedMaxFeePerGas + LIVE_RESERVE_WEI`. The default reserve is 0.001 ETH and may explicitly be set to zero or another nonnegative wei amount. It is a residual balance requirement, not a transaction payment or extra gas allowance. The selected max fee remains twice current base fee plus the bounded priority fee, subject to unchanged fee ceilings. Balance refusals print required/current amounts, and CREATE gas refusals also include those amounts. No secret or RPC URL is printed. T04 retains its redacted successful dry-run output; funding refusals can expose only public numerical costs.

A mined status-0 CREATE is atomically marked FAILED in its existing local attempt file with gasUsed, receipt block/hash and gasExhausted. A full gas limit consumed is labelled likely OOG; other reverts are not asserted to be OOG. It is never recorded as a verified deployment step. Execution stops with the transaction hash and refuses further sends for that attempt, including after restart; no higher-limit retry is offered. This also reconciles a failure whose broadcast response was lost. A confirmation wait is not used to postpone detecting a mined failure.

Fork measurements reflect the `anvil` selected by PATH; the suite prints its version. It neither upgrades Foundry nor changes files outside this toolkit. Do not treat a historical fork's measured creation gas as a guarantee of current Sepolia costs or an independently verified gas-scaling rule.

## Read-only T12 diagnosis

```sh
node contracts/scripts/live/run.mjs --diagnose T12
```

Requires only LIVE_RPC_URL and LIVE_OWNER_ADDRESS, plus this toolkit's existing `contracts/deployments/sepolia.live.json` with verified R1/R2 bindings. LIVE_PRIVATE_KEY is neither required nor read. No signer is constructed. Cannot combine with --execute or any other CLI option. No journal, attempt, secret or proof files are changed.

The command reconstructs the exact current-artifact T12 initcode with journal-bound owner/root/R1/R2, prints its public hash, and checks an existing T12 envelope hash if recorded. Without a recorded envelope hash, prior aborted-request byte-for-byte identity cannot be established independently. It compares five upstream code hashes plus the real journal R1/R2 at block 12071963 and a pinned current head, reports explicit 3M/6M/12M eth_call results (revert names only), and requests a read-only provider estimate for comparison. Unavailable historical reads are UNKNOWN, never SAME.

It starts a new owned Anvil fork at that same head, impersonates the owner there, submits creation with gas 12M and value zero, mines locally, reads its receipt and calls debug_traceTransaction with callTracer. No key or signed transaction is used. A loopback read-only upstream relay excludes writes/signing/calls/estimates, keeps the private RPC URL out of child argv, and the child does not inherit LIVE_* variables. A bind announcement from that exact child is required before any local RPC access. Only gasUsed and the ten most expensive inclusive call frames (target/selector/gas/depth) are printed, never raw traces or provider errors. The owned node and relay stop in finally cleanup; no existing Anvil process is reused or terminated.

Conclusion categories: caught-OOG means a successful local creation contains an inner OOG trace error; drift means a configured upstream code hash changed (new R1/R2 code absent at the baseline is reported but is not alone unexpected drift); provider estimate means local creation succeeded while the 12M provider call failed, its estimate was below local gasUsed, or its estimate exceeded local gasUsed by more than 20%; other means none was demonstrated. These are evidence categories, not definitive root-cause proofs. Code hashes do not reveal storage/configuration changes or attest the provider. The local execution model is Prague; exact Sepolia/provider EVM parity is not independently proven. The owner needs sufficient fork balance for the diagnostic transaction; it is not artificially funded. The remote endpoint must support historical reads, and Anvil must support callTracer.

The integration suite invokes the actual command handler against its existing owned 12071963-based fixture after T11. Its source head includes local R1/R2 setup; the diagnostic then creates a second owned fork at that fixture's current head. It asserts gasUsed, ten call frames, no access to a deliberately throwing private-key getter, and no changes to the source fork's head/nonce/journal.
