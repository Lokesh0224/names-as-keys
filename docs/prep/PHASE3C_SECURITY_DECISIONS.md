# Stage 3C security decisions

**Final architecture correction status:** uncommitted; architecture approval pending. The correction section below and `PHASE3C_DEPLOYMENT_READINESS.md` supersede the earlier review disposition and initial-state shorthand. Prior 146-test evidence remains unchanged; current-source validation is in `evidence/stage3c/corrections/`.

Date: 2026-11-06 (Asia/Kolkata). Starting checkpoint verified in the actual repository: `b84d97721ef152be40db01a0333fc1e5932005e5`; working tree was clean. Stage 3B source/log SHA-256 values matched its retained run metadata. Phase 3A plan, Stage 3B implementation/report/evidence and vendored interfaces were inspected. This is a conditional implementation decision record, not permission for live registration/deployment.

## Proof-first boundary and threat model

Before production implementation, seven focused preflight tests passed on chain 11155111, fork block 12071220, hash `0x0da28eda62d82e725492bd61af1eac89a09379b6e407821a69d735cc4457739c`. Their test-only RestrictedRegistrarProbe has exactly the intended 4097 registry roles. Source/log hashes and command are retained in `evidence/stage3c/preflight-run.json`; passing output is `preflight-pass.log`. Two preceding runs each had six passes and one public-RPC historical-state database failure; both failure logs are retained. The unchanged tests passed using the second public endpoint. No failure was discarded as a protocol pass.

Security scope: untrusted guests, approved operators and arbitrary transaction callers; trusted configured owner and ENS registry administration. Guests receive zero token roles and no registry-root roles. Registry administrators can deliberately remove revocation powers, reissue names, renew expired credentials or upgrade a suitably privileged registry. No contract with only REGISTRAR and UNREGISTER can prevent its external role administrator from removing those roles. **Unconditional revocability against a malicious owner/ENS administrator is not claimed.** The tested mitigation retains non-emancipating UNREGISTER on the restricted registrar itself; guests/operators cannot remove it. Owner revocation is guaranteed only for active credentials while these permissions and the verified registry implementation remain intact. Expired credentials already deny access and may reject `unregister`.

“PROVEN” below means the stated, scoped property has the cited source or runtime evidence. It is not a universal audit certificate. The selected mandatory gates pass for this profile; claims outside this profile are explicitly excluded. Any future requirement for adversarial-admin resistance or permanent historical invalidation must be reopened as BLOCKED until separately demonstrated.

## Security decision table — pre-implementation gates

