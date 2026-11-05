# Stage 3B — three-level ENSv2 fork verification

Date: 2026-11-06 (Asia/Kolkata). Status: implementation ready for architecture review; **uncommitted**. This follows the owner's latest, narrower instruction: fork fixture and verification only. No production CredentialRegistrar, DoorKeys, frontend, wallet signing, live registration, deployment or broadcast was implemented or performed. No automatic Stage 3C work.

## Hierarchy and scope

Approved intended live hierarchy remains:

`nak-lokesh-20261105.eth` → `lock.nak-lokesh-20261105.eth` → `mira.lock.nak-lokesh-20261105.eth`

The fork uses **`nak3b-fixture-12071220.eth`** instead of the intended live root, explicitly isolating the registration experiment. It asserts this synthetic label is available before registering. It never assumes the approved root is already registered and makes no new claim about its current live availability. The synthetic name is registered only inside Forge's local fork EVM.

Fixture sequence:

1. Assert fork chain ID 11155111; compute synthetic root label.
2. Compute commitment, commit locally, read minimum commitment age, warp past it, quote one-year rent, mint mock USDC locally, approve registrar, register root to fixture owner.
3. Factory-deploy R1 with explicit owner grants and verify implementation. Attach R1 to the root token in ETHRegistry; set canonical parent metadata on R1.
4. Register `lock` in R1 owned by fixture owner, initially with no subregistry.
5. Factory-deploy R2 with explicit owner grants; attach R2 to `lock`; set its canonical parent to R1 / `lock`.
6. Register `mira` in R2 to fixture guest, zero roles, zero resolver, zero subregistry.
7. Verify global RootRegistry → ETHRegistry, root → R1, lock → R2, both canonical parent records, all three owners, registration state and expiries.

Root duration is 365 days; lock expires after 90 days; mira after one day. Test accounts are address constants, with `vm.prank` for local caller simulation. No private keys, seed phrases or owner wallet accounts are used. Deterministic commitment secret generation is clearly test-only and must not migrate into a live registration flow.

## Files and execution evidence

Only new files are introduced:

- `contracts/test/stage3/ThreeLevelENSv2.t.sol` — independent fork fixture and 25 test functions; does not inherit historical spike test suites.
- `docs/prep/PHASE3B_VERIFICATION.md` — this report.
- `docs/prep/evidence/stage3b/foundry-full.log` — retained final full-run output.
- `docs/prep/evidence/stage3b/foundry-full.log.sha256` — log integrity checksum.
- `docs/prep/evidence/stage3b/run.json` — command, pinned block/hash, source/log hashes, chain ID, exit status and result counts.

Final full-run command (public credential-free endpoint):

```sh
forge test --root contracts \
  --fork-url https://ethereum-sepolia-rpc.publicnode.com \
  --fork-block-number 12071220 -vv
```

**Actual final result: exit 0; 62 passed, 0 failed, 0 skipped across four suites.**

| Suite | Passed |
|---|---:|
| ThreeLevelENSv2Test (new) | 25 |
| SepoliaDeploymentSmokeTest | 2 |
| ENSv2QuestionsTest | 15 |
| ClosureA3LiteTest | 20 |

ClosureA3LiteTest includes 15 inherited ENSv2Questions tests plus its five A3-LITE tests. Thus 62 is the count of executions, not 62 independent scenarios. The two transfer-matrix test functions internally execute 32 asserted cells.

Focused command used during development:

```sh
forge test --root contracts --match-path 'test/stage3/*' \
  --fork-url https://ethereum-sepolia-rpc.publicnode.com \
  --fork-block-number 12071220 -vv
```

Observed focused runs: first runtime run 16 passed / 1 failed (test-only prank/expectRevert ordering: `getResource` consumed the next call); corrected and expanded run 23 passed / 0 failed. The final expanded 25-test suite passed in the full run above. An initial compiler attempt rejected a mistyped address checksum; corrected to Solidity's expected checksum. No protocol behavior was altered to force a pass.

Formatting check, from `contracts/`: `forge fmt --check test/stage3/ThreeLevelENSv2.t.sol`. This check and whitespace/integrity checks are separate from runtime tests. The earlier formatting check attempted from the repository root with a contracts-relative path failed to find the file; the correctly rooted check is authoritative.

Fork origin: chain 11155111, block 12071220, hash `0x0da28eda62d82e725492bd61af1eac89a09379b6e407821a69d735cc4457739c`. Time advances in individual tests, including beyond root expiry and grace; no live chain time or state is changed. RPC traffic only reads chain data. All baseline-tracked files, including Phase 2 source, audit documents and evidence, remain byte-identical to Git HEAD. Existing evidence logs were not overwritten by the old spike runner.

## Acceptance oracle and test coverage

`_accept(label, caller, requestedDoor)` is an internal **test oracle**, not a production authorization contract. It stores only fixture configuration and ancestor generation snapshots, never a guest list. It reads ENSv2 for every acceptance assertion:

