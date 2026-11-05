# ENSv2 error selectors

Selectors below were computed from declarations in the vendored tree with `cast sig`. A name match identifies the declared error, not why it fired. The generic unknown-error wording is retained. The target commit `07e55a05` source could not be fetched, so its declarations are not included.

## Observed selectors

| Selector | Matched error + source file:line | Where observed | Note |
|---|---|---|---|
| `0xdef545a4` | `LabelAlreadyRegistered(string)` — `IStandardRegistry.sol:18` | `SPIKE.md`, `docs/closure-evidence.md`, `contracts/spike-output-before-closure.log:217` (decimal `3740616100`) | Name match only. |
| `0xdab6c73c` | **UNKNOWN** | `SPIKE.md`, `contracts/spike-output-before-closure.log:64`, `docs/closure-evidence.md` | Observed with a 256-byte label attempt. Do not infer name or meaning. Generic fallback: “Unknown ENS error (selector 0xdab6c73c). A1 is open; do not infer the cause.” |
| `0x54838f98` (`1417908120`) | `TransferUnsafeUntilRegistryIsEmancipated()` — `IPermissionedRegistry.sol:61` | `SPIKE.md`, `contracts/spike-output-before-closure.log:239-240` | Selector match does not prove cause. |
| `0x4b27a133` (`1260888371`) | `EACUnauthorizedAccountRoles(uint256,uint256,address)` — `IEnhancedAccessControl.sol:34` | `SPIKE.md`, `contracts/spike-output-before-closure.log:243-246,268-269` | Selector match does not prove cause. |
| `0xe58f6d5a` (`3851382106`) | `TransferDisallowed(uint256,address)` — `IPermissionedRegistry.sol:57` | `SPIKE.md`, `contracts/spike-output-before-closure.log:241-242` | Selector match does not prove cause. |
| `0xf1d446c3` | `CannotSetPastExpiry(uint64)` — `IStandardRegistry.sol:30` | `SPIKE.md`, `contracts/spike-output-before-closure.log:65` | Selector match does not prove cause. |

## Vendored declaration inventory

| Selector | Error signature | Source file:line |
|---|---|---|
| `0x8d666f60` | `InvalidEVMAddress(bytes)` | `resolver/interfaces/setters/IAddressSetter.sol:22` |
| `0xf60759e0` | `LabelAlreadyReserved(string)` | `registry/interfaces/IPermissionedRegistry.sol:53` |
| `0xe58f6d5a` | `TransferDisallowed(uint256,address)` | `registry/interfaces/IPermissionedRegistry.sol:57` |
| `0x54838f98` | `TransferUnsafeUntilRegistryIsEmancipated()` | `registry/interfaces/IPermissionedRegistry.sol:61` |
| `0x677f1c18` | `TransferUnsafeWithMultipleAssignees(uint256,address)` | `registry/interfaces/IPermissionedRegistry.sol:65` |
| `0xdef545a4` | `LabelAlreadyRegistered(string)` | `registry/interfaces/IStandardRegistry.sol:18` |
| `0xc44e2374` | `LabelExpired(uint256)` | `registry/interfaces/IStandardRegistry.sol:22` |
| `0x68c1425a` | `CannotReduceExpiry(uint64,uint64)` | `registry/interfaces/IStandardRegistry.sol:26` |
| `0xf1d446c3` | `CannotSetPastExpiry(uint64)` | `registry/interfaces/IStandardRegistry.sol:30` |
| `0x0a059d71` | `UnexpiredCommitmentExists(bytes32)` | `registrar/interfaces/IETHRegistrar.sol:51` |
| `0x6be614e3` | `CommitmentTooNew(bytes32,uint64,uint64)` | `registrar/interfaces/IETHRegistrar.sol:55` |
| `0x0cb9df3f` | `CommitmentTooOld(bytes32,uint64,uint64)` | `registrar/interfaces/IETHRegistrar.sol:59` |
| `0x477707e8` | `NameNotAvailable(string)` | `registrar/interfaces/IETHRegistrar.sol:63` |
| `0xa096b844` | `DurationTooShort(uint64,uint64)` | `registrar/interfaces/IETHRenewer.sol:46` |
| `0x1caefaa0` | `NameNotRenewable(string)` | `registrar/interfaces/IETHRenewer.sol:50` |
| `0x4b27a133` | `EACUnauthorizedAccountRoles(uint256,uint256,address)` | `access-control/interfaces/IEnhancedAccessControl.sol:34` |
| `0xd1a3b355` | `EACCannotGrantRoles(uint256,uint256,address)` | `access-control/interfaces/IEnhancedAccessControl.sol:37` |
| `0xa604e318` | `EACCannotRevokeRoles(uint256,uint256,address)` | `access-control/interfaces/IEnhancedAccessControl.sol:40` |
| `0xc2842458` | `EACRootResourceNotAllowed()` | `access-control/interfaces/IEnhancedAccessControl.sol:43` |
| `0xf9165348` | `EACMaxAssignees(uint256,uint256)` | `access-control/interfaces/IEnhancedAccessControl.sol:46` |
| `0x1f80c19b` | `EACMinAssignees(uint256,uint256)` | `access-control/interfaces/IEnhancedAccessControl.sol:49` |
| `0x2a7b2d20` | `EACInvalidRoleBitmap(uint256)` | `access-control/interfaces/IEnhancedAccessControl.sol:52` |
| `0xec3fc592` | `EACInvalidAccount()` | `access-control/interfaces/IEnhancedAccessControl.sol:55` |
| `0x4c87e2b6` | `VerificationFailed(address)` | `verifiable-factory/IVerifiableFactory.sol:8` |

The vendored OZ `IERC1155` interface declares no errors. Other inherited implementation dependencies not copied into this interface tree cannot be enumerated here. The observed `0x4c87e2b6` selector was not found in the specified evidence files.

## Unknown selector attempts and arithmetic checks

For `0xdab6c73c`, searched every vendored error declaration and the required sources (`contracts/spike-output-before-closure.log`, `contracts/spike-output.log`, `contracts/closure-test-attempt.log`, `SPIKE.md`, `docs/closure-evidence.md`); computed selectors for every declaration with `cast sig`; no signature matched. It remains **UNKNOWN**. `0xf1d446c3` was also explicitly scanned and does match `CannotSetPastExpiry(uint64)` above.

Cross-checks: `1417908120` = `0x54838f98`; `1260888371` = `0x4b27a133`; `3740616100` = `0xdef545a4`; `3851382106` = `0xe58f6d5a`. Inherited OpenZeppelin implementation errors outside the vendored copy were not available for enumeration.