| Gate / requirement | Exact evidence | Observed behavior and consequence | Selected design | Remaining limitations | Status |
|---|---|---|---|---|---|
| A1: guest/operator cannot emancipate zero-role credentials | `testSecurityGuestOperatorAndDelegatedRoleCannotEmancipate`; PermissionedRegistry `_getRoles`, `_getSettableRoles`, `isEmancipated`; EAC `_checkCanGrantRoles`, `_checkCanRevokeRoles` | Guest and approved operator, even with ordinary delegated RENEW, fail ten escalation/role-removal/attachment/reinitialization/upgrade attempts each; root roles remain intact | Zero guest token roles; no guest root roles; retain registrar UNREGISTER; no role/upgrade forwarding entrypoint | An administrator can grant dangerous root admin powers; that violates the selected profile | PROVEN |
| A1: mitigation retains owner revocation if owner drops its own override roles | `testSecurityRetainedRegistrarPreventsEmancipationAfterOwnerDropsOwnOverrides`; `testSecurityOwnerCanDeliberatelyDisableRevocation` | Registrar's UNREGISTER keeps registry unemancipated and revocation succeeds; removing both owner's and registrar's roles emancipates and defeats revocation | Non-upgradeable registrar with retained operational UNREGISTER; only owner can call revoke; inspect roles before issue | Authorized administrators can intentionally disable it; no “owner can always revoke regardless of state/admin actions” claim | PROVEN |
| A2: transfer and approval paths | Stage 3B 32-cell matrix; `testSecurityZeroRoleApprovalsAndMixedBatchCannotTransfer`; PermissionedRegistry `_update`; ERC1155Singleton approval/transfer functions | Guests may create and remove operator approvals. Approval does not create transfer-admin permission. Empty-bitmap single transfers and mixed two-token batches fail atomically; root revocation still works | Issue zero role bitmap, registry and resolver; no assertion that approvals are forbidden; ENS current owner is identity source | Scoped non-transferability only for these permissions/implementation; arbitrary admin changes and receiver interactions require separate checks | PROVEN |
| A3: minimum registry permissions and independent caller authorization | `testSecurityMinimalRegistrarCallerRestrictions`; Stage 3B `testRoleRequirementsAndRevocation`, `testIndividualOperationRolesAreRequired` | Restricted probe issues/revokes with exactly 4097; unauthorized callers cannot use its powers; role revocation blocks operations | Exactly REGISTRAR (1) and UNREGISTER (4096), no admins/renew/upgrade; explicit `msg.sender == owner` | Registry admins retain direct authority outside registrar | PROVEN |
| A4: revoke/reuse/generation/expiry | `testSecurityRevocationReuseAndExpiryGeneration`; PermissionedRegistry `_register`, `unregister`, `renew`, `_constructResource`, `_regenerate`; Stage 3B generation and expiry tests | Revoke burns owner, status AVAILABLE and new token/resource. Freshly revoked label can be reassigned. Natural expiry can be revived by root RENEW; raw ENS permits expiry beyond ancestors | Reject issuance unless the complete current initial-state predicate holds (final correction below); expose no renewal; bound issue expiry 60s–30d and by all ancestors; bind ancestor token IDs conservatively | Direct authorized registry writes can reuse or revive names; token IDs also change on role churn | PROVEN |
| A4: hierarchy/attachment replacement | Stage 3B `testDetachedAndReplacedR1Rejects`, `testDetachedAndReplacedR2Rejects`, `testRestoringSameAttachmentRestoresCurrentStateAcceptance`, owner/generation tests | Current detachment/replacement/ancestor changes reject; restoring original current state can accept | Immutable registry addresses and conservative ancestor token snapshots; validate current forward path on issuance; allow owner cleanup in fixed R2 despite stale ancestors | No permanent historical invalidation; future DoorKeys/epoch policy is outside this registrar | PROVEN |
| A5: interface and assumption comparison | `evidence/stage3c/source-comparison.json`; deployment-linked source at `07e55a056f5b6a9c90119f501bdd05714e67dddd`; `testSecurityRootTransferAdminEmancipationCompatibilityProbe` | Five directly compared core interfaces are byte-identical; the final inherited-interface comparison also found a metadata inheritance difference. Vendored RegistryRolesLib omits CAN_TRANSFER_ADMIN in emancipation mask; runtime returns false for a root-transfer-admin-only registry, matching linked source | Do not use vendored UNEMANCIPATED_ROLE_BITMAP in production; query actual `isEmancipated`; use separately matching 1/4096 constants and tested APIs | Full reproducible bytecode/source equivalence is not established and is not inferred from getters | PROVEN |
| DoorKeys/events/QR/frontend/live deployment | Explicit task exclusion | No implementation required here | Do not implement or broadcast | Future architecture authorization needed | NOT APPLICABLE |

## Official source references and exact comparison