- Reject zero caller or a door identifier different from the fixture's configured chain/contract/root/lock/registry/epoch identity.
- Require the global `eth` attachment to equal the expected ETHRegistry.
- Require root, lock and guest status REGISTERED and each expiry strictly greater than current time.
- Require guest expiry ≤ lock expiry ≤ root expiry.
- Require current root and lock owners equal the configured fixture owner.
- Require root and lock token IDs equal their configured snapshots.
- Require ETHRegistry's root attachment to equal R1 and R1's lock attachment to equal R2.
- Require R2's current guest token owner to equal the caller under test.

Covered cases include valid guest, missing/reserved credential, zero/wrong caller and wrong door; credential revoke and exact expiry boundary; lock and root exact expiry boundaries with aligned descendants; descendants outliving parents; root/lock transfer; same-owner root and lock re-registration; detach and replace R1/R2 while stale guest tokens still exist; metadata-only parent changes; per-operation role denial/recovery; registrar delegation and revocation; owner recovery; guest self-grant denial; role-driven token regeneration; approved/unapproved operators and owner/root-admin transfer attempts.

Root re-registration test waits through expiry plus registrar grace, registers to the same owner, restores the links and refreshes otherwise-expired descendants. It rejects the old root binding, then proves the remaining current state is valid by changing only the root snapshot in the test. Lock re-registration similarly checks rejection of an old snapshot and acceptance after an explicit test-only rebind. This avoids attributing a rejection solely caused by expired descendants to generation binding.

The attached diagram remains a reference for the future QR/door-specific URL → connected guest → unlock transaction → validated event → simulator flow. This verification stage exercises the registry decision only. There is no QR route, event emitter/listener, `msg.sender` entrypoint, MetaMask workflow or simulated door implementation in these changes. Those need later architecture review; the test's caller argument must never become a trusted caller-supplied guest address in production.

## Exact ENSv2 methods exercised

| Area | Methods |
|---|---|
| Root registration | `isAvailable(string)`, `makeCommitment(string,address,bytes32,IRegistry,address,uint64,bytes32)`, `commit(bytes32)`, `MIN_COMMITMENT_AGE()`, `getRegisterPrice(string,uint64,IERC20)`, `register(string,address,bytes32,IRegistry,address,uint64,IERC20,bytes32)`, `GRACE_PERIOD()` |
| Mock payment | `mint(address,uint256)`, `approve(address,uint256)` |
| Proxy creation | `deployProxy(address,uint256,bytes)` with `initialize((address,uint256)[])`; `verifyContract(address)` |
| Registry lifecycle | `register(string,address,IRegistry,address,uint256,uint64)`, `unregister(uint256)`, `renew(uint256,uint64)` |
| Attachment and metadata | `setSubregistry(uint256,IRegistry)`, `getSubregistry(string)`, `setParent(IRegistry,string)`, `getParent()` |
| State / identity | `getState(uint256)`, `getOwner(uint256)`, `getExpiry(uint256)`, `getTokenId(uint256)`, `getResource(uint256)`, `ROOT_RESOURCE()` |
| Permissions | `roles(uint256,address)`, `hasRoles(uint256,uint256,address)`, `hasRootRoles(uint256,address)`, `grantRootRoles(uint256,address)`, `revokeRootRoles(uint256,address)`, `grantRoles(uint256,uint256,address)`, `revokeRoles(uint256,uint256,address)` |
| Transfer probes | `setApprovalForAll(address,bool)`, `isEmancipated()`, `safeTransferFrom(address,address,uint256,uint256,bytes)`, `safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)`, `unsafeTransfer(address,uint256,bytes)`, `unsafeBatchTransfer(address,uint256[],bytes)` |

The timing getter is represented by a test-only interface because it is absent from the vendored registrar interface. Successful calls verify this used surface against deployed fork bytecode, not complete ABI/source equivalence. No vendored interface was modified.

## Confirmed role requirements in this fixture

R1/R2 owner initialization uses only REGISTRAR, UNREGISTER, RENEW, SET_SUBREGISTRY and SET_PARENT plus their corresponding admin bits. It grants no upgrade powers. Exact root bitmap equality is asserted after factory initialization. Factory caller is the test contract; registry administrator is explicitly the fixture EOA.

| Operation | Confirmed permission and scope |
|---|---|
| Root attachment | Owner has SET_SUBREGISTRY on the root token's current resource; unrelated caller rejected |
| Register `lock` / guest | REGISTRAR on affected registry root; admin bit alone is insufficient |
| Revoke guest | UNREGISTER via registry-root override (or appropriate token permission); removing operational role blocks it |
| Renew guest | RENEW; removing it blocks renewal |
| Canonical parent | SET_PARENT on that registry's root; removing it blocks `setParent` |
| Change lock attachment | SET_SUBREGISTRY from lock resource or registry root; removing both scopes blocks attachment |
| Delegate/recover | Matching admin roles needed to grant/revoke operational roles; unrelated caller and operation-only delegate cannot grant |
| Minimal delegate | Exactly `REGISTRAR \| UNREGISTER = 4097` at R2 root can create and revoke; after revocation both operations fail, while owner can still revoke |
| Guest | Mira's token role bitmap is zero; guest cannot self-grant transfer-admin |

