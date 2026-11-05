# Phase 3A — Sepolia hierarchy and deployment plan

Prepared 2026-11-05 (Asia/Kolkata). Status: preparation complete; implementation and all onchain writes remain unauthorized. No deployment, registration, token mint, approval, role grant, wallet signature or remote push occurred. No Claude involvement.

## Git baseline and evidence preservation

The original `.git` directory was inspected and empty: no HEAD, config, refs, objects, index or recoverable metadata. Git was initialized in place. Baseline commit: `381a82da23b9bc4c079c39892315b939fd99d26c` (`chore: establish audited project baseline`). This establishes history from this checkpoint; it cannot establish earlier creation dates or event eligibility.

Reviewed staged status and all 169 staged paths, including vendored Forge Std source and fixtures. Ignore rules cover environment files (except the name-only `.env.example`), private-key/mnemonic/credential material, dependencies, generated outputs and local caches. Staged content was scanned for private-key blocks, credential assignments and authenticated/provider-key URLs without printing values. Two URL-pattern matches in Forge Std were inspected as public default RPC references, not project credentials. No sensitive file was identified as staged. Local environment files were not opened or sourced.

The initial `git diff --cached --check` identified trailing command-line spaces in six retained evidence logs. They were preserved unchanged; `.gitattributes` disables end-of-line whitespace diagnostics only for `docs/prep/evidence/*.log`. The subsequent required check passed. A SHA-256 preservation comparison over 85 pre-existing docs/source/tests/log files found no changes. Historical documents remain historical, including their earlier Git and readiness limitations.

## Verification scope and provenance

Read-only public Sepolia RPC queries used chain ID **11155111**, pinned block **12071220** (`0xb83134`), block hash `0x0da28eda62d82e725492bd61af1eac89a09379b6e407821a69d735cc4457739c`. Query began at **2026-11-05 23:57:23 IST** (18:27:23 UTC). Methods: `eth_chainId`, `eth_blockNumber`, `eth_getCode`, `eth_call`, `eth_getBlockByNumber`, `eth_gasPrice`. No credential-bearing endpoint was used. Initial tip-block calls encountered inconsistent backend block availability; those error responses were not treated as missing bytecode. The complete successful run used a block 32 behind the observed tip.