The [official ENS deployment table](https://docs.ens.domains/learn/deployments/#sepolia-ensv2) was fetched in this stage. Its Sepolia entries link UserRegistryImpl and ETHRegistry source at the commit below. This linkage is provenance, not proof that all deployed bytecode equals that source.

- [PermissionedRegistry](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/registry/PermissionedRegistry.sol): `isEmancipated`, `_update`, `_getSettableRoles`, `_getRoles`, registry lifecycle and generation helpers.
- [EnhancedAccessControl](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/access-control/EnhancedAccessControl.sol): external grant/revoke modifiers and role authorization checks.
- [ERC1155Singleton](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/erc1155/ERC1155Singleton.sol): `setApprovalForAll`, `_checkApproval`, safe transfer methods, callbacks after updates.
- [UserRegistry](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/registry/UserRegistry.sol): atomic `initialize(Grant[])`, disabled implementation initializer, root UPGRADE authorization.
- [RegistryRolesLib](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/registry/libraries/RegistryRolesLib.sol): differing emancipation mask, matching operational role constants.

Downloaded source hashes and URLs are in the comparison JSON. The repository vendors interfaces, not complete registry/EAC/ERC1155 implementations. Thus implementation-to-vendored-implementation equality cannot be checked: those implementations are absent. Byte-equal interfaces: IStandardRegistry, IPermissionedRegistry, IRegistry, IEnhancedAccessControl and IEACGrantInitializable. RegistryRolesLib's only inspected textual difference is an added `ROLE_CAN_TRANSFER_ADMIN |` in the upstream UNEMANCIPATED mask. Vendored historical files remain unchanged. Final review also compared ITemporalRegistry, IOwnedRegistry, IERC1155Singleton, IUnsafeTransferable and LibLabel: all byte-identical. Upstream ITokenizedRegistry additionally inherits IERC1155MetadataURI; the vendored version does not. The registrar uses no metadata or ERC165-derived interface ID, so it does not depend on that difference. No metadata/interface-ID equivalence is claimed.

The official factory source link uses a moving branch. Its inspected revision was pinned separately to `c1090aec465ab30d494c96bd7d2a147b4f0b0173`. [VerifiableFactory.verifyContract](https://github.com/ensdomains/verifiable-factory/blob/c1090aec465ab30d494c96bd7d2a147b4f0b0173/src/VerifiableFactory.sol) verifies the factory-derived proxy address and reports its current implementation. The vendored IVerifiableFactory declarations match that revision after removing comments and formatting. Constructor/issue/revoke paths exercise `verifyContract`; a test injects a different return value and confirms rejection. Runtime code hashes and block provenance are recorded in `pinned-chain.json`; they are identifiers, not evidence of a reproducible source build.

Behavioral probes supplement this comparison; full source equivalence remains unclaimed.

## Corrections and boundaries identified by proof

A fresh unregister followed by register to a different guest succeeds. Historical Q6's failure occurred after an intervening successful same-owner registration, so it does not establish a general restriction on different-owner reuse. Historical artifacts remain unchanged. New registrar policy uses an onchain initial-state check rather than relying on that earlier inference or maintaining a label list.

Emancipation is a property computed from root-role counts, not a special guest-triggered method. Removing only the owner's own roles is insufficient while the registrar holds UNREGISTER. Privileged administrators intentionally removing all these powers is a real counterexample to an unconditional revocation promise; it is documented rather than hidden.

Ancestor token snapshots are deliberately conservative: both re-registration and certain role changes require a new registrar configuration/deployment. A restored path without generation change can become usable again; this component does not maintain a history of detached registries or owners.

## Selected registrar surface (to implement after these gates)

Constructor binds owner, root label, R1, R2 and root/lock token IDs to the verified Sepolia ENS entrypoints. Issue accepts only label, guest and absolute expiry. It checks caller, active full path, current ancestor ownership/generation, implementation identity through the factory, retained minimum roles, guest root-role absence and unused label. It hardcodes zero token bitmap/resolver/subregistry. Revoke checks caller and current R2 label/token identity, then unregisters in fixed R2; it remains usable for cleanup after ancestor detachment/expiry. There is no access list, ownership-transfer API, arbitrary call API, renewal API or role management API. Reentrancy protection and postcondition checks cover token-receiver callbacks; production behavior must be tested before being considered verified.

## Implementation validation

The gate record above was written after preflight passed and before `contracts/src/CredentialRegistrar.sol` was created. The final implementation adds only `issue(string,address,uint64)` and `revoke(string,uint256)` mutating entrypoints, configured by constructor `(address,string,IPermissionedRegistry,IPermissionedRegistry)`. Owner/configuration have no mutation API. The label policy is lower-case ASCII letters/digits/hyphens, length 3–32, no leading/trailing hyphen. `mira` is available for an initial live grant only if unused in the eventual approved R2.

Production registry calls use the verified interfaces:

- `IRegistry.getSubregistry(string)`, `getResolver(string)`.
- `IPermissionedRegistry.getState(uint256)` returning `(Status,uint64,address,uint256,uint256)`, `getOwner(uint256)`, `ROOT_RESOURCE()`, `roles(uint256,address)`, `hasRootRoles(uint256,address)`, `isEmancipated()`.
- Inherited `IStandardRegistry.register(string,address,IRegistry,address,uint256,uint64) returns (uint256)` and `unregister(uint256)`.
- `IVerifiableFactory.verifyContract(address) view returns (address)`.

No invented ENS method, universal resolver address record, offchain allowlist or cached guest ownership is used. `rootLabel` is constructor-set storage without a setter; owner, R1/R2 and ancestor token IDs are immutable. The sole mutable operational field is a reentrancy guard; no guest collection exists.

| Production decision | Direct test evidence and actual outcome | Status |
|---|---|---|
| Owner-only issue/revoke including approved operators | `testRegistrarUnauthorizedIssueRevokeAndApprovedOperator`: all unauthorized calls revert; authorized issue/revoke and issued-event identity/arguments pass | PROVEN |
| Registry minimum permissions and emergency cleanup | `testRegistrarRevokedIssueRoleKeepsEmergencyRevoke`, `testRegistrarRevokedUnregisterRoleBlocksIssueAndRevoke`, `testRegistrarUnexpectedExtraRolesBlockIssue`, `testRegistrarRetainedRoleMitigationSurvivesOwnerDroppingOwnRoles`: expected denies/recovery pass | PROVEN |
| Bounded expiry and valid guest/label | `testRegistrarExpiryBoundsAndBoundary`, `testRegistrarRejectsLockExpiryBeyondRoot`, `testRegistrarRejectsInvalidGuests`, `testRegistrarLabelValidationAndNoPrivilegeForwarding`: boundaries and invalid-input denials pass | PROVEN |
| Full path and conservative ancestor generations | `testRegistrarExpiredRootAndLockRejectIssue`, both owner-change tests, lock/root-generation tests and role-churn test: issuance rejects stale state; fresh explicit registrar binding succeeds after root re-registration | PROVEN |
| Fixed R2 cleanup despite stale ancestors | `testRegistrarDetachmentReplacementAndCleanup`: detached/replaced paths reject issuance; owner cleanup still revokes in original R2 | PROVEN |
| Reuse, stale revocation and natural expiry | `testRegistrarRejectsActiveRevokedExpiredAndReservedLabelReuse`, `testRegistrarStaleRevokeCannotRevokeNewGeneration`, `testRegistrarExpiredCredentialCannotUnlockOrBeUnregistered`: all specified checks pass | PROVEN |
| Guest/operator privilege and transfer attempts | `testRegistrarGuestAndOperatorCannotEmancipateOrTransferIssuedCredential`: escalation/transfers fail and owner revocation succeeds | PROVEN |
| Registry failures and callbacks | `testRegistrarRegistryReadFailureFailsClosed`, `testRegistrarBadRegistryPostconditionRollsBackMint`, `testRegistrarReceiverCallbackCannotUseIssuerAuthority`: reads fail closed, bad postconditions roll back mint, guest callback cannot issue/revoke | PROVEN |
| Chain/implementation identity and current-state restoration | `testRegistrarWrongChainAndImplementationFailClosed`, `testRegistrarRestoredPathIsCurrentStateNotPermanentInvalidation`: wrong identity rejects; restored valid path permits issuance | PROVEN |

The local reentrancy guard is directly visible in the reviewed `nonReentrant` modifier; the receiver test establishes unauthorized callback rejection, not an exhaustive proof for every smart-account/owner callback. Complex smart-owner wallet policies remain outside this test profile. `CredentialIssued`/`CredentialRevoked` are lifecycle events, not DoorUnlocked authorization events.

### Commands and retained actual results

Pre-production gate:

```sh
forge test --root contracts --match-contract CredentialSecurityPreflightTest \
  --match-test testSecurity --fork-url https://1rpc.io/sepolia \
  --fork-block-number 12071220 -vv
```

Actual result: **7 passed, 0 failed, 0 skipped; exit 0**. `preflight-run.json` records the pre-implementation source hash.

Initial production focused command used `--match-contract CredentialRegistrarTest --match-test testRegistrar`, the same pinned block and the 1rpc public endpoint: **11 passed / 11 failed**, all failures historical-storage/rate-limit infrastructure errors. A subsequent serial focused run using Tenderly returned **24 passed / 1 failed**: an external `GRACE_PERIOD()` read consumed `vm.prank(OWNER)` before the root-generation test's `renew`. The test was corrected by reading the grace period before setting the caller. No production check was weakened. Intermediate source hashes for these two development attempts were not captured; their logs are retained as failure history, not authoritative final-source validation.

Final complete suite:

```sh
forge test --root contracts --threads 1 \
  --fork-url https://sepolia.gateway.tenderly.co \
  --fork-block-number 12071220 --fork-retries 3 --fork-retry-backoff 500 -vv
```

**Prior iteration result: 146 passed, 0 failed, 0 skipped; six suites; exit 0.** This log is preserved and superseded for the corrected current source by the correction run below. There are **7 new preflight tests and 27 new production tests**. Each new suite also inherits 25 unchanged Stage 3B tests. ClosureA3Lite inherits 15 spike tests. Total execution counts deliberately include these repetitions.

| Suite | Passing executions |
|---|---:|
| CredentialRegistrarTest | 52 (27 new + 25 inherited) |
| CredentialSecurityPreflightTest | 32 (7 new + 25 inherited) |
| ThreeLevelENSv2Test | 25 |
| ENSv2QuestionsTest | 15 |
| ClosureA3LiteTest | 20 |
| SepoliaDeploymentSmokeTest | 2 |

Authoritative output: `evidence/stage3c/foundry-full-pass.log`; final command, code hashes and counts: `evidence/stage3c/run.json`. All retained new evidence files except the checksum manifest itself have entries in `evidence/stage3c/SHA256SUMS`. Final formatting and Git/new-file whitespace checks are recorded by the completion report. No historical Phase 2/3B file was modified.

The synthetic fork root remains `nak3b-fixture-12071220.eth`. No ownership, live registration or current availability of `nak-lokesh-20261105.eth` is implied. No private-key handling, signing, broadcast, DoorKeys, frontend or QR work occurred.

### Remaining limitations and review disposition

Earlier iteration disposition: scoped behavior passed its tests. Final architecture approval is pending. Reproducible source-to-bytecode equivalence is explicitly BLOCKED; no interface/address/runtime result establishes it. Unconditional revocation against an administrator who removes all roles is impossible in this permission model and is explicitly excluded. Deployment prerequisites remain unresolved: live root availability/registration, concrete R1/R2 addresses, owner/guest public accounts, transaction gas/fee estimates and exact MetaMask review sequence. Reproducible full bytecode/source equivalence, arbitrary upgrade/admin scenarios, complex smart-owner callback policies and a permanent historical invalidation mechanism remain unproven. None is silently represented as a proven guarantee.

Issue requires AVAILABLE status, zero expiry/latestOwner and initial token/resource versions, using current ENS state. This is not a permanent historical uniqueness guarantee. Direct registry administrators can still bypass application policy, renew expired names or reissue credentials. Current-state restoration can restore validity. Conservative token binding can reject legitimate ancestor role changes, requiring a new registrar deployment. These design tradeoffs require architecture review before another implementation stage.

No files were staged and no commit was created. Stop for architecture review and owner approval.

## Created files

- `contracts/src/CredentialRegistrar.sol`
- `contracts/test/stage3c/CredentialRegistrar.t.sol`
- `contracts/test/stage3c/SecurityPreflight.t.sol`
- `docs/prep/PHASE3C_SECURITY_DECISIONS.md`
- `docs/prep/evidence/stage3c/SHA256SUMS`
- `docs/prep/evidence/stage3c/foundry-full-pass.log`
- `docs/prep/evidence/stage3c/pinned-chain.json`
- `docs/prep/evidence/stage3c/preflight-pass.log`
- `docs/prep/evidence/stage3c/preflight-primary-retry.log`
- `docs/prep/evidence/stage3c/preflight-primary.log`
- `docs/prep/evidence/stage3c/preflight-run.json`
- `docs/prep/evidence/stage3c/registrar-infrastructure-failure.log`
- `docs/prep/evidence/stage3c/registrar-test-failure.log`
- `docs/prep/evidence/stage3c/run.json`
- `docs/prep/evidence/stage3c/source-comparison.json`

Existing tracked files modified: none.

## Final architecture corrections — proof table

All new observations below concern Sepolia block 12071220 and the synthetic R2 fixture. Full source-cache hashes still match `source-comparison.json`. No production DoorKeys exists: “access” means acceptance by the existing three-level test oracle, not a live door unlock.

Exact source references:

- **S1:** [PermissionedRegistry.getState, lines 361–370](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/registry/PermissionedRegistry.sol#L361), [`_constructStatus`, lines 697–704](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/registry/PermissionedRegistry.sol#L697), and `_isExpired` line 671. Expiry dominates status; latestOwner is the retained raw token owner.
- **S2:** [PermissionedRegistry._register, lines 448–510](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/registry/PermissionedRegistry.sol#L448), `unregister` lines 227–237, `renew` lines 243–258, `_canRevive` lines 644–654, `_checkExpiryAndTokenRoles` lines 657–667. Zero-expiry creation fails; unregister records the current positive timestamp; renewal cannot reduce recorded expiry.
- **S3:** [PermissionedRegistry version constructors, lines 678–693](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/registry/PermissionedRegistry.sol#L678). Initial token version is zero; the current resource view uses version one for an untouched expired/zero entry. Natural expiry can temporarily advance the resource view and renewal restore it without a new token generation.
- **S4:** [EnhancedAccessControl._checkCanRevokeRoles and _getRevokableRoles](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/access-control/EnhancedAccessControl.sol#L408), [UserRegistry._authorizeUpgrade](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/registry/UserRegistry.sol#L106). Retained operational/admin permissions determine who can remove authority or change implementation.
- **S5:** [VerifiableFactory.verifyContract, lines 71–85](https://github.com/ensdomains/verifiable-factory/blob/c1090aec465ab30d494c96bd7d2a147b4f0b0173/src/VerifiableFactory.sol#L71). Factory-derived address reconstruction and returned implementation identity do not perform Solidity compilation or compare source to runtime bytecode.

| Question / selected policy | Exact tests in FinalArchitectureCorrectionsTest | Observed result and status |
|---|---|---|
| Actual label statuses/expiry | `testFinalReachableStatusExpiryCombinations`; `testFinalZeroExpiryUnavailableStatesAreNotReachableThroughVerifiedAPIs` (S1/S2/S3) | Untouched AVAILABLE/0; active REGISTERED/future; reserved RESERVED/future; past reservation AVAILABLE/positive; expired registered AVAILABLE/positive with retained latestOwner. Zero-expiry register/reserve/renew-to-zero paths reject. PROVEN within inspected APIs, positive pinned chain time and implementation; not across arbitrary upgrades/storage resets. |
| Defensive label guard | `testFinalDefensiveStatusExpiryMatrix`; `testFinalDefensiveZeroExpiryHistoryFieldsReject`; `testFinalRevokedAndRenewedReservationStatesRetainUseEvidence` | All five non-initial status/zero-or-positive-expiry combinations reject; AVAILABLE/0 with a retained owner or non-initial token/resource version rejects. Mocked inconsistent responses are defensive tests, **not observed reachable ENS states**. Actual revocation leaves positive use evidence; renewed burned state is RESERVED. PROVEN. |
| Expiry is denial, not burn | `testFinalExpiredOwnershipUnregisterAndAdministrativeRevival` (S1/S2) | At expiry, status AVAILABLE and getOwner/ownerOf zero, but latestOwner remains guest. Direct unregister and registrar revoke reject. Root RENEW restores same token ID/current guest ownership and test-oracle acceptance. Subsequent unregister burns; renewing burned state reserves rather than restores guest ownership. PROVEN. |
| Minimal registrar does not renew/clean expired tokens | `testFinalMinimalRegistrarCannotRenewExpiredCredential` | Exactly-4097 registrar lacks RENEW; direct simulated registry renewal rejects and registrar has no forwarding selector. No cleanup is needed for immediate expiry denial. PROVEN. |
| Optional atomic administrative destruction | `testFinalOptionalAtomicAdminCleanupBurnsExpiredResidualToken` | Owner-restricted **test-only** helper with RENEW + UNREGISTER renews then burns in one call; unauthorized helper call fails; later renewal cannot restore burned guest ownership. Not a production helper or approved transaction flow. PROVEN scoped demonstration. |
| Administrative trust boundary | `testFinalAdminDelegationCanDestroyRevocationGuarantee`; `testFinalRenewRemovalAndRegrantAreAdministratorChoices` (S4) | Delegated root admin can remove registrar/owner/self roles, emancipate R2 and defeat owner revoke. Removing RENEW alone denies renewal only until retained RENEW_ADMIN regrants it. Unconditional administrator-resistant revocation is not achievable in this selected permission model. Counterexamples PROVEN. |
| Implementation address/runtime distinctions | `testFinalFactoryVerificationIdentityAndRuntimeAreSeparate` (S5) | R1/R2 verify to expected implementation; actual implementation/factory codehash matches retained pinned hashes; ordinary registrar contract fails factory proxy verification; real issuance/revoke succeed. None proves reproducible source equivalence. Address/runtime behavior PROVEN; source-to-bytecode equivalence BLOCKED. |

### Label-state conclusion and correction

No reachable unavailable or previously used zero-expiry label was found through the inspected implementation's registration/unregister/renew APIs at positive Sepolia time. This conclusion follows from S1/S2 and the named fork tests, not from a suite total. It excludes malicious implementation/storage replacement, different registry instances and timestamp/counter-overflow scenarios outside the pinned profile. The expiry-only predicate had no demonstrated bypass within that scope; nevertheless it did not explicitly validate status or generation consistency.

`CredentialRegistrar.issue` now requires `status == AVAILABLE`, `expiry == 0`, `latestOwner == 0`, `tokenId == LibLabel.withVersion(labelhash,0)` and `resource == LibLabel.withVersion(labelhash,1)`. This selects a current initial registry entry. It is **not permanent historical uniqueness**; an administrator can change implementation/state or move to another registry. The pre-correction registrar source is saved under `corrections/prior-source/CredentialRegistrar.sol.txt` and matches the old run metadata's source hash.

### Concrete expired-credential policy

1. Natural expiry immediately fails the current-state authorization oracle. It is not revocation/burning. No cleanup transaction is required merely to deny access while expired.
2. Registrar `revoke` intentionally accepts only active REGISTERED credentials. It does not pretend to unregister an expired token and has no RENEW authority or forwarding API.
3. A trusted administrator can renew an expired, unburned credential, restoring the same guest and token generation. Valid current ancestry/attachments can then restore access. A “permanently expired even after admin renewal” guarantee is **BLOCKED** for this design. Any future need for that property must change reviewed permissions/implementation or policy; no local revocation database will be added.
4. Optional residual-token destruction must combine administrative renewal and unregister atomically with caller/token checks. Separate transactions expose a revival interval. Only the test-only helper demonstrates the mechanism; a production cleanup mechanism remains NOT IMPLEMENTED and requires separate architecture approval.
5. Burned-token renewal alone does not restore the guest, but an administrator may later register/allocate a name again. Neither burning nor the registrar's current-state reuse guard establishes immutable historical denial against administrators.

### Revocation readiness and administrator actions

The exact-read deployment/issuance/revocation checklist is in `PHASE3C_DEPLOYMENT_READINESS.md`. Necessary active revocation conditions are: configured owner can invoke the registrar, R2 still verifies to the expected implementation, its relevant runtime behavior remains reviewed, the request identifies the current active token generation, and registrar retains UNREGISTER. Production `revoke` checks implementation/state/generation and UNREGISTER; additional administrator/runtime inventory is a deployment-readiness obligation, not an invented onchain invariant.

Explicit invalidators: removing registrar UNREGISTER; delegating corresponding admin powers to an adversary; dropping all recovery rights; incompatible upgrades; unavailable/reverting ENS dependencies; or loss/compromise of configured owner control. RENEW can independently revive natural expiry; direct REGISTRAR/REGISTER_RESERVED operations can bypass application policy. Ancestor expiry/detachment blocks issuance but does not itself remove cleanup authority over active credentials in original R2.

### Four distinct verification claims

| Assurance | Evidence | Status |
|---|---|---|
| Matching interface signatures | Pinned source comparison, including documented metadata/mask differences; actual named API calls compile and pass | PROVEN for consumed surface only |
| Matching implementation address | Factory `verifyContract(R1/R2)` returns reviewed UserRegistryImpl; S5 describes mechanism | PROVEN at tested fork state |
| Verified runtime identity/behavior | `pinned-chain.json` hashes, direct codehash assertions and individually named behavioral tests | PROVEN for those hashes/scenarios only |
| Reproducible source → deployed bytecode | No exact compiler standard input/dependency closure/immutable and metadata reconciliation/build comparison was produced | **BLOCKED — not PROVEN** |

The factory does not certify source equivalence. Same implementation address is not by itself a hash check, and matching a recorded runtime hash is not a compiler reproduction. These remain separate even though the pinned tests all pass.

### Correction regression evidence and final state

Exact commands and final code/log hashes are in `evidence/stage3c/corrections/run.json`:

```sh
forge test --root contracts --match-path 'test/stage3c/*' \
  --match-test 'test(Security|Registrar|Final)' --threads 1 \
  --fork-url https://sepolia.gateway.tenderly.co --fork-block-number 12071220 \
  --fork-retries 3 --fork-retry-backoff 500 -vv

forge test --root contracts --threads 1 \
  --fork-url https://sepolia.gateway.tenderly.co --fork-block-number 12071220 \
  --fork-retries 3 --fork-retry-backoff 500 -vv
```

Actual focused result: **45 passed / 0 failed / 0 skipped; exit 0**. Actual full result: **182 passed / 0 failed / 0 skipped; seven suites; exit 0**. The full total includes inherited tests (FinalArchitectureCorrectionsTest has 11 new + 25 inherited); it does not imply 182 independent security properties. Neither correction run failed. All earlier failure logs, prior successful logs, prior metadata and prior checksums remain unchanged; new evidence uses a separate correction directory and checksum manifest.

Remaining blockers: live deployment readiness/address/account/role inventory, reproducible source-bytecode equivalence, and any proposed administrator-resistant permanent-expiry/uniqueness/invalidation guarantee. Optional production expired-token cleanup is not implemented. Scope remains registrar correction and verification only. Architecture approval is pending; no commit, signing or Sepolia write is authorized or performed.