These are EAC role permissions, not a single global registry `owner()` field. The root-name ERC-1155 token owner and child-registry root-role administrator are distinct concepts. The fixture deliberately makes them the same EOA. Granting a contract registry permissions does not secure that contract's public entrypoints; a future registrar must independently restrict issuance/revocation callers.

## Transfer and emancipation results

Matrix: two registry states × two token bitmaps × two caller types × four transfer methods = **32 cells**. Caller is guest owner or its approved operator; methods are safe single, safe batch, unsafe single and unsafe batch. Batch cases contain one token. Token bitmaps are zero or CAN_TRANSFER_ADMIN (bit 156).

| Registry state | Token bitmap | Safe single/batch | Unsafe single/batch |
|---|---|---|---|
| Unemancipated | zero | revert | revert |
| Unemancipated | CAN_TRANSFER_ADMIN | revert | succeed |
| Emancipated | zero | revert | revert |
| Emancipated | CAN_TRANSFER_ADMIN | succeed | succeed |

Both guest and approved operator had the same outcomes in every tested cell. Failed attempts preserve owner; successful attempts change owner to the recipient. Unapproved operator attempts all fail even with a transfer-capable token. Fixture root administrator without guest approval also fails all four methods. A transfer-capable credential stops authorizing its old owner and starts authorizing its new ENS owner under the oracle.

Emancipation is established by revoking all initialized roles covered by `UNEMANCIPATED_ROLE_BITMAP`, including the corresponding override admin bits, then asserting `isEmancipated() == true`. It is **not** accomplished by a fictional `emancipate()` method. This removes fixture-owner UNREGISTER authority: revocation then reverts while the valid credential remains accepted. Retaining owner revocation is therefore a deliberate architecture choice, not compatible with blindly emancipating this fixture.

**No universal non-transferability claim.** Remaining untested paths include multi-token mixed-role batches, extra token-role assignees, smart-contract receivers/callbacks, different initialization/admin-role distributions, root administrators with additional transfer powers, changing role policy over time, alternate/upgraded registry implementations, expired-token transfers and all possible operator/permission combinations. The matrix closes its explicit 32 cells only; it does not declare the earlier A3 design universally complete.

## Security findings and review decisions

1. ENS registries allow independent child expiries. Runtime renewal beyond ancestors succeeds; the acceptance oracle rejects it. A future registrar must enforce bounds at issue/renew time, and DoorKeys must still validate each ancestor at unlock time.
2. ERC-1155 token IDs are not pure registration generations. A lock role revocation changes token ID while its EAC resource stays the same. Token-ID snapshots safely fail closed but can require rebinding after legitimate role changes. Architecture review must choose token ID vs registration resource binding and define safe reconfiguration.
3. Detachment is rejected in current state, including replacement with another registry while old guest state remains. Restoring the exact original attachment restores oracle acceptance. The Stage 3A wording that an old DoorKeys “stays invalid” after replacement is **not established by current-state path checks alone**. Permanent invalidation needs an explicit reviewed epoch/rebinding lifecycle; no local guest list should be added. An epoch constant alone cannot detect an intervening detach/reattach.
4. The same current-state limitation applies to an ancestor transferred away and back without a registration/role-generation change; this history is not tracked by the oracle. No permanent historical invalidation guarantee is claimed.
5. Emancipation removes owner override permissions and can disable credential revocation. Minimal owner-revocable credentials should preserve that authority unless the architecture explicitly changes.
6. Guest authorization follows current ENS token ownership. Non-transferability needs a scoped, enforced policy; a separate guest mapping is neither used nor proposed.
7. The oracle binds a supplied door ID for tests, but does not implement event security, transaction caller identity, rejection UX, reentrancy handling or fail-closed exception handling. Registry read reverts propagate. No production readiness claim follows from these tests.
8. Revoking registrar operational roles prevents future create/revoke actions; it does not automatically revoke existing credentials. Revocation of a credential is the registry lifecycle operation, not removal from an application list.

## Remaining blockers and proposed next stage

Architecture review should decide ancestor generation binding, acceptable effects of role changes, detach/reattach and transfer-back policy, retained owner overrides, and scoped transfer guarantees. The vendored/upstream source differences and full deployed implementation equivalence remain open despite the successful interface calls. Label reuse timing, unresolved historical selector `0xdab6c73c`, resolver/UI behavior, live approved-root availability, owner/guest public addresses and MetaMask deployment estimates remain outside this verification stage.

Proposed next stage, only after review and explicit authorization: implement the restricted registrar and DoorKeys with the approved lifecycle decisions, real `msg.sender` checks, door-bound event semantics, and further contract tests. Prepare QR/MetaMask/event workflow separately as authorized. Registration and deployment require their own explicit authorization and a concrete address/gas/confirmation manifest.

No Git staging or commit was performed. No tracked baseline file was changed. Wait for architecture review and explicit commit approval; do not automatically proceed.
