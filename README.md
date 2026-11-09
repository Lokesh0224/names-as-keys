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

| Component | Implemented | Deployment / remaining work |
| --- | --- | --- |
| ENSv2 hierarchy | Root → Lock → Guest fork fixtures and validation | Deployed; see [Sepolia progress](#verified-sepolia-progress) |
| CredentialRegistrar | Owner-only issuance/revocation, expiry and generation checks; fork tests | Deployed; see [Sepolia progress](#verified-sepolia-progress) |
| DoorKeys | Onchain credential validation, door identity and unlock events; fork tests | Deployed; physical actuator integration pending |
| Owner dashboard | Issuance/revocation UI, credential status, explicit wallet confirmation in the live adapter | End-to-end use against deployed project contracts |
| Guest QR flow | Static door URL design, wallet unlock UI, chain/contract validation | Frontend deployment configuration and stable public guest URL for the final QR |
| Kiosk | Confirmed `DoorUnlocked` monitoring, event feedback, eight-second display relock | Physical lock control; the relock is a presentation simulation |
| Deployment workflow | Guarded browser runner and terminal toolkit, prerequisites, attempt records and receipt verification | Terminal T01–T14 complete; browser T04 clearance pending; T15 deliberately unexecuted |

The frontend contains an isolated **SIMULATED** rehearsal and a real Sepolia adapter. The rehearsal is useful for UI review; it is not proof of a live deployment. Live actions stay unavailable without validated deployment addresses, receipt, runtime hashes, and hierarchy configuration. The live kiosk requires two canonical event confirmations; deployment tooling has separate confirmation policies.

The implementation currently targets one configured door and guest label. It is a prototype, not a production physical security system.

## Verified Sepolia progress

The root/lock hierarchy and both application contracts are deployed on Sepolia. The recorded `proofrun` lifecycle used real issue, unlock and revoke transactions; the post-revoke denial was a read-only call. Deployment used the terminal toolkit in [`contracts/scripts/live`](contracts/scripts/live).

The [deployment journal](contracts/deployments/sepolia.live.json) records T01–T14 as `VERIFIED`. The [proof-run record](contracts/deployments/live-proof.md) specifies three required confirmations. Deployment entries do not retain their per-step confirmation count; these statements reconcile local artifacts, not a fresh RPC audit.

| Item | Address |
| --- | --- |
| Owner (testnet-only) | `0xF763081Ed25050C5080780d3b203314aaf636462` |
| Guest (testnet-only) | `0xbdf9302F7Fdf36E24D282e2664623E01a150D0f6` |
| Root name | `nak-lokesh-20261105.eth` |
| R1 (root registry) | `0xB938622E835762c3fe70147678f57FC96B858611` |
| R2 (lock registry) | `0xB19b8a4B8cb1E612D0964cC46F37589705E06fA9` |
| CredentialRegistrar | `0x0437Aa8542EbaE75DE30F029A7fdd79D1245700A` |
| DoorKeys | `0x8f30cff82BD7c12fDb13329A5BdE5c79906Ee57c` |

### Deployment (T01–T14)

| Step | Action | Transaction |
| --- | --- | --- |
| T01 | Mint MockUSDC | [0x5811…01a1](https://sepolia.etherscan.io/tx/0x581127e6418b5b8310caafdd3bbd644fa225f621f0dc4bf79f3fd5d55ca101a1) |
| T02 | Approve ETHRegistrar | [0x1f0d…5a50](https://sepolia.etherscan.io/tx/0x1f0d97a5165b736b42445c1662ab71d4ecad7216f9b1eacb9298891c28b55a50) |
| T03 | Commit root registration | [0x0382…a060](https://sepolia.etherscan.io/tx/0x03824890406cc465edacd8ae0a2d5c3ba07b25a480f8b857f8daf5dfb4c3a060) |
| T04 | Reveal and register root | [0xb309…ab9](https://sepolia.etherscan.io/tx/0xb3099754911adc2adf8eb4b55364edf2e65eb2b15aa562a60c32ca1d4ff9aab9) |
| T05 | Deploy R1 | [0xa822…9e49](https://sepolia.etherscan.io/tx/0xa822a6e17e9695035bb5020b60f252ff0ff4feac68cba51e494ba3c0bd699e49) |
| T06 | Attach R1 to root | [0x9782…8c56](https://sepolia.etherscan.io/tx/0x9782a1f93e3e51f099431a660e9bfda3ed1f6f3dc2aac4ca21e9c6d8bf938c56) |
| T07 | R1 parent metadata | [0x315b…ce92](https://sepolia.etherscan.io/tx/0x315bd793e08c3d3c9c2f1a1a5c381374a6bde59e088643909fcb60b65ed9ce92) |
| T08 | Register `lock` | [0x305f…f1e5](https://sepolia.etherscan.io/tx/0x305fb0815a183ddc1889083273eb8e58817e9be8a53b1786fe1911f991f7f1e5) |
| T09 | Deploy R2 | [0x36dc…a040](https://sepolia.etherscan.io/tx/0x36dc7ee9d711e1089ea30901975d7e43933534abb6c35633522789563e4fa040) |
| T10 | Attach R2 under `lock` | [0x2b32…230f](https://sepolia.etherscan.io/tx/0x2b32cf5c44399ee84fb9e0dc2a8a7ded91b0a98fb6b76d32198747f25310230f) |
| T11 | R2 parent metadata | [0x4168…d9e3](https://sepolia.etherscan.io/tx/0x416895c1996dd46cf8f88ce72bc4eba6a5b0c51cdd1ac27c6fb287c91bd4d9e3) |
| T12 | Deploy CredentialRegistrar | [0xb463…a17c](https://sepolia.etherscan.io/tx/0xb4637132fc53a10f8157a012f4aef9ecf28483f1f0328269fa1306a66150a17c) |
| T13 | Grant registrar issuer role on R2 | [0xa7ff…06c6](https://sepolia.etherscan.io/tx/0xa7ff9e28223e410dd5c7768c5580dd321626df170cd2e08463f00bec742906c6) |
| T14 | Deploy DoorKeys | [0x376d…6806](https://sepolia.etherscan.io/tx/0x376d777cc9336686efc6d4b8f5e3d490951f416e1349ca903b790511dcc36806) |

T15 (issuing `mira`) was deliberately not run, so that label stays pristine for the frontend demo. The lock expires 2027-02-07 and the root 2027-11-09; credentials cannot outlive the lock.

### Proof run (`proofrun` label)

| Step | Result | Transaction |
| --- | --- | --- |
| Issue to guest (1 hour) | Success | [0xcbeb…5e15](https://sepolia.etherscan.io/tx/0xcbeb66018a1ac37b75445d1429dbd3ca14e37e1c37965766ad5f917eede75e15) |
| Guest `unlock` | Success; toolkit checks exactly one `DoorUnlocked` | [0x4fed…88c9](https://sepolia.etherscan.io/tx/0x4fed19223ce3e49780a007b454e00fd3d0d941efbb30bb310857e6baa7b588c9) |
| Owner `revoke` | Success | [0x112f…0076](https://sepolia.etherscan.io/tx/0x112f95a639bb4999cc356e2487b1836ed8bef2e859a05252332299f6b6f70076) |
| Unlock after revoke | Reverts with `InvalidCredential()` | simulated call, no mined transaction |

The post-revoke denial was verified by a simulated call returning `InvalidCredential()`, not by a mined failing transaction.

### Live-chain notes

- **Creation gas preparation differs from the fork.** Saved T12/T14 attempts have gas limits of **16,141,235 / 9,923,938**. Under the toolkit's 110% CREATE padding, these correspond to estimates of **14,673,850 / 9,021,761**. They are preparation estimates, not recorded receipt `gasUsed`. The pinned-fork tests measured roughly 2.17M / 1.39M with Foundry 1.3.5; those results do not predict current live gas costs. CREATE limits are capped at 16,777,216 and require at least 5% headroom; ordinary steps retain their separate limits.
- **T04 used the terminal path, not a browser wallet.** The guarded dashboard's T04 hard block still applies; this deployment did not validate MetaMask's confidentiality boundary. The terminal path sends reveal calldata through the configured RPC provider, so its use is not proof of RPC confidentiality. The toolkit stores its registration secret in a mode-0600 file and deletes it after T04 verifies; the local secret file is absent.

## Technology

- Solidity **0.8.25**, Foundry, vendored Forge Standard Library, and ENSv2 interfaces.
- Cancun EVM target, optimizer enabled with **200 runs**, `via_ir = false`; see [Foundry configuration](contracts/foundry.toml).
- Vanilla JavaScript ES modules, HTML/CSS, and Node.js **22** HTTP servers.
- **ethers 6.17.0**, **qrcode 1.5.3**, and **esbuild 0.28.2** for the deployment dashboard.
- MetaMask for live frontend actions; local terminal signers for the recorded deployment and proof run.

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

- **Browser T04 remains hard-blocked:** the terminal deployment did not establish MetaMask's privacy boundary. Resolve browser-wallet pre-broadcast confidentiality before a future browser T03 commitment; a GO record alone cannot bypass that block. The terminal RPC exposure is described above.
- Never publish RPC credentials, wallet/browser storage, active GO records, unrevealed registration secrets, or raw confidential traces. Public addresses and transaction receipts do not make every deployment artifact safe to publish.
- Approved inputs already include public owner/guest addresses, an intended root label, predicted addresses, and explicitly public deterministic proxy salts. Those salts are not the registration preimage. Publishing history discloses these operational intentions; it does not authorize execution.
- ENSv2 registry administrators remain trusted. Hierarchy detachment, expiry, generation changes, revocation, and invalid identity must fail closed. A successful event is not evidence of physical door actuation.
- The deployment runner enforces nonce, identity, fee/gas limits, canonical freshness, attempt locking, and receipt checks. Browser profiles and origins are part of its recovery boundary; do not delete or edit journals to retry a transaction.
- Wallet software may present or edit gas settings independently. Inspect the wallet envelope before confirming; application handoff alone does not guarantee the final signed envelope.
- Historical evidence includes third-party public test vectors and bundled RPC defaults from Forge Standard Library. They are not project wallet credentials and must never be used for funded accounts.
- No independent production security audit or mainnet readiness is claimed. RPC availability, historical-state support, browser Web Locks, and a correctly configured wallet remain operational dependencies.

## Next steps

1. Configure the real frontend against the confirmed deployments. Keep `mira` pristine until the frontend issuance run.
2. Confirm the public guest URL, validate the owner/guest/kiosk lifecycle, and generate the final static QR.
3. Integrate a separately secured physical actuator.
4. Design replacement/renewal UX and broader multi-door support without weakening ENSv2 checks.

## Repository map

- [Contracts and interfaces](contracts/src) / [contract tests](contracts/test)
- [Frontend and runbook](frontend)
- [Guarded deployment runner and operator runbook](contracts/scripts/deployment_workflow) / [terminal toolkit](contracts/scripts/live)
- [Recorded live deployment](contracts/deployments/sepolia.live.json) / [proof-run receipts](contracts/deployments/live-proof.md)
- [Deployment manifest](docs/prep/stage3e/deployment-manifest.json) / [ABI inventory](docs/prep/stage3e/abis)
- [Approved candidate inputs](docs/prep/deployment-candidate/APPROVED_INPUTS.json)
