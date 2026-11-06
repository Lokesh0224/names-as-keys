# Local deployment review (execution disabled)

Stage3F is NO-GO. Production submission is locked in code; there is no browser enable switch. No wallet permission/signature is requested on page load. Do not use test-only addresses, public test preimages, salts or receipts as deployment inputs.

From the repository root, with the pinned local ethers6.17.0/esbuild0.28.2 dependencies available:

```sh
node contracts/scripts/deployment_workflow/test/workflow.test.mjs
node contracts/scripts/deployment_workflow/build.mjs
python3 -m http.server 8769 --bind 127.0.0.1 --directory /tmp/nak-local-deployment-review
```

Open `http://127.0.0.1:8769/` locally. The UI displays all15 unresolved review packets and an isolated in-memory lifecycle demonstration. The inspect-wallet button reads only accounts already exposed by the provider and chain ID; it never requests permissions or switches chains. There is no send/sign control for a real wallet. Stop the temporary server after review. Build outputs are outside the repository and are not committed.

`npm test` and `npm run build` also work from this directory. package-lock.json pins dependencies for separately authorized reproduction; dependency installation is not part of running the workflow. The browser demo journal is intentionally test memory. `BrowserJournal` is the public localStorage adapter for a future resolved/approved workflow; it is not initialized for deployment by the UI.

Pinned ordered test-only fork simulation (read-only RPC; disposable in-memory changes):

```sh
forge test --root contracts --fork-url https://sepolia.gateway.tenderly.co \
  --fork-block-number 12071963 --match-contract OrderedDeploymentWorkflowTest -vv
```

This executes15 local EVM actions using a synthetic root and test wallets, not real externally submitted transactions. It is **not** the final approved-input deployment simulation. No `forge script --broadcast`, private key, mnemonic or wallet import is used.

Implementation/security decisions, proposals, test evidence and remaining blockers: `docs/prep/workflow/IMPLEMENTATION_REPORT.md` and `PROPOSED_DEFAULTS.json`. The earlier Stage3F audit is preserved unchanged.
