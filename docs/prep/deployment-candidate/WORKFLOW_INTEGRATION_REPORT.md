# Stage 3E unsigned candidate workflow integration

The local browser build loads the reviewed preflight plan, approved limits, contract ABIs and reviewed runtime identities. The candidate page uses existing MetaMask account access through the read-only adapter. The synthetic lifecycle has a separate HTML entry point and its own in-memory provider.

| Area | Implementation |
|---|---|
| Unsigned review | Checks selected owner and Sepolia, matches planned signer, nonce, destination and calldata, and verifies CREATE predictions. Shows decoded arguments, value, token balance and allowance for payment steps, identified review header, gas estimate, fee limits and expected event signatures. |
| Step readiness | Checks prior included receipts before estimating a dependent step. Rechecks step-specific contract identities and state, conditional token funding and allowance, quote, nonce agreement, role grants, ancestry, expiry and predicted address collisions as applicable. A missing prerequisite blocks the estimate. |
| Fee review | Estimates the exact envelope at an identified block, rounds gas upward using the approved multiplier and applies per-step gas, tip, fee, owner balance and cumulative cost caps. Uses a 1-wei candidate tip and twice the observed base fee plus tip. Stops if the base fee or limits make the envelope unusable. |
| Registration | Derives the commitment locally using the reviewed ABI encoding. The session generates its preimage in memory and verifies the confirmed commitment and reveal window. Reveal calldata is redacted from display and private estimation is confined to the isolated fork transport in this integration. |
| Receipt and state | Checks the mined envelope against the prepared packet. Derives registration events and generation bindings from the checked pre-state and mined header, then checks them against exact logs and receipt-block state. Reuses the engine's latest-head confirmation, independent finalized coverage, canonicality and current-state checks. Revalidates confirmed prerequisite receipts before advancing. |
| Journal and wallet context | Stores public digests, receipt identities, derived public state and gas costs under the candidate bundle digest. Account, network and disconnect events invalidate pending reviews and clear the active registration secret buffer. Confirmed records require rechecking. |

The browser has a deliberate T04 blocker. It cannot send reveal calldata to a public wallet/RPC estimator because the calldata includes the registration preimage. The fork exercises T04 through an isolated loopback estimator. The prepared receipt packet is held in page memory, so a reload can display journal evidence but cannot resume reconciliation or advance past a receipt whose packet is missing. Journal entries contain public digests and receipt evidence, without raw packet arguments or calldata. The in-memory reveal packet remains available for receipt rechecks until the page closes.

The receipt checks were exercised with mocked responses and on Anvil. Anvil used its local confirmation and finality model. The production browser entry point was exercised with a mocked DOM and wallet provider. It prepared T01, invalidated the display on chain change and made zero permission, signature or submission requests. No real MetaMask session was used for these tests.

## Verification

| Check | Result |
|---|---|
| `npm --prefix contracts/scripts/deployment_workflow test` | 75 passed, including three new candidate integration tests |
| `node contracts/scripts/deployment_candidate/review_regressions.mjs` | 19 passed |
| `node contracts/scripts/deployment_workflow/build.mjs` | Browser review and separate demo built |
| `node contracts/scripts/deployment_candidate/simulate.mjs --candidate-workflow` | 15/15 unsigned envelope comparisons and receipt reconciliations passed. Owned node stopped. |

The fork runner uses the reviewed historical snapshot and the same candidate adapter as the browser. Before each local send, it compares the adapter's reviewed calldata, gas and fee with the harness envelope. After mining, it feeds the actual local receipt through the adapter and records the verified public journal result. Earlier failed attempts exposed canonical event naming, resource version derivation and Anvil history requirements. The attempt logs and results are retained separately.

## First transaction blockers

- Stage 3F remains NO-GO and `LIVE_EXECUTION_ALLOWED=false`. Explicit authorization and independent review of the integrated candidate remain outstanding.
- T01 requires a current owner/Sepolia context and a fresh exact estimate and unsigned review within the approved caps. Refresh the canonical preflight and plan if the observed quote, token deficit, code, account or nonce prefix changes. The fork estimate is local evidence.
- Future receipts, generation IDs and expiry bindings are needed by their dependent steps. T04 additionally needs an approved private estimation transport, and a reload or interrupted session needs a reviewed recovery procedure before progression.

The source diff and test outputs are under `docs/prep/evidence/deployment-candidate/workflow-integration/`.
