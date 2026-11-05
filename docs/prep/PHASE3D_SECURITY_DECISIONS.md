# Stage 3D — DoorKeys architecture and security decisions

Pre-implementation record, 2026-11-06 (Asia/Kolkata). Verified clean checkpoint: `27c5883d2e11948f6baaef411729f8f719ed8e31`. Stage 3B/C contracts, tests, security decisions, deployment-readiness checklist and retained evidence were inspected; their source/evidence checksums verified. No production implementation existed when this record was created.

## Scope and mandatory architecture gates

Implement only immutable door configuration plus a door-wide successful-request counter. Authorization comes exclusively from current ENSv2 reads. No guest allowlist, wallet/name index, guest generation database, signature cache or backend is introduced. Trusted registry administrators can revoke roles, renew/reissue names or change implementations. These powers are not assumed away or prevented by a local list.

| Decision | Exact pre-implementation evidence | Selected behavior / assurance boundary |
|---|---|---|
| Full forward hierarchy | Stage 3B `_accept`, ownership/attachment/generation tests; Stage 3C registrar `_requireHierarchy` and its pinned tests | Check RootRegistry `eth` → ETHRegistry; root name → immutable R1; R1 `lock` → immutable R2. Canonical `getParent()` metadata is not authorization. |
| Ancestor validity | Stage 3B `testRootExpiryBoundaryWithAlignedDescendants`, lock boundary/owner/generation tests; Stage 3C current source | Both root and lock REGISTERED; expiry > now; lock expiry ≤ root expiry; current owners equal configured administrator; token IDs equal constructor snapshots. Conservative token binding rejects role churn as well as re-registration. |
| Current guest identity | Stage 3C corrections `testFinalExpiredOwnershipUnregisterAndAdministrativeRevival`; linked PermissionedRegistry `getState`, `getOwner`, `_constructStatus` | Credential REGISTERED, expiry > now and ≤ lock/root expiry, current `getOwner(labelhash) == msg.sender`. Never accept a supplied guest address, operator identity or `tx.origin`. |
| Zero-role profile | PermissionedRegistry `roles` and `roleCount` (lines 393–409), EAC roleCount; Stage 3B/C zero-bitmap and operator tests | Require entire credential resource roleCount == 0 (all assignees), caller's R2 root-role bitmap == 0 and R2 unemancipated. Do not use the stale vendored emancipation mask. DoorKeys itself receives no ENS role and changes no ENS state. |
| Implementation identity | Stage 3C source comparison, pinned code hashes and `testFinalFactoryVerificationIdentityAndRuntimeAreSeparate`; factory `verifyContract` | Verify R1/R2 via the known factory to the reviewed UserRegistryImpl before authorization. Address verification and observed behavior do not prove reproducible source-to-bytecode equivalence. That live-deployment gate remains BLOCKED. |
| Reuse/renewal | Stage 3C `testFinalExpiredOwnershipUnregisterAndAdministrativeRevival`, revoke/reuse probes | A new zero-role credential may authorize its current owner after administrator reissue; the old owner fails. Administrative renewal may restore the same guest if every current check passes. Renewing beyond ancestors or retaining roles fails. No permanent historical denial guarantee. |
| Restored attachments/owners | Stage 3B restoration and Stage 3C registrar restoration tests | Current-state policy: restoring exact original path and owner, without ancestor token changes, can restore authorization. An epoch constant does not detect intervening changes. Replaced path/current wrong owners/stale ancestor token IDs reject. |
| Callback/reentrancy | Verified interfaces declare every consumed external method `view`; DoorKeys design performs no ERC1155 mint/transfer, Ether send or receiver callback | External reads compile to STATICCALL. No guest-controlled mutable callback is invoked. Validate all reads before incrementing nonce/emitting. Reentrant static execution cannot persist nonce/logs; unexpected revert, malformed return or gas exhaustion reverts the transaction. Verify runtime opcodes/tests after implementation. |
| Correct door and event | Local source-level construction below, with planned event decoding tests | Immutable identity includes Sepolia chain ID, DoorKeys address, root/lock label hashes, R1/R2, ancestor token IDs and caller-supplied deployment epoch. Distinct contracts/configurations produce distinct identities. Simulator must bind chain + emitter + doorId, not event signature alone. |

