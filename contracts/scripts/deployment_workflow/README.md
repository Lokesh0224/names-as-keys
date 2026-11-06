# Unsigned deployment review

Stage 3F remains NO-GO. The main page uses existing MetaMask account access through a read-only adapter. Select the approved owner on Sepolia (11155111). The page has no permission, signature or transaction actions. It clears the displayed review on account, chain or connection changes.

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