All 16 manifest entries match the current [official ENS Sepolia deployment table](https://docs.ens.domains/learn/deployments/#sepolia-ensv2) case-insensitively. This verifies address agreement and code presence, not source equivalence or audited safety. Additional contracts appear in that table; this stage verifies the repository's 16 recorded entries, not an exhaustive deployment inventory.

| Contract | Sepolia address | Runtime code bytes at pinned block |
|---|---|---:|
| ETHRegistry | `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` | 16,000 |
| ETHRegistrar | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` | 8,037 |
| RootRegistry | `0xb458d6a3a77919449d03e7a6903c26827c1ec43f` | 16,000 |
| UpgradableUniversalResolverProxy | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` | 2,491 |
| ManagedUniversalResolverProxy | `0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1` | 2,612 |
| UniversalResolverV2 | `0x24e1d8e068620b647ca097f961a61055f4f42d72` | 18,792 |
| VerifiableFactory | `0xda70306c98e97ece36f997a21368e53298572991` | 1,524 |
| UserRegistryImpl | `0x9bd8a88719068d09ecee662f36c0e3856708366a` | 18,982 |
| PermissionedResolverImpl | `0x115eb53f0c60696633855f90b138178fb40b2b2c` | 15,608 |
| PublicResolverV2 | `0xdc4a563d00f5c3012b699794eb9e13a561be386f` | 14,327 |
| StandardRentPriceOracle | `0x8196665d4ca7488b6474a9ec8e7d2719fb42263a` | 8,355 |
| MockUSDC | `0x240b0316df57887dbbe58b586508b19e633a14aa` | 4,309 |
| MockDAI | `0xf6fac8a58a0be13b9197f27c41b73162fe32572b` | 4,309 |
| LabelStore | `0xed8246ff02203a4d4cb262bd78beaa7408a57cae` | 1,930 |
| WrapperRegistryImpl | `0xbe768b63e5fbbfbb0ae97e9064e0002df8001880` | 24,118 |
| BatchRegistrar | `0x4a4c8b7cdab6b19dc2cdb417cdb53a2ccbaf5322` | 2,196 |

`RootRegistry.getSubregistry("eth")` returned the recorded ETHRegistry. Universal Resolver proxy `isENSv2()` returned true. These are existing ENS deployments; the project does not deploy or own them.

Inspected `contracts/foundry.toml`: Solidity 0.8.25, Cancun EVM, optimizer 200, read permission for deployments; `sepolia` resolves an environment variable. This is RPC configuration, not MetaMask signing integration.

Vendored interfaces are from `f2f0a05e6c1711134b73204a1e37f8e6c1aea6ab`; the official deployment links now point to `07e55a056f5b6a9c90119f501bdd05714e67dddd`. Nonempty code and working getters do not resolve the outstanding full source/ABI/implementation comparison. The manifest's October 1 deployment-date note is historical and was not independently verified here.

Inspected the spike registrar, three spike test files, scripts and Phase 2 closure/audit/evidence records. Retained consolidated fork result is 17/17; A3-LITE is five scoped passing cells. These remain local-fork evidence. The scripts run fork tests, local Anvil seeding and resolution probes; there is no production hierarchy deployment script. The old contracts README's generic private-key example and the Anvil script's unlocked/impersonated signer are unsuitable for the owner's MetaMask deployment.

## Root-name findings and explicit hierarchy proposal

Results below apply to Sepolia ENSv2 only. Mainnet and legacy Sepolia name ownership confer no assumed permissions here.

| Query | `lokesh` | `nak-lokesh-20261105` |
|---|---|---|
| ETHRegistrar `isAvailable(string)` | false | true |
| ETHRegistry `getState(labelhash).status` | 1 / RESERVED | 0 / AVAILABLE |
| State expiry | 1934743932 (2031-04-24 02:22:12 IST) | 0 |
| `latestOwner`, `getOwner(labelhash)` | zero address | zero address |
| `getSubregistry(label)` | zero address | zero address |
| One-year register-price query | reverts `NameNotAvailable` (`0x477707e8`) | succeeds with both mock tokens |

`lokesh.eth` is reserved, not an available ordinary registration and not a current nonzero-owner token. No evidence establishes owner control or a reservation allocation right. No wallet address was supplied, and the owner's confirmed lack of an existing name supplies no onchain role. Do not attempt to register it, bypass the reservation or infer a release date from its expiry. A special reservation route would require separate evidence and authorization.

Requested hierarchy remains recorded as:

`lokesh.eth` → `lock.lokesh.eth` → `mira.lock.lokesh.eth`

Proposed alternative, requiring owner acceptance before any registration:

`nak-lokesh-20261105.eth` → `lock.nak-lokesh-20261105.eth` → `mira.lock.nak-lokesh-20261105.eth`

Only the root label changes. The root represents the owner, `lock` the door, and `mira` the guest credential. The alternate root was registerable at the pinned block; it is not reserved for this project and must be rechecked immediately before commitment and reveal. If unavailable then, propose and recheck a fresh project-specific label rather than silently substituting. No usable root is currently owned by the project.

For duration **31,536,000 seconds**, the alternate label's quoted base/premium were **8,000,021 / 0 MockUSDC units** (6 decimals, 8.000021 tokens), or **8,000,020,944,000,000,000 / 0 MockDAI units** (18 decimals, 8.000020944 tokens). Quotes are block-specific, not a fixed budget. Live getters returned minimum duration **2,419,200 seconds (28 days)**, minimum commitment age **60 seconds**, maximum **86,400 seconds**. Use actual chain timestamps: reveal after the minimum, strictly before the maximum.

The [deployment-linked ETHRegistrar source](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/registrar/ETHRegistrar.sol) describes commit/reveal and ERC-20 payment. The [linked mock-token source](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/test/mocks/MockERC20.sol) exposes an unrestricted `mint(address,uint256)`. Minting is a future transaction; source linkage is not a live mint-success claim. Sepolia ETH is required for gas even though rent uses a mock token.

## Proposed contracts, ownership and attachments

Use two UserRegistry proxies deployed atomically initialized through the existing VerifiableFactory, plus a new owner-restricted CredentialRegistrar and a DoorKeys contract. Do not deploy the throwaway SpikeRegistrar as production: its mutating `register`/`unregister` entrypoints lack caller authorization.

1. The selected MetaMask owner EOA owns the root-name token in ETHRegistry. Deploy a root child registry **R1** with that EOA as explicit root-role administrator. Attach with `ETHRegistry.setSubregistry(rootTokenId, R1)`. Set canonical reverse parent metadata with `R1.setParent(ETHRegistry, rootLabel)`; this alone does not create the forward attachment.
2. Deploy door credential registry **R2**, initialized to the same owner EOA. In R1, register `lock` owned by the owner EOA, with R2 as its subregistry and an expiry no later than the root. Set `R2.setParent(R1, "lock")`. The resulting forward path is ENS RootRegistry → ETHRegistry → R1 → R2.
3. CredentialRegistrar targets R2 and binds the root/door path, expected owner and registration generations. Only the authorized owner may issue/revoke credentials, and issuance must validate the active parent path. Give the registrar only `ROLE_REGISTRAR | ROLE_UNREGISTER` on R2's `ROOT_RESOURCE()` (bitmap 4097), with no role-admin bits. Role grants alone do not secure an unrestricted registrar entrypoint.
4. Owner initialization grants must explicitly include required registrar/unregister, attachment, parent-metadata and role-admin permissions; avoid copying the spike's broad upgrade-capable bitmap blindly. Owner retains the relevant admin bits for recovery/revocation. Confirm exact initializer and `hasRoles` results against deployed code before sending transactions. No ownership or root roles in the global ENS registries are required.
5. The root token needs `ROLE_SET_SUBREGISTRY`; R1 owner needs `ROLE_REGISTRAR` to create `lock`; the `lock` token needs attachment permission for future R2 replacement. `setParent` requires `ROLE_SET_PARENT` on the affected registry. Owner role administrators must be able to grant/revoke the R2 registrar roles. Query token resource IDs via registry getters; do not conflate ERC-1155 token IDs, labelhashes and EAC resources.

Factory proxy initialization must name the EOA as administrator, never rely on `msg.sender` being the owner. Verify factory prediction/deployed address and implementation. Resolver address records are optional for authorization: ownership comes from registry token state, not the resolver's guest address record. Resolver provisioning, if later needed for the resolution demo, adds separately reviewed writes and permissions.

## Credential lifecycle and DoorKeys authorization

Creation: owner calls CredentialRegistrar to register `mira` in R2 with guest wallet as token owner, zero child subregistry, zero guest role bitmap and a bounded expiry. Registrar chooses policy fields; callers cannot supply privileged role bitmaps or arbitrary registries. Apply ASCII label validation, minimum 60 seconds and maximum 30 days; require guest expiry ≤ lock expiry ≤ root expiry and all names currently REGISTERED. Root and door tokens stay owner-controlled.

Expiry: fail closed at `block.timestamp >= expiry` for any level. Grace-period renewal eligibility never grants door access. Registry owner fields alone can be stale; require status, expiry and current owner together. Renewals, if added, require separate explicit permissions and ancestor bounds; the minimal design issues a fresh label per grant. `mira` is the first illustrative credential; later grants use fresh labels and do not promise reuse/reassignment timing.

Revocation: owner calls restricted registrar `unregister` on R2. DoorKeys immediately rejects a non-REGISTERED/no-owner credential regardless of residual resolver data. No mirrored guest allowlist or revocation list exists. UI may retain event history for display, but it cannot authorize access.

Replacement and resale: DoorKeys binds R1/R2, expected root/lock owner, root/lock registration token IDs and a door deployment epoch. On every unlock verify the active RootRegistry `eth` attachment, root registration and its R1 attachment, `lock` registration and its R2 attachment, and the guest state. A changed owner, changed registration generation, detached/replaced registry, expired ancestor or failing external read denies access. Canonical `setParent` metadata is not authorization proof. Replacing R1/R2 requires owner-authorized attachment changes plus a newly configured DoorKeys deployment/epoch; the old DoorKeys stays invalid and the door listener must explicitly adopt the new address. Do not let a new root buyer inherit old unlock authority. Same-owner root re-registration also requires rebinding rather than silently reviving old credentials.

DoorKeys stores door configuration only, never a separate guest access list. It checks R2 guest token ownership against `msg.sender` on each `unlock(label)`; it must never trust a supplied guest address, `tx.origin`, offchain allowlist or cached resolver result. Guest names receive no transfer privileges, but general non-transferability remains unproven; either complete the transfer matrix before claiming it or explicitly accept current registry owner as the authorization holder. Do not add a guest-address mapping to compensate.

Door identity: derive `doorId = keccak256(abi.encode(chainId, address(DoorKeys), rootLabelHash, lockLabelHash, R1, R2, epoch))`. Successful checks emit `DoorUnlocked(doorId, guest, credentialLabelHash, credentialTokenId, requestNonce)`; failure reverts and emits no unlock event. Nonce is a door-level sequence, not a guest access list. The door simulator accepts only successful receipt logs from chain 11155111, the configured contract/doorId and deployment epoch; deduplicate transaction hash/log index, handle reorgs and use a configured confirmation threshold before acting. A production physical lock would need a separate threat model; the initial target remains a simulated door.

## MetaMask transaction sequence and preliminary gas budget

Signing must use an owner-facing browser flow with MetaMask's injected EIP-1193 provider (for example ethers BrowserProvider and ContractFactory), chain/account checks and per-transaction review. Compile artifacts with Foundry locally; submit deployment bytecode/calldata through MetaMask after authorization. `forge script --broadcast` cannot directly invoke the MetaMask extension. Do not export/import a seed or private key, use an unlocked remote signer, or request blind signatures. Account connection/network switching is separate from approving a transaction.

The following unbatched plan assumes MockUSDC, no existing mock balance/allowance, two proxies, separate registrar and DoorKeys, optional canonical-parent writes included, no resolver writes. Every row is one transaction and one expected MetaMask approval; every transaction, including mock mint/approve and failed transactions, consumes Sepolia ETH gas. All planned call values are zero; registration rent is transferred in MockUSDC.

| Step | Transaction / recipient | Rough planning gas |
|---|---|---:|
| 1 | MockUSDC `mint(owner, quoted amount)` at manifest address | 50k–100k |
| 2 | MockUSDC `approve(ETHRegistrar, bounded amount)` | 45k–65k |
| 3 | ETHRegistrar `commit(commitment)` | 45k–80k |
| wait | Observe receipt and onchain commitment time; age 60s ≤ age < 86400s | no gas / approval |
| 4 | ETHRegistrar `register(rootLabel, owner, secret, 0, resolver, duration, MockUSDC, referrer)` | 220k–350k |
| 5 | VerifiableFactory `deployProxy(UserRegistryImpl, salt1, owner grants)` → R1 | 220k–400k |
| 6 | ETHRegistry `setSubregistry(rootTokenId, R1)` | 50k–100k |
| 7 | R1 `setParent(ETHRegistry, rootLabel)` | 60k–120k |
| 8 | VerifiableFactory `deployProxy(UserRegistryImpl, salt2, owner grants)` → R2 | 220k–400k |
| 9 | R1 `register("lock", owner, R2, resolver, constrained roles, lockExpiry)` | 130k–250k |
| 10 | R2 `setParent(R1, "lock")` | 60k–120k |
| 11 | Contract creation: CredentialRegistrar bound to owner and hierarchy | 1m–2m provisional |
| 12 | R2 `grantRootRoles(4097, CredentialRegistrar)` | 60k–120k |
| 13 | Contract creation: DoorKeys bound to validated path/generations | 1m–2m provisional |
| 14 | CredentialRegistrar `register` / issue `mira` to guest | 150k–300k |
| 15 | Guest → DoorKeys `unlock("mira")` | 100k–250k provisional |

Expected total: **15 transaction confirmations in MetaMask: 14 owner, 1 guest**. Skip mint/approval only after proving sufficient balance/allowance. Example later owner revocation adds one approval (roughly 70k–150k gas); registry replacement adds deployment/attachment/configuration transactions whose exact count depends on replacement scope. Role revocation, resolver writes, allowance cleanup and renewals are additional approvals, never implicit.

Ranges are conservative planning allowances, not live `eth_estimateGas` results. Historical fork internal measurements were parent registration 190,743; proxy deployment 181,870; attachment 28,193; child registration roughly 95k–99k; unregister 36,408. They exclude full transaction overhead and cannot predict unimplemented DoorKeys/registrar bytecode. The table totals about **3.51m–6.76m gas**. At an illustrative 1 gwei that is 0.00351–0.00676 Sepolia ETH; at 10 gwei 0.0351–0.0676. These are fee scenarios, not current fee recommendations. The RPC returned `eth_gasPrice = 21 wei`, an unusually low instantaneous quote that must not be used as a durable budget.

Before deployment approval, replace these ranges with simulation/`eth_estimateGas` for exact owner/from, calldata, constructor bytecode, current state and fees, plus a stated buffer. Publish a reviewable transaction manifest containing recipient, function/arguments, ETH value, ERC-20 spend limit, gas estimate, predicted creation addresses, chain ID and expected approvals. R1/R2/registrar/DoorKeys addresses are **not yet determined**: wallet address, salts, bytecode and owner nonce are not fixed. Do not invent them. Recheck actual receipts and addresses between dependent transactions. A factory address depends on the actual MetaMask caller; registrations must record the correct owner.

## Security gates, blockers and next stage

- Root ownership is absent. Alternative-root acceptance and successful future registration are prerequisites, with fresh availability/price checks. No promise of `lokesh.eth` control.
- Owner and guest public addresses, selected MetaMask accounts and balances/allowances remain unverified. Only public addresses/account connection are needed; no recovery material. The owner reports sufficient Sepolia ETH.
- Close deployed ABI/source/initializer/role compatibility before writes; code presence alone is insufficient. Treat unexpected reverts generically; `0xdab6c73c` remains unresolved.
- Extend the existing two-level spike checks to all three names and both attachment edges. Test wrong caller, reserved/revoked/expired names, root/door resale or same-owner re-registration, detached/replaced registries, upper expiry bounds, registrar role revocation and unauthorized issue/revoke. Confirm token-ID generation behavior before binding security to it.
- Finish the A3 transfer/operator/batch/emancipation matrix before relying on non-transferability. Avoid broad non-transferability claims and label-reuse promises. Restrict or omit upgrade powers and disclose retained owner/root override authority.
- Generate commitment secrets with a browser CSPRNG and keep them locally until reveal; never copy the spike's deterministic secret generation into deployment. The commitment secret is not a wallet recovery secret. Prevent premature disclosure, accidental double commits, excessive allowances and stale-account signing.
- Verify registry initialization atomically, owner recovery roles and bounded registrar permissions. Reverting/malicious registry reads must fail closed; avoid external calls or callbacks during unlock beyond necessary view checks. Reorg-aware event processing is required for the simulator.

**Exact next implementation step (Stage 3B, after explicit implementation authorization):** add a fork-tested three-level fixture using an available synthetic root, R1/`lock`/R2/`mira`; prove path, owner, expiry and registration-generation checks and the missing transfer cases. Then implement restricted CredentialRegistrar and DoorKeys without a guest list, and a MetaMask transaction-review page that prepares unsigned deployment steps. Reconcile deployed interfaces and run local tests before producing the final gas/address/confirmation manifest. Request explicit transaction authorization only after that concrete manifest is reviewable. Stage 3A stops here; it authorizes none of those writes.
