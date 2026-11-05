# Ordered deployment transaction review

**BLOCKED: plan only; no payload is signable, no transaction has been submitted.** Machine-readable source: `deployment-manifest.json`. All 15 owner actions below use chain 11155111, ETH value 0 and an unresolved owner account. Two preliminary actions may be explicitly skipped after verifying balances/allowances. Thus up to 15 owner MetaMask transaction approvals; guest unlock is not included and would require separate authorization. Account connection/network switching is not a transaction approval.

Order intentionally registers lock with no child, then creates/attaches R2. Canonical setParent writes are separate from forward attachment. Both production constructors run only after all hierarchy links and ancestor token generations are established. R2 root role grants do not regenerate root/lock ancestor tokens. No grant/revoke or transfer of ancestor token roles is planned after constructor snapshots.

Every tx has unknown gas/fee and calldata fields until actual accounts, addresses, salt, expiry, price and gate results are fixed. Gas method: `eth_estimateGas` on exact from/to/value/data (omit to for contract creation), current state simulation and current fee observations, followed by explicit owner review. Any estimate remains UNVERIFIED until those inputs exist. No automated fallback, retry, batching or unsigned-transaction submission exists.

## T01 — Obtain mock rent tokens if needed

- Target: `{"reference": "verified.MockUSDC", "value": "0x240b0316df57887dbbe58b586508b19e633a14aa", "classification": "VERIFIED", "block": 12071722}`
- ABI: `MockUSDC`; signature: `mint(address,uint256)`
- Signer: selected owner EOA; required authority: No mint role in linked MockERC20; conditional on reviewed implementation.
- Arguments/bindings: `[{"binding": "accounts.owner", "value": null, "classification": "UNVERIFIED"}, {"binding": "quote.basePlusPremium", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: Owner mock token balance increases.
- Expected logs: Transfer.
- Before signing: Current price; owner and token identity; balance deficit; sufficient gas ETH.
- After successful receipt: balanceOf(owner) increases by reviewed amount; Transfer from zero.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.
- Conditional skip: Skip only if verified balance already sufficient; record skip evidence.

## T02 — Approve bounded registrar rent spend

- Target: `{"reference": "verified.MockUSDC", "value": "0x240b0316df57887dbbe58b586508b19e633a14aa", "classification": "VERIFIED", "block": 12071722}`
- ABI: `MockUSDC`; signature: `approve(address,uint256)`
- Signer: selected owner EOA; required authority: Token holder owner.
- Arguments/bindings: `[{"reference": "verified.ETHRegistrar", "value": "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3", "classification": "VERIFIED", "block": 12071722}, {"binding": "quote.basePlusPremium", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: Allowance to ETHRegistrar set to reviewed bounded spend.
- Expected logs: Approval.
- Before signing: Read balance/allowance; reject unlimited spend; refresh quote.
- After successful receipt: allowance(owner,ETHRegistrar) equals approved limit.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.
- Conditional skip: Skip only if verified existing bounded allowance is sufficient and owner accepts it.

## T03 — Commit root registration intent

- Target: `{"reference": "verified.ETHRegistrar", "value": "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3", "classification": "VERIFIED", "block": 12071722}`
- ABI: `ETHRegistrar`; signature: `commit(bytes32)`
- Signer: selected owner EOA; required authority: Any caller; owner account pays gas.
- Arguments/bindings: `[{"binding": "registration.commitment", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: Commitment timestamp recorded.
- Expected logs: CommitmentMade.
- Before signing: isAvailable true; exact approved root and commitment parameters; fresh CSPRNG secret kept outside shared artifacts.
- After successful receipt: commitmentAt(commitment) and receipt block/time match; wait min age, strictly less than max age.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T04 — Reveal/register the approved Sepolia root

- Target: `{"reference": "verified.ETHRegistrar", "value": "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3", "classification": "VERIFIED", "block": 12071722}`
- ABI: `ETHRegistrar`; signature: `register(string,address,bytes32,address,address,uint64,address,bytes32)`
- Signer: selected owner EOA; required authority: Payer owner has rent balance/allowance; registrar owns global REGISTRAR permission.
- Arguments/bindings: `["nak-lokesh-20261105", {"binding": "accounts.owner", "value": null, "classification": "UNVERIFIED"}, {"binding": "privateRegistrationState.secret", "value": null, "classification": "UNVERIFIED"}, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 31536000, {"reference": "verified.MockUSDC", "value": "0x240b0316df57887dbbe58b586508b19e633a14aa", "classification": "VERIFIED", "block": 12071722}, "0x0000000000000000000000000000000000000000000000000000000000000000"]`
- Expected state: Root token owned by owner; actual expiry and token ID read from receipt/state.
- Expected logs: NameRegistered, LabelRegistered.
- Before signing: All source/account/role gates; commitment bounds; availability/quote/allowance; no mainnet prerequisite in ordinary available-label path.
- After successful receipt: ETHRegistry getState/getOwner/getExpiry; record actual root token/resource; root owner SET_SUBREGISTRY confirmed.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T05 — Create R1 and initialize owner grants atomically

- Target: `{"reference": "verified.VerifiableFactory", "value": "0xda70306c98e97ece36f997a21368e53298572991", "classification": "VERIFIED", "block": 12071722}`
- ABI: `VerifiableFactory`; signature: `deployProxy(address,uint256,bytes)`
- Signer: selected owner EOA; required authority: Factory permissionless; explicit owner granted root roles by initialize.
- Arguments/bindings: `[{"reference": "verified.UserRegistryImpl", "value": "0x9bd8a88719068d09ecee662f36c0e3856708366a", "classification": "VERIFIED", "block": 12071722}, {"binding": "salts.R1", "value": null, "classification": "UNVERIFIED"}, {"binding": "encoded.initializeOwnerGrants", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: New R1 proxy; OWNER_OPERATIONS_AND_ADMINS initialized.
- Expected logs: ProxyDeployed, RegistryCreated, EACRolesChanged.
- Before signing: Owner grants exactly policy bitmap; validate initialize((address,uint256)[]) ABI; predictProxyAddress(owner,salt); unused salt/address; code identities.
- After successful receipt: Receipt ProxyDeployed address equals predicted; verifyContract(R1) expected implementation; exact owner root bitmap and aggregate role counts.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T06 — Attach R1 to root

- Target: `{"reference": "verified.ETHRegistry", "value": "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4", "classification": "VERIFIED", "block": 12071722}`
- ABI: `ETHRegistry`; signature: `setSubregistry(uint256,address)`
- Signer: selected owner EOA; required authority: Owner SET_SUBREGISTRY on current root resource.
- Arguments/bindings: `[{"binding": "receipts.rootTokenId", "value": null, "classification": "UNVERIFIED"}, {"binding": "future.R1", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: Root forward attachment becomes R1.
- Expected logs: SubregistryUpdated.
- Before signing: Active root owner/token generation and attachment permission.
- After successful receipt: ETHRegistry.getSubregistry(rootLabel)==R1; root token unchanged.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T07 — Set R1 canonical parent metadata

- Target: `{"binding": "future.R1", "value": null, "classification": "UNVERIFIED"}`
- ABI: `UserRegistryImpl`; signature: `setParent(address,string)`
- Signer: selected owner EOA; required authority: Owner R1 root SET_PARENT.
- Arguments/bindings: `[{"reference": "verified.ETHRegistry", "value": "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4", "classification": "VERIFIED", "block": 12071722}, "nak-lokesh-20261105"]`
- Expected state: Canonical R1 parent recorded; no forward grant implied.
- Expected logs: ParentUpdated.
- Before signing: Owner has SET_PARENT; R1 factory verified.
- After successful receipt: R1.getParent() equals ETHRegistry/root label; root forward link still correct.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T08 — Register owner-controlled lock with no child attached yet

- Target: `{"binding": "future.R1", "value": null, "classification": "UNVERIFIED"}`
- ABI: `UserRegistryImpl`; signature: `register(string,address,address,address,uint256,uint64)`
- Signer: selected owner EOA; required authority: Owner R1 root REGISTRAR.
- Arguments/bindings: `["lock", {"binding": "accounts.owner", "value": null, "classification": "UNVERIFIED"}, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "91700664256357922357994873537130062512592519168", {"binding": "inputs.lockExpiry", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: Lock token owned by same owner; roles mirror Stage 3B fixture; expiry <= root.
- Expected logs: LabelRegistered, TokenResource.
- Before signing: Lock unused/available; root owner active; planned 90-day lock expiry within root; owner accepts transfer-admin role on owner token.
- After successful receipt: R1.getState/getOwner/getExpiry(lock); lock role bitmap; capture actual token/resource; no R2 attachment yet.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T09 — Create R2 and initialize owner grants atomically

- Target: `{"reference": "verified.VerifiableFactory", "value": "0xda70306c98e97ece36f997a21368e53298572991", "classification": "VERIFIED", "block": 12071722}`
- ABI: `VerifiableFactory`; signature: `deployProxy(address,uint256,bytes)`
- Signer: selected owner EOA; required authority: Explicit owner initial grants, factory permissionless.
- Arguments/bindings: `[{"reference": "verified.UserRegistryImpl", "value": "0x9bd8a88719068d09ecee662f36c0e3856708366a", "classification": "VERIFIED", "block": 12071722}, {"binding": "salts.R2", "value": null, "classification": "UNVERIFIED"}, {"binding": "encoded.initializeOwnerGrants", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: New R2 proxy; same reviewed owner root grants.
- Expected logs: ProxyDeployed, RegistryCreated, EACRolesChanged.
- Before signing: Distinct unused salt; predicted address; exact owner grants and implementation.
- After successful receipt: Factory verifyContract(R2); owner bitmap/counts; unemancipated; no guest root privileges.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T10 — Attach R2 under lock

- Target: `{"binding": "future.R1", "value": null, "classification": "UNVERIFIED"}`
- ABI: `UserRegistryImpl`; signature: `setSubregistry(uint256,address)`
- Signer: selected owner EOA; required authority: Owner SET_SUBREGISTRY on lock resource or R1 root.
- Arguments/bindings: `[{"binding": "receipts.lockTokenId", "value": null, "classification": "UNVERIFIED"}, {"binding": "future.R2", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: Lock forward attachment becomes R2.
- Expected logs: SubregistryUpdated.
- Before signing: Lock/root current owner/expiry/token generations; R2 verified.
- After successful receipt: R1.getSubregistry(lock)==R2; lock token generation unchanged.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T11 — Set R2 canonical parent metadata

- Target: `{"binding": "future.R2", "value": null, "classification": "UNVERIFIED"}`
- ABI: `UserRegistryImpl`; signature: `setParent(address,string)`
- Signer: selected owner EOA; required authority: Owner R2 root SET_PARENT.
- Arguments/bindings: `[{"binding": "future.R1", "value": null, "classification": "UNVERIFIED"}, "lock"]`
- Expected state: Canonical R2 parent recorded.
- Expected logs: ParentUpdated.
- Before signing: R2 verified; owner SET_PARENT.
- After successful receipt: R2.getParent()==(R1,lock); both forward links still correct.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T12 — Deploy CredentialRegistrar

- Target: `Contract creation: future address remains null`
- ABI: `CredentialRegistrar`; signature: `constructor(address,string,address,address)`
- Signer: selected owner EOA; required authority: Owner EOA pays gas; constructor validates full active hierarchy.
- Arguments/bindings: `[{"binding": "accounts.owner", "value": null, "classification": "UNVERIFIED"}, "nak-lokesh-20261105", {"binding": "future.R1", "value": null, "classification": "UNVERIFIED"}, {"binding": "future.R2", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: New immutable owner/R1/R2 and ancestor token bindings.
- Expected logs: No application constructor event; verify receipt.contractAddress and code/config readbacks.
- Before signing: Stable ancestor generations; full hierarchy, roles/runtime/source gates; fresh local creation artifact hash.
- After successful receipt: Receipt contractAddress; code; owner/rootLabel/parentRegistry/guestRegistry/rootTokenId/lockTokenId getters; no roles assumed from deployment.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T13 — Grant only minimal registrar permissions

- Target: `{"binding": "future.R2", "value": null, "classification": "UNVERIFIED"}`
- ABI: `UserRegistryImpl`; signature: `grantRootRoles(uint256,address)`
- Signer: selected owner EOA; required authority: Owner R2 REGISTRAR_ADMIN and UNREGISTER_ADMIN.
- Arguments/bindings: `[4097, {"binding": "future.CredentialRegistrar", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: Registrar root bitmap exactly 4097; no admin/RENEW/UPGRADE.
- Expected logs: EACRolesChanged.
- Before signing: Registrar config verified; root inventory trusted; existing registrar bitmap zero.
- After successful receipt: R2.roles(ROOT_RESOURCE,registrar)==4097; hasRootRoles(1/4096); registry unemancipated.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T14 — Deploy DoorKeys

- Target: `Contract creation: future address remains null`
- ABI: `DoorKeys`; signature: `constructor(address,string,address,address,uint256)`
- Signer: selected owner EOA; required authority: Owner EOA pays gas; constructor validates hierarchy.
- Arguments/bindings: `[{"binding": "accounts.owner", "value": null, "classification": "UNVERIFIED"}, "nak-lokesh-20261105", {"binding": "future.R1", "value": null, "classification": "UNVERIFIED"}, {"binding": "future.R2", "value": null, "classification": "UNVERIFIED"}, 1]`
- Expected state: Door contract snapshots same owner, registries and ancestor generations; epoch 1.
- Expected logs: No application constructor event; verify receipt.contractAddress and code/config readbacks.
- Before signing: Complete current path; stable generation IDs; approved bytecode/constructor arguments.
- After successful receipt: Receipt contractAddress; administrator/registries/rootLabelHash/token snapshots/epoch/doorId; requestNonce zero; no ENS roles granted to DoorKeys.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## T15 — Issue Mira temporary credential

- Target: `{"binding": "future.CredentialRegistrar", "value": null, "classification": "UNVERIFIED"}`
- ABI: `CredentialRegistrar`; signature: `issue(string,address,uint64)`
- Signer: selected owner EOA; required authority: Configured owner only; registrar 4097 on R2.
- Arguments/bindings: `["mira", {"binding": "accounts.guest", "value": null, "classification": "UNVERIFIED"}, {"binding": "inputs.guestExpiry", "value": null, "classification": "UNVERIFIED"}]`
- Expected state: Mira token owned by guest; zero roles/child registry/resolver; fresh one-day expiry proposal.
- Expected logs: CredentialIssued, LabelRegistered.
- Before signing: Guest nonzero, not owner/registrar, no root roles; complete initial R2 label state; expiry 60s..30d and <=lock/root; planned one day must fit without silent truncation.
- After successful receipt: R2 getState/getOwner/getExpiry; roleCount(resource)==0 and guest root roles==0; getResolver/getSubregistry zero; full DoorKeys authorization reads; no unlock/signature request.
- Estimate: After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.
- Failure/recovery: Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing.

## Final read-only verification (no transaction)

Read RootRegistry eth pointer, root/lock/guest states and current owners/expiries, both forward links, canonical metadata, registry factory identities and runtime hashes; compare ancestor token IDs with both production contracts. Verify root owner = lock owner = CredentialRegistrar.owner = DoorKeys.administrator = selected owner EOA. Verify registrar R2 bitmap 4097, Mira root bitmap zero and resource roleCount zero, R2 unemancipated, guest resolver/subregistry zero, DoorKeys has no roles, and DoorKeys doorId/epoch match reviewed formula and requestNonce is zero. Recheck application owner/guest distinction. Read-only `eth_call` of unlock from the actual guest may later simulate eligibility; no transaction is implied. No synthetic root result proves live ownership.

Initialization recipe is `initialize((address,uint256)[])` with one explicit Grant(account=owner, roleBitmap=OWNER_OPERATIONS_AND_ADMINS). Salt must be fixed only after actual factory caller is known; verify predictProxyAddress before approving each future deployment. Never initialize to msg.sender implicitly. Registration secret is not a wallet secret but must stay private until reveal and must not appear in shared artifacts.
