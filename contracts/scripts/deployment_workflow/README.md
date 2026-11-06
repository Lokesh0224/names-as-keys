# Unsigned deployment review

Stage 3F remains NO-GO. The main page uses existing MetaMask account access through a read-only adapter. Select the approved owner on Sepolia (11155111). The default page uses read-only wallet requests. It clears the displayed review on account, chain or connection changes.

From the repository root:

```sh
npm --prefix contracts/scripts/deployment_workflow test
node contracts/scripts/deployment_workflow/build.mjs
node contracts/scripts/deployment_workflow/serve.mjs
```

Open `http://127.0.0.1:8769/` for the candidate. The build loads the recorded fresh-preflight candidate and approved limits. At review time, the app checks the current owner, network, applicable state, nonce and fee envelope. If the reviewed quote, prefix or other binding has changed, refresh the candidate. The synthetic lifecycle is a separate page at `http://127.0.0.1:8769/demo.html`.

Choose a step and prepare its unsigned review. After a reload, the workflow rebuilds public drafts from the original canonical review block and prepares a fresh review. Receipt recovery checks the reconstructed packet against its journal digests and verifies the mined envelope, events, canonicality, confirmations, finalized coverage and current state. Enter the transaction hash if the journal has not recorded it yet. Recovery requires a provider that can serve the original historical state.

The loopback server handles T04 estimates on an owned disposable Anvil fork. The browser sends reveal calldata only to the same loopback origin. The server validates the reviewed reveal envelope and block hash, permits only read-only upstream state queries, and returns only the gas quantity. The preimage and raw reveal calldata stay out of journal entries and logs. A lost unrevealed preimage blocks reveal. A new plan can prepare another commitment only after the prior mined commitment is reconciled and expires.

Run the integrated fork using the reviewed historical candidate snapshot:

```sh
node contracts/scripts/deployment_candidate/simulate.mjs --candidate-workflow
```

This starts an ephemeral loopback Anvil fork and enforces a read-only upstream. The harness alone sends transactions to the owned local fork. Its results are written under `docs/prep/evidence/deployment-candidate/workflow-recovery/`. The node uses in-memory history for ancestor receipt rechecks and stops after the run. Anvil models confirmations and finality locally.

## T01 owner handoff

On the candidate page, prepare T01, read the recipient, destination, mint amount and `reservedWei` (maximum network fee), then check the T01 confirmation box and select **Revalidate T01 confirmation**. This repeats the read-only checks and binds the exact displayed review and packet digests. Confirmation is local to the current review and execution stays disabled. A changed envelope or expired review requires a new confirmation.

The default build has two closed gates. A separately reviewed owner-approved change must explicitly set `LIVE_EXECUTION_ALLOWED=true` and replace the null export in `t01_authorization.mjs` with `{ stage: 'GO', step: 'T01', planDigest, packetDigest }` for the exact bundle and packet the owner approved. Copy the digests from the existing T01 confirmation result, then rebuild and serve the same candidate. The authorization binds the packet, so an unchanged packet can be reviewed at a new fresh block. Any changed packet digest requires separate owner authorization.

With both gates satisfied, prepare T01 again, confirm the displayed fields and select **Request T01 in MetaMask**. The handler repeats exact validation, acquires an exclusive Web Lock, and durably records the owner and chain's single T01 attempt before sending the frozen envelope through its private MetaMask transport. The transport accepts only a one-use grant created after revalidation, checks the configured bundle and packet digests again, and reads back the exact lock and journal entry before requesting the wallet. The exported read-only adapter and generic workflow expose no live send route. A browser without Web Locks or writable local storage blocks the request. T02–T15 have no submission control. The owner must compare and approve the envelope in MetaMask.

Use **Verify against session review** to reconcile the returned hash, exact envelope and Transfer, resulting balance, confirmations and finalized canonical coverage. A different hash or a consumed nonce without the tracked receipt requires manual replacement investigation. Rejection, an uncertain request, and a failed receipt leave the attempt locked. The interface has no automatic retry or lock reset. Retain the same browser profile and origin so its local lock and journal survive reloads.
