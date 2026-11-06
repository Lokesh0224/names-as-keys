# Names as Keys

ENSv2-powered decentralized access control using hierarchical ENS names as temporary, revocable digital keys for physical doors.

Names as Keys explores whether a door can check a wallet's current ENSv2 credential instead of maintaining a separate guest authorization list. Physical access systems commonly depend on centralized account databases, shared codes, or credentials that are difficult to expire and revoke. This project makes the current onchain name owner, expiry, registry generation, and hierarchy authoritative.

## How it works

```text
Root: <root>.eth                 Owner-controlled ENSv2 registration
  └── Lock: lock.<root>.eth      Door registry and identity
        └── Guest: mira.lock.<root>.eth
                                Temporary credential owned by the guest wallet
```

The hierarchy uses two ENSv2 user registries: R1 under the root and R2 under `lock`. The contracts validate attachment, ownership, expiry, and current token generations rather than trusting a label alone.

- **CredentialRegistrar** lets the configured owner issue a pristine guest label with an absolute expiry and revoke the expected current token generation. Issuance is bounded by the lock expiry and a 60-second to 30-day credential window. Guests receive no registry administration roles.
- **DoorKeys** implements `unlock(label)`. It checks the caller against the current, active ENSv2 credential and validates the door's hierarchy before emitting `DoorUnlocked`. It has no local guest authorization list.
- **Expiry and replacement:** expired credentials fail validation. Revocation removes the credential through ENSv2. Trusted registry administrators can replace a credential by unregistering and registering a new generation; tests cover generation changes. The application registrar deliberately rejects reused labels and has no `replace` or renewal API. A guided replacement experience remains future work.

See the [contract sources](contracts/src), [hierarchy fixture](contracts/test/stage3/ThreeLevelENSv2.t.sol), and [deployment sequence](docs/prep/stage3e/DEPLOYMENT_SEQUENCE.md).

## Interfaces and implementation status

| Component | Implemented | Still pending |
| --- | --- | --- |
| ENSv2 hierarchy | Root → Lock → Guest fork fixtures and validation | Project hierarchy registration on Sepolia |
| CredentialRegistrar | Owner-only issuance/revocation, expiry and generation checks; fork tests | Sepolia deployment |
| DoorKeys | Onchain credential validation, door identity and unlock events; fork tests | Sepolia deployment and physical actuator integration |
| Owner dashboard | Issuance/revocation UI, credential status, explicit wallet confirmation in the live adapter | End-to-end use against deployed project contracts |
| Guest QR flow | Static door URL design, wallet unlock UI, chain/contract validation | Final deployment addresses and stable public guest URL for the final QR |
| Kiosk | Confirmed `DoorUnlocked` monitoring, event feedback, eight-second display relock | Physical lock control; the relock is a presentation simulation |
| Deployment workflow | Guarded sequential runner, exact packet review, prerequisites, attempt journal and receipt verification | T03–T15; T04 confidentiality clearance |

The frontend contains an isolated **SIMULATED** rehearsal and a real Sepolia adapter. The rehearsal is useful for UI review; it is not proof of a live deployment. Live actions stay unavailable without validated deployment addresses, receipt, runtime hashes, and hierarchy configuration. The live kiosk requires two canonical event confirmations; deployment receipts have a separate, stricter policy.

The implementation currently targets one configured door and guest label. It is a prototype, not a production physical security system.

## Verified Sepolia progress

Checked against Sepolia RPC on **2026-11-07**: both receipts have status `1`, their blocks are canonical, and both are covered by the finalized head.

