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
