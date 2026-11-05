> **Reconciliation note — 2026-11-04 (Phase 1.5):** This file is the historical Stage 0 snapshot. Its NO-GO decision concerned product implementation at that time; the later Part A audit's CONDITIONAL GO was limited to a static Part B scaffold. Neither authorizes Stage 2/3 or production work. Q8's specific owner-recovery result is recorded in `contracts/spike-output-before-closure.log` as a local-fork artifact; the exact initializer bitmap remains unverified, and `contracts/spike-output.log` contains no Q8 result lines. The real-Sepolia runbook warning remains applicable to live execution. See [`docs/prep/DOC_RECONCILIATION.md`](docs/prep/DOC_RECONCILIATION.md) for detail.

# Names as Keys — ENSv2 Stage 0 spike

This file is the historical Stage 0 evidence snapshot. Stage 1 Part A closure outcomes reported later by the user are summarized in [`docs/closure-evidence.md`](docs/closure-evidence.md) and audited in [`docs/stage-1-part-a-final-audit.md`](docs/stage-1-part-a-final-audit.md); those later results supersede the pending A4–A6 statements below, but do not change this original Stage 0 log.

**Status: Stage 0b fork suite complete; NO-GO for access-control product implementation.** The checked-in interfaces are from `ensdomains/contracts-v2` tag `sepolia-deployment-2026-09-15`, commit `f2f0a05e6c1711134b73204a1e37f8e6c1aea6ab`; see [`contracts/src/ens-vendored/VENDOR.txt`](contracts/src/ens-vendored/VENDOR.txt). Deployment values below come from the official [ENS deployments page](https://docs.ens.domains/learn/deployments/), Sepolia ENSv2 section.

## Results

| Question | Result | Evidence / limitation |
|---|---|---|
| Q1 Parent registration and owner lookup | **PASS** | Sepolia fork registered a fresh one-year `.eth` parent with commit/reveal. MockUSDC base/premium: `8000021` / `0`; MockDAI: `8000020944000000000` / `0`. Getters returned minimum duration `2419200`, minimum commitment age `60`, maximum age `86400`. Owner/token ID assertions passed. |
| Q2 UserRegistry proxy and parent subregistry | **PASS** | `VerifiableFactory.deployProxy` initialized UserRegistry with owner root grants; parent owner attached it using `setSubregistry`. `grantRoles(ROOT_RESOURCE,...)` reverted `EACRootResourceNotAllowed`; working root APIs were `grantRootRoles` and `revokeRootRoles`. |
| Q3 Registrar permissions and registration | **PASS** | Registrar with root bitmap `4097` (`ROLE_REGISTRAR | ROLE_UNREGISTER`) registered `mira` with token bitmap zero. Owner, token ID, expiry, and zero/nonzero resolver assertions passed. |
| Q4 Read-side unlock check | **PASS, with parent-expiry defect below** | Child state was `REGISTERED` (`2`), expiry future, owner guest; `canUnlock(guest)` true and stranger false. After child expiry, Q5 returned false. This check omits expired parent state. |
| Q5 Expiry and grace | **PASS** | After child expiry, status `AVAILABLE` (`0`), `getOwner` zero, `getExpiry` retained its prior value, `latestOwner` retained guest, unlock false, and re-registration succeeded immediately. |
| Q6 Revoke/re-register | **PASS** | Unregister yielded `AVAILABLE`, zero current owner, retained expiry. Same label/same owner re-registration succeeded; same label/different owner reverted selector `0xdef545a4`; a different label registered successfully. |
| Q7 Non-transferability and guest restrictions | **PASS (observed calls)** | With empty token bitmap, safe single/batch transfers reverted `0x54838f98`; unsafe single/batch transfers reverted decimal selector `3851382106`; setters, unregister and renew reverted `0x4b27a133`. Parent owner successfully set resolver/subregistry, renewed and unregistered. Safe-transfer error is `TransferUnsafeUntilRegistryIsEmancipated()`, so it alone does not establish the bitmap as the cause. |
| Q8 Kill switch / compromised registrar | **PASS** | Parent owner with registrar/unregister admin rights revoked registrar root roles. Registrar register/unregister then reverted `0x4b27a133`; owner direct unregister succeeded and status became `AVAILABLE`. |
| Q9 Resolution and ethers v6 | **PARTIAL** | PermissionedResolver proxy accepted `setAddress`; Sepolia Universal Resolver forwarded `addr(bytes32)` and returned the guest address. The prepared ethers v6 `provider.resolveName()` script was not executed because ethers/tsx could not be installed; that provider path is **UNKNOWN**. |
| Q10 Gas | **PASS (Foundry measurements)** | Parent register `253351`; proxy deploy `204950`; parent attach `62530`; subname register `131516`; canUnlock internal measurement `29765`; unregister internal measurement `80780`. Foundry suite report canUnlock min/avg/max `20030/22000/22500`; register `39918/111327/128570`; unregister `48282/68925/75807`. |
| Q11 Rules and events | **PASS, with error-name unknown** | `MiRa` and `mira!` accepted; 256-byte label reverted selector `0xdab6c73c` (name unidentified); expiry equal to now reverted `CannotSetPastExpiry(uint64)` (`0xf1d446c3`); now+1 accepted. Registration, renew, unregister topics were recorded: `LabelRegistered`, `TransferSingle`, `TokenResource`, `ExpiryUpdated`, `LabelUnregistered`. A child expiring after parent expiry remained `REGISTERED` and `canUnlock` returned true after parent became `AVAILABLE`. |

## Deployment addresses

Every address in the deployment manifest has the official ENS deployments page as its source. The manifest is [`contracts/deployments/sepolia.json`](contracts/deployments/sepolia.json). Addresses directly needed by the proposed flow:

| Contract | Sepolia address |
|---|---|
| ETHRegistry | `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` |
| ETHRegistrar | `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3` |
| Upgradable Universal Resolver proxy | `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe` |
| VerifiableFactory | `0xda70306c98e97ece36f997a21368e53298572991` |
| UserRegistry implementation | `0x9bd8a88719068d09ecee662f36c0e3856708366a` |
| PermissionedResolver implementation | `0x115eb53f0c60696633855f90b138178fb40b2b2c` |
| PublicResolverV2 | `0xdc4a563d00f5c3012b699794eb9e13a561be386f` |
| MockUSDC | `0x240b0316df57887dbbe58b586508b19e633a14aa` |
| MockDAI | `0xf6fac8a58a0be13b9197f27c41b73162fe32572b` |

ENS docs list `UserRegistryImpl` and `PermissionedResolverImpl` at these addresses. No assumption is made that those addresses stay stable; verify against the official page immediately before any real deployment.

## Confirmed source signatures and roles

From the vendored interfaces copied at the tag/commit above:

```solidity
IETHRegistrar.makeCommitment(string,address,bytes32,IRegistry,address,uint64,bytes32)
IETHRegistrar.commit(bytes32)
IETHRegistrar.register(string,address,bytes32,IRegistry,address,uint64,IERC20,bytes32)
IStandardRegistry.register(string,address,IRegistry,address,uint256,uint64)
IStandardRegistry.unregister(uint256)
IStandardRegistry.setSubregistry(uint256,IRegistry)
IStandardRegistry.setResolver(uint256,address)
IStandardRegistry.getExpiry(uint256) returns (uint64)
ITemporalRegistry.findExpiry(string) returns (uint64)
IPermissionedRegistry.getState(uint256) returns (State)
IPermissionedRegistry.getOwner(uint256) returns (address)
ITokenizedRegistry.findTokenId(string) returns (uint256)
IVerifiableFactory.deployProxy(address,uint256,bytes) returns (address)
UserRegistry.initialize(Grant[])
```

Role bitmaps from `RegistryRolesLib.sol`: `ROLE_REGISTRAR = 1<<0`; `ROLE_REGISTER_RESERVED = 1<<4`; `ROLE_SET_PARENT = 1<<8`; `ROLE_UNREGISTER = 1<<12`; `ROLE_RENEW = 1<<16`; `ROLE_SET_SUBREGISTRY = 1<<20`; `ROLE_SET_RESOLVER = 1<<24`; `ROLE_CAN_TRANSFER_ADMIN = 1<<28` (admin-only transfer control). Each admin role is its regular role shifted left by 128 bits. The registry owner/operator should retain corresponding admin roles if it expects to revoke or replace a registrar. The exact initializer bitmap and whether the owner can exercise the intended kill switch are **not verified**.

## Real Sepolia runbook (source-derived; not executed)

1. Check the official deployment page and confirm the ETHRegistrar, ETHRegistry, factory, implementation, resolver, accepted payment token, and current registration price/minimum duration.
2. Choose an available parent label; query `isAvailable(label)` and `getRegisterPrice(label,duration,paymentToken)`.
3. Create a random 32-byte secret. Call `makeCommitment(label, owner, secret, address(0), resolver, duration, bytes32(0))`, then `commit(commitment)`.
4. Wait at least `MIN_COMMITMENT_AGE` (ENS docs currently state 60 seconds, and commitment validity is bounded by `MAX_COMMITMENT_AGE`). Approve the ETHRegistrar for base plus premium on the selected payment token, then call `register` with the exact committed arguments.
5. Confirm ownership and capture token ID. Deploy the UserRegistry proxy through VerifiableFactory, encoding `initialize(Grant[])`. The tested owner grant included registrar/unregister and their admin roles; registrar root bitmap was `4097`.
6. Call `setSubregistry(parentTokenId, userRegistryProxy)` from an account authorized on the parent name. Grant SpikeRegistrar `ROLE_REGISTRAR | ROLE_UNREGISTER` on the subregistry `ROOT_RESOURCE`; preserve admin authority for the parent owner/operator.
7. Register a short-lived guest label using the intended zero token role bitmap, then confirm owner, state, expiry, role access, resolver behavior, revoke behavior, and gas with the tests before using this pattern for access control.

This is not a safe-to-execute transaction recipe: the observed parent-expiry behavior leaves a child unlock active after parent expiry.

## Architecture verdict

**NO-GO for product implementation.** Q8 owner revocation and recovery passed on fork. However, a child can outlive its parent: after parent expiry, parent state was `AVAILABLE` (`0`), child state remained `REGISTERED` (`2`), and child-owner `canUnlock` returned true. This defeats ancestor-bounded access lifetime. Before implementation, the access check must validate parent/ancestor state and expiry, or child expiry must be capped and enforced against parent expiry. Ethers v6 `provider.resolveName()` and the 256-byte label error name also remain unverified.

## Evidence and execution limits

`forge build` succeeded with Foundry (`solc 0.8.25`). The complete command was `SPIKE_VERBOSITY=-vv ./scripts/run-spike.sh` from `contracts/`; it loads ignored `.env` and redacts endpoint output. Final result: 13 passed, 0 failed, 0 skipped (2 smoke tests plus Q1–Q11). Chain ID preflight returned `11155111`. Results are in `contracts/spike-output.log`; tests are in [`contracts/test/spike/ENSv2Questions.t.sol`](contracts/test/spike/ENSv2Questions.t.sol), and the runner is [`contracts/scripts/run-spike.sh`](contracts/scripts/run-spike.sh). `contracts/scripts/resolve-test.ts` is prepared but not executed for ethers v6 `provider.resolveName()`.

The suite creates a fresh parent label per test and runs against the Sepolia fork configured in the ignored `.env`. No private keys are stored here. The `provider.resolveName()` check remains pending because the required JS packages were unavailable.