These gates establish an implementable current-state policy from named source/tests. No mandatory property requires permanent historical invalidation or administrator-resistant renewal denial. Those claims remain excluded; reproducible source-bytecode equality is still BLOCKED for live deployment, not represented as a passing architecture gate. Production implementation and its exact event checks remain UNVERIFIED until Stage 3D tests pass.

## Exact verified ENSv2 reads

Fixed Sepolia entrypoints are the same reviewed constants as CredentialRegistrar. Constructor inputs: administrator, root label, R1, R2, deployment epoch. Validate chain 11155111, nonzero administrator, contract R1/R2, distinct R1/R2 and normalized single-label root. Constructor snapshots current ancestor token IDs, validates full hierarchy and computes immutable doorId. Root/lock hashes are immutable; no configuration setters.

On every `unlock(string label)`:

1. Validate label using the registrar's ASCII 3–32 policy and chain ID.
2. `RootRegistry.getSubregistry("eth")` equals fixed ETHRegistry.
3. `Factory.verifyContract(R1)` and `(R2)` equal expected UserRegistryImpl.
4. `ETHRegistry.getState(rootLabelHash)` and `R1.getState(lockLabelHash)` supply status, expiry and token snapshots. Require REGISTERED and active; lock expiry ≤ root expiry.
5. `ETHRegistry.getOwner(rootLabelHash)` and `R1.getOwner(lockLabelHash)` equal configured administrator.
6. `ETHRegistry.getSubregistry(rootLabel)` equals R1; `R1.getSubregistry("lock")` equals R2.
7. `R2.getState(guestLabelHash)` supplies active credential token ID/resource/expiry; expiry ≤ lock expiry. `R2.getOwner(guestLabelHash)` equals `msg.sender`.
8. `R2.roleCount(credential.resource) == 0`, `R2.roles(R2.ROOT_RESOURCE(),msg.sender) == 0`, and `R2.isEmancipated() == false`.

No resolver address is used for identity. RENEW/REGISTRAR role retention is an administrator/deployment concern; revoking registrar permissions alone does not revoke a valid guest. DoorKeys does not claim to certify continuing owner revocability merely from `isEmancipated == false`.

## Door identity and simulator event contract

`doorId = keccak256(abi.encode(block.chainid, address(this), rootLabelHash, lockLabelHash, R1, R2, rootTokenId, lockTokenId, deploymentEpoch))`.

`DoorUnlocked(bytes32 indexed doorId, address indexed guest, bytes32 indexed credentialLabelHash, uint256 credentialTokenId, uint64 credentialExpiry, uint256 requestNonce)`.

Only successful authorization increments a door-wide nonce and emits the event. The counter is not a guest access list. Transaction hash, block hash/number, log index, emitter address and receipt status come from receipt metadata, not fabricated event fields. The simulator must pin chain 11155111, expected DoorKeys address and doorId/epoch, verify successful receipt and expected ABI, deduplicate transactionHash/logIndex, and wait a reviewed confirmation/reorg policy. Repeated valid unlocks are allowed and yield different nonces. Event is a request for the future simulated door, not proof of physical actuation. No listener/frontend/QR implementation is included.

## Source references