| Step | Result | Transaction |
| --- | --- | --- |
| T01 | CONFIRMED — mint 8,000,021 MockUSDC base units (8.000021 tokens); block 12,076,275 | [Sepolia receipt](https://sepolia.etherscan.io/tx/0xa165ec5b2657632ffb3cf81e030b7e4dcf9e6fbf902300d58e5fd6c6071eeb7f) |
| T02 | CONFIRMED — approve 8,000,021 base units to ETHRegistrar; block 12,079,423 | [Sepolia receipt](https://sepolia.etherscan.io/tx/0xc4c06ecb5b793673448e6f18ebafab21db8eb3b636a9bccd861fc784d4db5c33) |
| T03–T15 | Not executed | T04 remains hard-blocked pending confidentiality review |

Owner: `0x40F6DcB0Fa311570f72aC6F64045EB80E66711F7`

MockUSDC: `0x240b0316df57887dbbe58b586508b19e633a14aa`

Approved ETHRegistrar spender: `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3`

**The project ENS hierarchy, CredentialRegistrar, and DoorKeys are not deployed to Sepolia.** Existing deployment manifests, predicted addresses, and historical preflight reports are preparation artifacts, not deployment evidence. Historical reports retain their original snapshot status; they must not be used as current execution authority.

## Technology

- Solidity **0.8.25**, Foundry, vendored Forge Standard Library, and ENSv2 interfaces.
- Cancun EVM target, optimizer enabled with **200 runs**, `via_ir = false`; see [Foundry configuration](contracts/foundry.toml).
- Vanilla JavaScript ES modules, HTML/CSS, and Node.js **22** HTTP servers.
- **ethers 6.17.0**, **qrcode 1.5.3**, and **esbuild 0.28.2** for the deployment dashboard.
- MetaMask for explicitly confirmed live wallet operations. No application custody of wallet keys.

## Install and test

Use Node.js 22, npm, and Foundry. Run commands from the repository root. The dependency lockfiles pin the frontend and workflow packages; the Foundry library is included in the repository.

```sh
npm --prefix frontend ci
npm --prefix frontend test

# The candidate tooling resolves ethers from contracts/node_modules.
npm --prefix contracts install --no-save --package-lock=false ethers@6.17.0
forge build --root contracts
npm --prefix contracts/scripts/deployment_workflow ci
npm --prefix contracts/scripts/deployment_workflow test
```

The workflow suite is deterministic and uses isolated fixtures/mock providers, not live wallet requests. Optional real-browser regressions need an installed Playwright module and Chromium-compatible executable; see the [operator runbook](contracts/scripts/deployment_workflow/README.md#t01-hashless-rejection-recovery). Without that configuration, those browser cases are explicitly skipped.

The application contract and hierarchy tests require a **Sepolia fork**, including historical state at block **12,071,220**. They execute on a local test EVM, not on the public network. Set `SEPOLIA_RPC_URL` privately in your shell, then run:

```sh
forge test --root contracts --fork-url sepolia --fork-block-number 12071220 \
  --no-match-contract OrderedDeploymentWorkflowTest

# This separate fixture asserts its own audit-pinned block.
forge test --root contracts --fork-url sepolia --fork-block-number 12071963 \
  --match-contract OrderedDeploymentWorkflowTest
```

The ordered-workflow fixture uses a different pinned block (12,071,963); running every suite at one block will fail its explicit setup assertion. Use an RPC provider that supports historical reads. Never paste credential-bearing RPC URLs into issues, command output, or Git. Build artifacts, dependencies, and environment files are ignored.

### Run the UI rehearsal

```sh
cp frontend/.env.example frontend/.env
npm --prefix frontend start
```

Open [owner dashboard](http://127.0.0.1:8787/owner), [guest page](http://127.0.0.1:8787/guest), and [kiosk](http://127.0.0.1:8787/door). The default `NAK_MODE=demo` uses one disposable, in-memory server session and simulated wallet roles. Issue a credential, follow its generated guest link, unlock, observe the relock, revoke, and verify denial. It makes no real wallet requests. Do not overwrite an existing local `.env` when following this setup.

For the real adapter's server-side configuration and deployment checks, read the [frontend runbook](frontend/README.md). Do not generate the final physical QR until DoorKeys and the stable guest URL are confirmed.

### Build the disabled deployment dashboard

```sh
npm --prefix contracts/scripts/deployment_workflow run build
node contracts/scripts/deployment_workflow/serve.mjs
```

Open [local unsigned review](http://127.0.0.1:8769/). A normal source build has live execution disabled. The build writes to `/tmp/nak-local-deployment-review`; do not run it over an active operator session without following the runbook. An absent local `step-authorization.json` grants no authority. Active authorization records are deliberately excluded from Git.

Building or preparing a review is not permission to transact. Live activation requires the separate owner-controlled procedure, one authorized step at a time, a matching packet or reviewed T01 intent, fresh RPC validation, explicit dashboard action, independent wallet confirmation, and verified receipts before dependent steps.

## Security and limitations

- **T04 is hard-blocked:** a commit-reveal preimage must not reach unreviewed wallet/RPC simulation services before approval. The existing local estimation route does not prove MetaMask's privacy boundary. Resolve that boundary before a live T03 commitment; a GO record alone cannot bypass the block.
- Never publish RPC credentials, wallet/browser storage, active GO records, unrevealed registration secrets, or raw confidential traces. Public addresses and transaction receipts do not make every deployment artifact safe to publish.
- Approved inputs already include public owner/guest addresses, an intended root label, predicted addresses, and explicitly public deterministic proxy salts. Those salts are not the registration preimage. Publishing history discloses these operational intentions; it does not authorize execution.
- ENSv2 registry administrators remain trusted. Hierarchy detachment, expiry, generation changes, revocation, and invalid identity must fail closed. A successful event is not evidence of physical door actuation.
- The deployment runner enforces nonce, identity, fee/gas limits, canonical freshness, attempt locking, and receipt checks. Browser profiles and origins are part of its recovery boundary; do not delete or edit journals to retry a transaction.
- Wallet software may present or edit gas settings independently. Inspect the wallet envelope before confirming; application handoff alone does not guarantee the final signed envelope.
- Historical evidence includes third-party public test vectors and bundled RPC defaults from Forge Standard Library. They are not project wallet credentials and must never be used for funded accounts.
- No independent production security audit or mainnet readiness is claimed. RPC availability, historical-state support, browser Web Locks, and a correctly configured wallet remain operational dependencies.

## Next steps

1. Resolve and independently review T04's pre-broadcast confidentiality boundary.
2. Continue T03–T15 under separate per-step owner approvals and verify actual receipts and deployed runtime hashes.
3. Configure the real frontend against confirmed deployments and validate issuance, unlock, revocation, and expiry end to end.
4. Confirm the public guest URL, generate the final static QR, and integrate a separately secured physical actuator.
5. Design replacement/renewal UX and broader multi-door support without weakening ENSv2 checks.

## Repository map

- [Contracts and interfaces](contracts/src) / [contract tests](contracts/test)
- [Frontend and runbook](frontend)
- [Guarded deployment runner and operator runbook](contracts/scripts/deployment_workflow)
- [Deployment manifest](docs/prep/stage3e/deployment-manifest.json) / [ABI inventory](docs/prep/stage3e/abis)
- [Approved candidate inputs](docs/prep/deployment-candidate/APPROVED_INPUTS.json)

No project-wide license has been selected yet. Preserve the existing third-party notices; the owner should choose a project license before inviting reuse.
