# Candidate reviewer corrections

Baseline: `a23821d7fd8056c0ec473d67d18890e775a16f11`. `LIVE_EXECUTION_ALLOWED=false`; Stage 3F remains NO-GO. No production contracts were changed. No wallet requests, live writes, staging, commits or pushes were performed.

## Checks performed

The guarded owned-loopback Anvil run replayed all 15 review-plan steps at Sepolia snapshot **12073440**, hash `0x5230826f1ca25ae61f14bea0c149c8f1fa7f6f7b012d5ccae4a4f8a54015213d`. Snapshot and pending owner nonces both equaled 50 when observed. Preparation checked canonical snapshot identity, pending nonce agreement, and configured review age. A mismatch blocks preparation and replaces the public packet with a BLOCKED packet. The recorded freshness is a preparation-time observation, not a continuing approval or a reservation of the nonce/name.

Each simulated transaction was compared against the identified review-plan file: ordered inclusion, nonce, destination, value, chain ID, known arguments and known calldata. Deferred substitutions are individually recorded as fork-only: commitment/preimage (values withheld), root and lock token IDs from local receipts, and lock/guest expiries from identified local timestamps. No local receipt is a confirmed live binding.

Mined transaction checks separately verified sender, nonce, calldata, destination (including creation), value, chain ID, gas limit, max fee and priority fee; receipt gas/effective fee were bounded. Exact events, hierarchy links, roles, ownership, expiries and full runtime checks also passed. Configurable freshness, 600-second guest margin, gas multiplier/caps, fee/spending ceilings and confirmation/finality settings come from APPROVED_INPUTS.json. Security role/chain/resource constants are asserted against retained reviewed upstream source and unchanged project source hashes.

T01 now displays and encodes the exact token deficit. A regression uses a nonzero partial token balance. Production connection code accepts only a trusted native click; a provider-controlled testOnly property cannot bypass it. Synthetic events exist only in Node test infrastructure. No actual MetaMask connection was attempted.

## New evidence and results

All new correction evidence is under `docs/prep/evidence/deployment-candidate/reviewer-corrections/`; earlier evidence remains historical. `prior/` preserves pre-correction source/report/plan versions. The new simulation-result.json identifies its exact review-plan SHA256 and explicitly classifies the run as a historical fork replay, not fresh live review.

- Workflow/connection: 72 passed, 0 failed (`workflow-tests.log`).
- Focused correction regressions: 17 passed, 0 failed (`regression-tests.log`).
- Candidate transport/prediction/privacy: 8 passed, 0 failed (`candidate-tests.log`).
- Guarded simulation: PASS, 15 successful transactions; owned node/proxy stopped (`simulation-result.json`, `simulation.log`).

No production Foundry suite or real consensus/finality test was run for these workflow-only corrections. Anvil confirmation/finality tags are a local model; real chain fork-rule parity, fees, signing control and canonical receipt reconciliation remain live gates. Historical prior success/failure logs have not been replaced.

## Remaining gates

Independent review; owner-performed connection check; a new fresh canonical public review and unchanged nonce prefix; funding/allowance and current runtime/role checks; private live-session preimage and actual canonical receipt/generation/expiry bindings; explicit future authorization. Current packets become stale under the approved 120-second/two-block limits. Run inspect.mjs, derive.mjs and prepare.mjs sequentially for a fresh packet before reviewing it; simulate.mjs only replays the identified snapshot on its own disposable loopback fork. No live execution is enabled by these commands.