- [PermissionedRegistry](https://github.com/ensdomains/contracts-v2/blob/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/src/registry/PermissionedRegistry.sol): `getState`, `getOwner`, `roles`, `roleCount`, `isEmancipated`, `_constructStatus`, `_regenerate`.
- [VerifiableFactory.verifyContract](https://github.com/ensdomains/verifiable-factory/blob/c1090aec465ab30d494c96bd7d2a147b4f0b0173/src/VerifiableFactory.sol#L71).
- Vendored IRegistry, IPermissionedRegistry/IStandardRegistry/IEnhancedAccessControl, IVerifiableFactory and LibLabel; Stage 3C `source-comparison.json` records exact inspected upstream/local hashes and known mask/metadata differences.

## Validation and readiness

Pending implementation and named Stage 3D tests. Retain focused/full logs, any failures, source hashes and inventory only in new Stage 3D paths. No Stage 3B/C evidence changes. Synthetic test root remains separate from the approved but unregistered intended live root `nak-lokesh-20261105.eth`. No signing, deployment, broadcast or Git commit is authorized in this stage.

## Implementation report and verified behavior

`contracts/src/DoorKeys.sol` implements the policy above. Constructor configuration binds administrator, root label/hash, R1/R2, root/lock token snapshots and deployment epoch. Fixed Sepolia RootRegistry/ETHRegistry/factory/implementation addresses are the same reviewed constants used in CredentialRegistrar. The only mutable runtime operational state is `requestNonce`; constructor-set rootLabel has no setter. No ENS role is granted to DoorKeys, no ENS ownership is changed and no guest data is stored locally.

External mutating API is exactly `unlock(string calldata label)`. It uses actual `msg.sender`, not a supplied guest, token operator, resolver record or transaction origin. Registered status, positive remaining lifetime, ancestor expiry bounds, complete expected forward attachments, unchanged ancestor token IDs/owners, implementation addresses, zero token-resource role counts, zero caller root roles and unemancipated R2 are enforced before the event/counter update. Registrar role revocation alone is not credential revocation.

The consumed methods are all verified view methods: `getSubregistry(string)`, `verifyContract(address)`, `getState(uint256)`, `getOwner(uint256)`, `roleCount(uint256)`, `ROOT_RESOURCE()`, `roles(uint256,address)` and `isEmancipated()`. Their vendored signatures and inspected implementation semantics were checked against Stage 3C's pinned source comparison. No new ENS method signature was invented. getParent/resolver methods are intentionally absent from authorization.

### Named runtime proof table

All names below are new `DoorKeysTest` methods that instantiate the production DoorKeys. ENS state mutations occur only inside Forge's local fork. `_denied` checks revert/result, unchanged requestNonce and absence of every log from that DoorKeys emitter for every denial case; it bounds negative-call gas at 2,000,000. Mocked malformed reads/global links and the mutation probe are explicitly negative fault injection, not claimed live ENS behavior. No mocked guest list is used.

| Required behavior | Exact passing test(s) | Observed result |
|---|---|---|
| Valid Mira and event identity | `testDoorMiraUnlockEventAndDoorIdentity` | Valid Mira unlocks; one event from expected DoorKeys; exact signature, doorId, guest, labelhash, token ID, expiry and nonce decoded; second success increments nonce. ENS token owner unchanged and door has no ENS root roles. |
| Other wallet/operator rejection | `testDoorWrongWalletAndApprovedOperatorDenied` | Wrong wallet and approved ERC1155 operator cannot use Mira's credential; Mira still succeeds. |
| Revocation/missing/reserved | `testDoorRevokedMissingReservedDenied` | All reject without event or nonce increment. |
| Expiry at every level | `testDoorCredentialExpiryBoundary`, `testDoorAncestorExpiryAndBounds`, `testDoorRootExpiryWithAlignedDescendants` | Succeeds one second before relevant expiry; rejects at equality with still-aligned descendants. |
| Ancestor expiry bounds | `testDoorDescendantExpiryBeyondAncestorsDenied` | Guest expiry beyond lock rejects; lock beyond root rejects. |
| Detached/replaced R1/R2 | `testDoorDetachedReplacedR1Denied`, `testDoorDetachedReplacedR2Denied` | Both edge removals and replacements reject despite stale guest still existing. |
| Ancestor owner changes | `testDoorRootAndLockOwnershipChangesDeniedAndRestored` | Both wrong owners reject; restoring original owners without generation change permits current-state authorization. |
| Ancestor generations/role churn | `testDoorLockGenerationChangeDenied`, `testDoorRootGenerationChangeDeniedWithOtherwiseValidPath`, `testDoorAncestorRoleChurnDenied` | Old DoorKeys rejects changed token snapshots; explicit fresh DoorKeys accepts otherwise-valid renewed path. Root test leaves lock token unchanged to isolate root generation. |
| Guest owner/roles | `testDoorGuestOwnershipTransferAndRoleRequirements`, `testDoorGuestAndNonOwnerRoleAssigneesDenied` | Transfer-capable credential rejects due nonzero token roles; after transfer old/new callers still fail required checks. Any non-owner token-role assignee also causes denial, even when guest's own bitmap is zero. Removing roles restores current-state eligibility. Caller root privilege also denies. |
| Label reuse/current owner | `testDoorAdminLabelReuseFollowsCurrentOwnerAndEventGeneration` | After admin unregister/reissue, former owner rejects; current zero-role owner succeeds; event identifies the new token generation. No permanent label-ban claim. |
| Administrative renewal | `testDoorAdminRenewalRestoresOnlyValidCurrentState` | Expired name rejects; authorized renewal restores correct owner's valid access; wrong wallet still rejects; expiry beyond parent rejects. |
| Restored attachment policy | `testDoorRestoredAttachmentsFollowCurrentStatePolicy` | Each detached edge rejects; original edge restoration succeeds when other invariants remain valid. No history blacklist or automatic epoch update exists. |
| Emancipation/admin model | `testDoorEmancipationDeniedEvenIfGuestStillOwnsToken`, `testDoorRegistrarPermissionRevocationIsNotCredentialRevocation` | Emancipation denies; removing registrar permissions alone leaves a valid credential usable until its ENS state is revoked. |
| Unexpected ENS responses | `testDoorUnexpectedReadFailuresAndMalformedDataFailClosed`, `testDoorWrongChainAndGlobalAttachmentDenied` | Reverting/malformed registry data, failed factory verification, wrong implementation return, wrong chain and wrong global eth attachment all reject. |
| Correct door/independent counters | `testDoorDistinctContractsAndEpochsHaveDistinctIdentities` | Separate deployed DoorKeys addresses/configurations yield distinct IDs and independent counters; epoch readback is correct. Constructor source/formula explicitly includes epoch and generations. |
| Input/configuration validation | `testDoorInvalidLabelsAndConstructorInputs` | Empty/short/uppercase/dotted/hyphen-invalid/overlong labels reject; zero administrator, shared/no-code registry addresses and wrong ancestor owner reject construction. |
| Actual smart-wallet caller/no receiver hook | `testDoorUnlockDoesNotCallGuestReceiverOrChangeENS` | Actual ENS mint invokes contract wallet receiver once; wallet then disables hooks and calls production unlock successfully with no further callback. Token IDs, owner, token/root role counts stay unchanged. |
| Static read/reentrancy boundary | `testDoorStaticRegistryReadCannotMutateState` | Fault-injected getter attempts SSTORE during real typed registry STATICCALL; transaction fails, no storage mutation/event/nonce update. See compiler opcode verification below. |

### Callback and runtime opcode verification

Locally compiled executable DoorKeys runtime template (Solidity CBOR metadata removed) has **15 STATICCALL, 0 CALL/CALLCODE/DELEGATECALL/CREATE/CREATE2/SELFDESTRUCT, 1 SSTORE and 1 LOG4**. The single runtime storage-write opcode is used by requestNonce; the single event opcode is DoorUnlocked. `evidence/stage3d/runtime-opcode-verification.json` records template hash and counts. Immutable placeholders mean this template is not a hash of any specific deployed DoorKeys instance. It is also not an ENS reproducible-source comparison.

No mutable call/transfer to a wallet or registry exists on unlock. Registry calls execute in static context: a nested reentrant call cannot persist nonce changes or emit an unlock event. Unexpected read reverts, malformed ABI returns and out-of-gas revert the transaction. The smart-wallet test independently demonstrates no receiver callback. This does not claim every malicious registry can make progress or that read gas is bounded by the production contract; failure is denial, not a fallback authorization.

### Simulator event consumption contract

The emitted fields are fully tested by `testDoorMiraUnlockEventAndDoorIdentity`. The expected log emitter and chain must be configured separately. Transaction hash/block hash/log index/receipt status come from the actual receipt, not the event payload. No simulator is implemented here and its receipt confirmation/reorg/deduplication behavior is NOT VERIFIED. Consumers must not treat a mere event-signature match or a stale event from another DoorKeys instance as permission to actuate. Success denotes an authorized unlock request only.

## Commands, actual results and preserved history

Fork: **Sepolia 11155111, block 12071220**, hash `0x0da28eda62d82e725492bd61af1eac89a09379b6e407821a69d735cc4457739c`, matching Stage 3C's pinned runtime evidence. Future/live state is not inferred from this fork.

Final focused command:

```sh
forge test --root contracts --match-contract DoorKeysTest --match-test testDoor \
  --threads 1 --fork-url https://sepolia.gateway.tenderly.co \
  --fork-block-number 12071220 --fork-retries 3 --fork-retry-backoff 500 -vv
```

Actual final focused result: **26 passed / 0 failed / 0 skipped; exit 0**. The first 25-test run passed but its EOA-only no-callback check was strengthened to a real receiver wallet, and a tautological assertion was removed. The next 26-test run passed; the deliberately forbidden-static-write probe was then gas-bounded in the helper to avoid consuming the runner's full default allowance. Both intermediate passing logs remain retained; their intermediate test-source hashes were not captured, and they are not substituted for final-source validation. No compiler or test failure occurred in Stage 3D; failure history is explicitly empty, not suppressed.

Full regression command:

```sh
forge test --root contracts --threads 1 \
  --fork-url https://sepolia.gateway.tenderly.co --fork-block-number 12071220 \
  --fork-retries 3 --fork-retry-backoff 500 -vv
```

Actual result: **233 passed / 0 failed / 0 skipped; eight suites; exit 0**.

| Suite | Passing executions |
|---|---:|
| DoorKeysTest | 51 (26 new + 25 inherited Stage 3B) |
| CredentialRegistrarTest | 52 |
| FinalArchitectureCorrectionsTest | 36 |
| CredentialSecurityPreflightTest | 32 |
| ThreeLevelENSv2Test | 25 |
| ENSv2QuestionsTest | 15 |
| ClosureA3LiteTest | 20 |
| SepoliaDeploymentSmokeTest | 2 |

Counts include previously documented inherited executions, not 233 unique security properties. Production and test hashes, exact commands, result counts, prior-run history and initial architecture hash are in `evidence/stage3d/run.json`. `architecture-before-implementation.md` preserves the initial architecture record. All new evidence is checksummed separately; no Stage 3B/C source, report, log, metadata or checksum manifest is edited.

## Security disposition and remaining limits

The named current-state authorization gates are PROVEN for the inspected APIs and pinned scenarios. DoorKeys is ready for architecture review, **not approved for commit or deployment**. No source-bytecode assurance or simulator behavior is inferred from the suite total.

- Trusted administrators can renew/reissue credentials, alter roles or restore paths/ownership. Restored current valid state may unlock. A revoked credential remains denied until an authorized new valid ENS state exists. Permanent historical invalidation, permanent expiry and immutable guest identity across reissue are not promised.
- Ancestor token IDs change with role churn as well as re-registration; an old DoorKeys then denies until explicitly replaced with a reviewed new deployment/configuration. Guest token role changes may regenerate guest IDs; there is no local guest-generation snapshot, so a presently zero-role/current-owner credential can be valid again.
- Unemancipated R2 is an enforced profile condition, not a certificate that a particular administrator can always revoke. The Stage 3C trust/role inventory and current implementation requirements still apply. An administrator has no implicit unlock bypass; it needs an actual qualifying ENS credential like any other caller.
- Reproducible source-to-ENS-bytecode equivalence remains **BLOCKED**, as do live deployment until the Stage 3C readiness checklist, fresh addresses/accounts/roles/gas estimates and explicit transaction approval are complete.
- The intended live root `nak-lokesh-20261105.eth` is not registered by this stage. Tests use `nak3b-fixture-12071220.eth`; no live ownership or availability is implied.
- No frontend, QR generator, door simulator, signer, private-key handling or deployment script is implemented. No onchain transaction, push or Git commit occurred. Stop for architecture review and owner approval.

## Created-file inventory

- `contracts/src/DoorKeys.sol`
- `contracts/test/stage3d/DoorKeys.t.sol`
- `docs/prep/PHASE3D_SECURITY_DECISIONS.md`
- `docs/prep/evidence/stage3d/SHA256SUMS`
- `docs/prep/evidence/stage3d/architecture-before-implementation.md`
- `docs/prep/evidence/stage3d/focused-final-pass.log`
- `docs/prep/evidence/stage3d/focused-initial-25-pass.log`
- `docs/prep/evidence/stage3d/focused-receiver-probe-26-pass.log`
- `docs/prep/evidence/stage3d/full-pass.log`
- `docs/prep/evidence/stage3d/git-status.txt`
- `docs/prep/evidence/stage3d/run.json`
- `docs/prep/evidence/stage3d/runtime-opcode-verification.json`

Previously tracked files modified: none. All changes remain untracked and uncommitted.
