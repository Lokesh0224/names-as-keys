# Unsigned deployment review

A fresh source build defaults to NO-GO. T01 and T02 have finalized Sepolia receipts; see the [current project status](../../../README.md#verified-sepolia-progress). T03–T15 are not executed, and T04 remains hard-blocked. The main page uses existing MetaMask account access through a read-only adapter. Select the approved owner on Sepolia (11155111). The default page uses read-only wallet requests. It clears the displayed review on account, chain or connection changes.

From the repository root, with Node.js 22 and Foundry installed:

```sh
npm --prefix contracts install --no-save --package-lock=false ethers@6.17.0
forge build --root contracts
npm --prefix contracts/scripts/deployment_workflow ci
npm --prefix contracts/scripts/deployment_workflow test
npm --prefix contracts/scripts/deployment_workflow run build
node contracts/scripts/deployment_workflow/serve.mjs
```

With MetaMask installed, open `http://127.0.0.1:8769/` for the candidate. The build loads the recorded fresh-preflight candidate and approved limits. At review time, the app checks the current owner, network, applicable state, nonce and fee envelope. If the reviewed quote, prefix or other binding has changed, refresh the candidate. The synthetic lifecycle is a separate page at `http://127.0.0.1:8769/demo.html`.

Choose a step and prepare its unsigned review. After a reload, the workflow rebuilds public drafts from the original canonical review block and prepares a fresh review. Receipt recovery checks the reconstructed packet against its journal digests and verifies the mined envelope, events, canonicality, confirmations, finalized coverage and current state. Enter the transaction hash if the journal has not recorded it yet. Recovery requires a provider that can serve the original historical state.

The loopback server handles T04 estimates on an owned disposable Anvil fork. The browser sends reveal calldata only to the same loopback origin. The server validates the reviewed reveal envelope and block hash, permits only read-only upstream state queries, and returns only the gas quantity. The preimage and raw reveal calldata stay out of journal entries and logs. A lost unrevealed preimage blocks reveal. A new plan can prepare another commitment only after the prior mined commitment is reconciled and expires.

Run the integrated fork using the reviewed historical candidate snapshot:

```sh
node contracts/scripts/deployment_candidate/simulate.mjs --candidate-workflow
```

This starts an ephemeral loopback Anvil fork and enforces a read-only upstream. The harness alone sends transactions to the owned local fork. Its results are written under `docs/prep/evidence/deployment-candidate/workflow-recovery/`. The node uses in-memory history for ancestor receipt rechecks and stops after the run. Anvil models confirmations and finality locally.

## Sequential owner review

1. Select the first included step without a verified receipt. Choose **Prepare unsigned review** and inspect the sender, destination or predicted CREATE address, arguments, nonce, gas and `reservedWei` (maximum network fee).
2. Check the per-step confirmation box and select **Revalidate … confirmation**. The dashboard returns the step, plan digest, and packet digest after repeating receipt, identity, state, nonce, estimate, and fee checks. With the default build this is a read-only action.
3. After a separate Stage 3F GO decision and an explicitly enabled build, the local operator can provide one exact authorization in `step-authorization.json` beside `serve.mjs`. This local file is excluded from Git; an absent file or `null` grants no authorization. The authorized record has `stage: "GO"`, `step`, `planDigest`, and `packetDigest` from that exact approved review. The loopback server reads the file per request. Revalidate from the same tab to pick up the authorization without reloading. This allows the T03 preimage to stay in memory while authorization is reviewed. T04 remains blocked for wallet execution. The existing static T01 authorization remains supported and defaults to null.
4. When the exact authorization matches, confirm the displayed envelope again and click **Request … in MetaMask**. The runner checks the approval again, revalidates the envelope and all preceding included receipts, and saves a durable attempt under an exclusive browser lock. Compare the exact envelope in MetaMask before approving the single transaction. A changed envelope requires a new review and authorization.
5. Use **Verify against session review** to check the transaction, canonical receipt, exact events, confirmations, finalized coverage, and current postconditions. Deployment steps additionally verify the expected deployed address and runtime. Advance only after **CONFIRMED**. Pending transactions can be checked again. Rejection, uncertainty, replacement, or revert requires manual reconciliation and leaves the attempt locked.

Use the same browser profile and loopback origin for recovery. A recorded hash is offered after reload. If MetaMask returned no hash, inspect the wallet's transaction history and enter the exact hash for verification. Keep the same tab open across T03 and T04. Reload or wallet-context changes discard the unrevealed preimage. Browser storage and Web Locks coordinate one origin and profile.

## T02 preparation with reviewed gas and fees

Select T02 and explicitly check **Prepare with these reviewed gas and fee fields** to retain gas limit 155240, maximum fee 35 wei/gas and priority fee 1 wei/gas. The existing server authorization must match the complete resulting packet and current plan. This option cannot create or replace an authorization. An insufficient cap, different estimate, changed quote or other packet difference blocks preparation or revalidation.

For exact-authorized T02, revalidation and the separate Request action simulate the exact reviewed envelope against fresh identified chain state. The original review and recovery anchor remain bound to the packet. The original block must remain canonical, and the fresh observation must pass the two-block / 120-second check after wallet and nonce reads immediately before handoff. Current base fee plus priority fee must fit the retained cap. A reload reconstructs retained gas and fees from the saved anchor. Other steps retain their authorization behavior, and T04 remains blocked.

## T01 intent approval

1. Obtain independent acceptance of the intent authorization code and a separate T01-only GO decision. In the disabled dashboard, prepare T01 and select **Revalidate T01 confirmation**. Review the fixed transaction fields, nonce and fee policy. Have the owner approve the displayed `intentDigest` and its fee ceilings. The earlier exact-packet approval does not authorize this new record or its ceilings.
2. After separate activation authorization, serve the reviewed build and configure one record in `step-authorization.json` with `stage: "GO"`, `step: "T01"`, `kind: "T01_INTENT_V1"`, and the approved `intentDigest`. The legacy exact-packet authorization remains supported. Keep its static export null when using the intent record.
3. In the approved wallet profile, prepare T01 again to display its latest unsigned envelope. Check the confirmation box and select **Revalidate T01 confirmation**. The dashboard checks live RPC state before offering the request. If two blocks or 120 seconds pass, or the estimate or fee changes, prepare and revalidate again. A matching intent digest needs no new durable approval, but every refreshed envelope still needs the owner's explicit dashboard confirmation.
4. Click **Request T01 in MetaMask** only after reviewing the refreshed envelope. The runner repeats revalidation and locks the attempt before calling the wallet. Compare the exact envelope in MetaMask and approve it there. Reconcile the receipt with 12 confirmations and finalized coverage, then stop after T01.

The intent digest excludes block identifiers, observation timestamps, informational latest headers, and the RPC-derived gas limit and maximum fee. It binds the rest of the candidate bundle and packet, including chain, signer, recipient, destination, calldata, nonce, ETH value, priority fee, contract identities, and the approved fee and gas policy. Changes outside the observation fields require a new intent approval. The wallet request, journal and receipt checks still bind the exact refreshed packet, including its gas limit and fees.

## T01 hashless rejection recovery

Use this procedure only after owner acceptance of the recovery implementation and separate authorization to perform live recovery. Recovery itself makes read-only wallet/RPC calls. It requires the existing durable T01 authorization and Web Locks. The original attempt must be explicitly `REJECTED`, have no hash property, and match the saved journal and reconstructed historical transaction. `REQUESTING`, `UNCERTAIN`, hashed attempts, conflicting nonce evidence and unavailable historical state block this path.

1. Keep the original wallet profile and loopback origin. Check Sepolia wallet Activity and all available transaction evidence. If any hash or pending transaction is known, use receipt reconciliation or stop for manual investigation.
2. In **T01 rejected request recovery**, check both wallet-inspection attestations, then choose **Inspect T01 recovery evidence**. Inspect the original rejection and journal snapshot, current owner/chain, canonical block, latest/pending nonce, token balance, mint deficit, quote and recovery digest. The checks rerun T01 contract identity and state prerequisites, gas simulation, funding and policy validation.
3. Read the evidence limitations. Existing `REJECTED` means the prior runner received wallet error 4001. That code was not separately persisted, so the recovery record preserves the status without fabricating historical evidence. Unchanged nonces, token balance and Activity cannot prove absence from all transaction pools. Missing or inconsistent evidence blocks approval.
4. Check the dedicated recovery approval checkbox and choose **Approve T01 recovery**. This trusted click repeats fresh state, authorization, nonce, canonicality and freshness checks under the shared owner lock. The inspected digest stays bound to the evidence the owner reviewed even as blocks advance. Approval verifies that inspected block remains canonical and requires a fresh evaluation with an identical packet and estimate. The new observation must satisfy the existing two-block / 120-second policy immediately before persistence. No record is written on a failed evidence check.
5. Keep the tab open. Recovery approval permits one linked retry request after a separate transaction review. Use **Prepare unsigned review**, inspect the full new T01 envelope, and perform the ordinary confirmation and revalidation flow. The recovery action does not request MetaMask. Any Request click and wallet approval require their existing separate owner actions.

The original attempt key remains byte-for-byte intact. An append-only recovery record at the original key plus `:recovery` contains the original attempt, complete available journal snapshot, evidence and recovery digest. The new attempt at the original key plus `:retry` has its own ID, parent attempt digest and recovery digest. The normal journal records approval and retry transitions, and receipt verification follows the linked retry. Only this single retry is supported.

The recovery permission also lives in memory in the approving tab and is bound to the wallet epoch. Reloading, closing the tab, wallet-context changes, another tab, or interruption after durable approval leaves the recovery locked for manual reconciliation. The permission is consumed before writing the retry attempt. Partial writes and ambiguous requests cannot automatically retry. Never delete, edit or reset these keys. A transaction hash discovered after approval and before retry must be entered in Receipt review, which preserves the evidence and blocks the unused permission across tabs. Future recovery from a locked or repeated rejection requires a separately reviewed procedure.

Run the complete workflow suite with the real-browser recovery regression using an installed Playwright module and browser executable.

```sh
NAK_RECOVERY_PLAYWRIGHT=/absolute/path/to/node_modules/playwright \
NAK_RECOVERY_BROWSER_EXECUTABLE=/absolute/path/to/brave-or-chromium \
npm --prefix contracts/scripts/deployment_workflow test
```

The browser test serves an isolated built dashboard on an ephemeral loopback port, injects a mock wallet, uses real trusted clicks and Web Locks, and rejects permission, signing and sending methods. It never opens the owner's profile. Without `NAK_RECOVERY_PLAYWRIGHT`, that browser test is explicitly skipped and the deterministic workflow tests still run.

## Before live activation

- Obtain a fresh reviewed candidate, with current owner/Mira identities, canonical state and runtime checks, funding, quote, nonce prefix and fees.
- Obtain independent acceptance of the integrated runner and the Stage 3F GO decision, then authorize each exact packet separately or use the reviewed T01 intent procedure. The global live flag and legacy T01 authorization are closed in the committed source. A local sequential authorization file may exist on an operator machine; it is ignored, must never be published, and does not authorize other steps.
- Validate the selected MetaMask version and Sepolia RPC setup with the reviewed envelope format, including contract creation.
- Resolve the T04 wallet privacy block before starting a live T03 commitment.
- Verify every real receipt and deployed runtime before using dependent steps or configuring the Stage 3G frontend.

## T04 pre-broadcast privacy

The browser holds the unrevealed preimage in memory. Unsigned review redacts the reveal calldata and the journal stores digests and public receipt evidence. Gas estimation sends the exact calldata to the same loopback server and its disposable Anvil fork. The fork upstream permits selected reads only and rejects requests containing the preimage. The private endpoint returns only gas or a generic error. Recovery may decode mined calldata to verify a receipt. That calldata is public once broadcast, including when the transaction reverts.

**T04 wallet requests are blocked even with matching authorization and the global execution gate enabled.** The current app cannot guarantee what MetaMask sends to its RPC or simulation services before the owner approves. Before removing the block, the owner must verify the exact MetaMask version, RPC and simulation configuration with a disposable fixture and a controlled network trace through prompt, rejection and approval. Establish that reveal bytes reach only approved local components before approval, including through RPC estimates, simulations, transaction previews and telemetry. If that boundary cannot be verified, use a separately reviewed local signing and approved broadcast path that preserves it. Keep T04 review-only until that correction is reviewed.

### Disposable MetaMask trace

MetaMask's transaction controller can start simulation on an unapproved request before processing approval. Its gas handling also depends on the network and simulation settings. Giving the wallet a gas limit therefore does not establish that reveal calldata stays local. This is a source finding, not a measurement of the owner's installed version. [MetaMask transaction controller](https://github.com/MetaMask/core/blob/main/packages/transaction-controller/src/TransactionController.ts)

Run these in separate terminals from the repository root:

```sh
anvil --host 127.0.0.1 --port 18546 --chain-id 31338 --accounts 0 --quiet
node contracts/scripts/deployment_workflow/privacy_probe/server.mjs > /tmp/nak-wallet-probe.jsonl
```

1. In a fresh disposable browser profile, use a disposable MetaMask account generated by the extension. Add chain **31338**, currency **ETH**, with RPC `http://127.0.0.1:18545/rpc`. Fund only that disposable address on the local node with `cast rpc --rpc-url http://127.0.0.1:18546 anvil_setBalance DISPOSABLE_ADDRESS 0x56bc75e2d63100000`.
2. Open `http://127.0.0.1:18545/`, click **Connect disposable wallet**, grant the site access to the disposable account in MetaMask, then click **Open disposable wallet prompt**. The page uses the injected MetaMask `eth_sendTransaction` path with a fixed public marker, zero value, and the disposable chain. Keep the prompt open while checking the trace, then **reject** it. The RPC proxy blocks writes. The page and proxy record no keys, raw payloads, or wallet error details.
3. Record MetaMask version, chain and simulation settings, prompt/rejection times, and the marker-bearing RPC methods. Also inspect extension/background and browser egress with a controlled network trace in the disposable profile. The loopback log sees only traffic routed through this RPC, and its literal marker check misses transformed payloads. A clean local log cannot rule out separate remote simulation, telemetry, or Sepolia-specific behavior.

The local smoke trace used a direct fixture client against disposable Anvil. It observed marker-bearing `eth_estimateGas` and `eth_call` forwarded to the local node and `eth_sendRawTransaction` blocked. The real MetaMask prompt and selected RPC configuration were not exercised. Before a live T03 commitment, validate the intended wallet, RPC, simulation settings, and egress with disposable data. If that setup discloses reveal bytes or the boundary remains unverifiable, a separately reviewed signing and broadcast path must preserve the approved owner account without exporting keys. The deployment runner retains its T04 hard block.
