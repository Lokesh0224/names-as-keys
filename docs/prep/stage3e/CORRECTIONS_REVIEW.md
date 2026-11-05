# Stage 3E final corrections: proof and ABI review

**Preparation checks PASS; Stage 3F remains NO-GO. No commit or live write authorized.** Production contracts and all 211 previously tracked files remain unchanged against checkpoint `d3fd2cce7ac75a76810202a7a83de40fe5c2fe32`.

## Role result

The original documented ETHRegistrar registration bitmap was already correct: `97409655027181761882228017414928043058140282880`. The correction adds executable evidence rather than changing privileges. The retained deployment-linked source defines the file-level constant; the ABI has no getter for it. `encoding_audit.source_roles()` evaluates the exact source expressions with a restricted AST evaluator. `test_registration_bitmap_source_document_manifest_and_fork_assertion_agree` links that value to the checklist, manifest and Solidity assertion. `testStage3ERegistrationAndInitializationRoleReadback` observes actual deployed behavior after synthetic registration on Sepolia fork block **12071220**, then asserts root, R1, R2, lock and guest permissions.

Observed root roles: `97409655027181761882228017414928043058140282880`; R1/R2 initial owner root roles: `380593917518227438537563280301172632627253505`; lock roles: `91700664256357922357994873537130062512592519168`; guest token roleCount: zero. Initializer policy remains operations bits 0,8,12,16,20 plus their 128-shifted admins; lock remains SET_SUBREGISTRY, SET_SUBREGISTRY_ADMIN, CAN_TRANSFER_ADMIN. No upgrade roles or guest rights added. The fork fixture is isolated (`nak3b-fixture-12071220`); it does not own or register `nak-lokesh-20261105.eth` live.

Source evidence: the unchanged `ens-standard-input.json` contains the full deployment-linked source closure, with ETHRegistrar lines 18–23 and registration lines 151–158, RegistryRolesLib lines 34–47, PermissionedRegistry lines 499–506, UserRegistry lines 58–68, EnhancedAccessControl lines 270–286 and UUPSProxyLogic lines 54–55. Relevant excerpts and final source/checksum inventory are retained in corrections evidence. The prior template reproduction is not a substitute for complete runtime/immutable attestation.

## Four distinct validation layers

1. **ABI signatures and types: PASS** for all fifteen transactions, both constructors and the nested `initialize((address,uint256)[])` recipe. Recursive tuple fields/arrays, uint64 versus uint256 range checks, exact bytes32 lengths, 20-byte addresses, specific future/receipt/account bindings and exact event signatures/indexed fields are checked. Amounts/bitmaps are decimal strings or exact Python integers, never floating point. Binding paths such as `salts.R1` and `encoded.initializeOwnerGrants` are logical future-workflow references, not present execution values.
2. **Offline encoding: PARTIAL/PASS for known values only.** Twenty-one known manifest scalar arguments are encoded with local `cast abi-encode` and compared to an independent reference encoder. T07's known argument vector is tested including dynamic string offset/padding, but final calldata is null because R1's target is unresolved. Nested initializer → factory `bytes` encoding is compared to independent tuple-array/offset/padding construction with explicitly TEST-ONLY account and salt. That verifies the encoding recipe, not final production inputs. No fixture address/salt is substituted into the manifest.
3. **Fork simulation: NOT RUN for the manifest.** The focused synthetic role test proves specific deployed registrar/factory/registry role behavior at the pinned block. It is not a simulation of these fifteen transactions with live owner/guest, future addresses and current prices.
4. **Future live-state execution: BLOCKED.** Complete source/runtime verification, public owner/guest accounts, balances, exhaustive ENS role history/readbacks, fresh availability/quote/commitment timing, actual salts, all addresses and timestamps, exact gas/fee simulation and separate explicit authorization are required. No wallet signatures or RPC writes occurred.

## Per-transaction audit

All final `calldata`, `gasEstimate`, hashes and receipts stay null. Owner/guest are unresolved public accounts. Registration secret must be generated privately only in a future authorized workflow; it is absent from shared artifacts. Fresh rent price remains unresolved despite the historical quote. Root/lock token IDs must be read from actual successful receipts/state, not predicted from a test fixture. Salts and lock/guest timestamps are intentionally unresolved. Constructors additionally require exact creation bytecode plus ABI-encoded arguments and a future deployment simulation.

| ID | Exact ABI signature (integer widths explicit) | Unresolved inputs/target | Required application event order |
|---|---|---|---|
| T01 | `mint(address,uint256)` | accounts.owner, quote.basePlusPremium | Transfer |
| T02 | `approve(address,uint256)` | quote.basePlusPremium | Approval |
| T03 | `commit(bytes32)` | registration.commitment | CommitmentMade |
| T04 | `register(string,address,bytes32,address,address,uint64,address,bytes32)` | accounts.owner, privateRegistrationState.secret | Transfer, LabelRegistered, TransferSingle, TokenResource, EACRolesChanged, NameRegistered |
| T05 | `deployProxy(address,uint256,bytes)` | encoded.initializeOwnerGrants, salts.R1 | Upgraded, RegistryCreated, EACRolesChanged, URIUpdated, Initialized, ProxyDeployed |
| T06 | `setSubregistry(uint256,address)` | future.R1, receipts.rootTokenId | SubregistryUpdated |
| T07 | `setParent(address,string)` | future.R1 | ParentUpdated |
| T08 | `register(string,address,address,address,uint256,uint64)` | accounts.owner, future.R1, inputs.lockExpiry | LabelRegistered, TransferSingle, TokenResource, EACRolesChanged |
| T09 | `deployProxy(address,uint256,bytes)` | encoded.initializeOwnerGrants, salts.R2 | Upgraded, RegistryCreated, EACRolesChanged, URIUpdated, Initialized, ProxyDeployed |
| T10 | `setSubregistry(uint256,address)` | future.R1, future.R2, receipts.lockTokenId | SubregistryUpdated |
| T11 | `setParent(address,string)` | future.R1, future.R2 | ParentUpdated |
| T12 | `constructor(address,string,address,address)` | accounts.owner, future.R1, future.R2 |  |
| T13 | `grantRootRoles(uint256,address)` | future.CredentialRegistrar, future.R2 | EACRolesChanged |
| T14 | `constructor(address,string,address,address,uint256)` | accounts.owner, future.R1, future.R2 |  |
| T15 | `issue(string,address,uint64)` | accounts.guest, future.CredentialRegistrar, inputs.guestExpiry | LabelRegistered, TransferSingle, TokenResource, CredentialIssued |

Verified address arguments must equal the recorded verified-address object, including ETHRegistry as R1's parent, UserRegistryImpl in both factory calls, MockUSDC for rent, and ETHRegistrar as allowance spender. R2 parent is future R1; root attachment is future R1; lock attachment is future R2; registrar grant is future CredentialRegistrar; both constructors use the same owner/root/R1/R2 ordering. T05/T09 use distinct salt bindings and the same restricted initialization recipe. T08's uint256 role bitmap and T13's 4097 grant are enforced. T04 duration is uint64; T08/T15 expiry is uint64; salts, IDs, role grants, amounts and DoorKeys epoch are uint256. No privilege broadening is accepted.

## Exact event review and remaining execution gate

The manifest records every required application event's full canonical signature, field names/types/indexed flags, emitter binding and required count. Previously omitted TransferSingle, TokenResource, EACRolesChanged, Upgraded, URIUpdated and Initialized events are now included where the reviewed source emits them. Event order is the required application-event subsequence; external LabelStore events/callback logs are **not** claimed to be exhaustively enumerated. The LabelStore implementation is outside the eight reproduced contracts. Exact receipt log inventory and all decoded values remain an execution gate; unexpected logs stop review. Registration recipients are assumed EOAs only after future account-code checks; contract-wallet ERC1155 callbacks are not implicitly approved.

Expected value reconciliation before future execution:

- T01 Transfer: zero → selected owner, exact reviewed mint amount. T02 Approval: owner → verified ETHRegistrar, exact bounded quote amount. T03 CommitmentMade: privately derived commitment only; never reveal the secret in this manifest.
- T04 MockUSDC Transfer: payer owner → observed BENEFICIARY, base+premium freshly quoted; LabelRegistered: exact root label/hash, actual token, selected owner, block-time+duration expiry, sender ETHRegistrar; TransferSingle: operator ETHRegistrar, zero → owner, same token, amount 1; TokenResource: same token and read-back resource; EACRolesChanged: same resource/owner, old zero → registration bitmap; NameRegistered: same root/owner/token, zero child/resolver/referrer, duration/payment token/base/premium exactly reviewed. Never assume expiry from wall-clock preparation time.
- T05/T09: Upgraded implementation equals verified UserRegistryImpl (emitted at the new proxy); RegistryCreated has no fields; EACRolesChanged ROOT_RESOURCE/owner 0 → restricted owner bitmap; URIUpdated empty URI, verified implementation URI_RENDERER, zero sender; Initialized version 1; ProxyDeployed sender owner, proxy equal prediction/readback, exact reviewed salt and implementation. Resolve URI_RENDERER and ROOT_RESOURCE from verified getters before final receipt review.
- T06/T10 SubregistryUpdated: actual current root/lock token, exact R1/R2 target, sender owner. T07/T11 ParentUpdated: expected ETHRegistry/root label or R1/lock, sender owner.
- T08: LabelRegistered lock/hash/actual token/owner/reviewed expiry/sender owner; TransferSingle operator owner, zero → owner, amount 1; TokenResource actual token/resource; EACRolesChanged old zero → exact lock bitmap. The available-unused fixture prerequisite excludes token burn/reuse events.
- T12/T14: no constructor events in the reviewed production code; require successful creation receipt, exact code and all configuration getters. Unexpected downstream logs still require inspection.
- T13: EACRolesChanged ROOT_RESOURCE/future registrar 0 → 4097. Any pre-existing roles invalidate the expected transition.
- T15: LabelRegistered mira/hash/actual token/selected guest/reviewed expiry/sender registrar; TransferSingle operator registrar, zero → guest, amount 1; TokenResource same token/resource; CredentialIssued same hash/token/guest/expiry. Zero role registration emits no EACRolesChanged (source early return). Verify no guest roles, resolver or child registry via current reads.

## Tests and retained evidence

`python3 -m unittest discover -s contracts/scripts/stage3e -p 'test*.py' -v`: **19 passed**, including known-field encodings, nested encoding, boundary rejection, binding/layout tampering and read-only RPC method restrictions. `forge test --root contracts --fork-url https://sepolia.gateway.tenderly.co --fork-block-number 12071220 --match-test testStage3ERegistrationAndInitializationRoleReadback -vv`: **1 passed, 0 failed**, with explicit bitmap readbacks. Existing production/fork suites were not rerun and their historical totals are not new evidence. Foundry reported only its missing optional Etherscan config warning.

Raw initial Stage 3E logs/checksums and all earlier tracked evidence are preserved. Edited initial preparation artifacts have pre-correction copies under corrections/prior; historical SHA256SUMS can be verified using those archived versions for changed paths. The initial read-only inspection had a Python SyntaxError; its failure note is retained, and corrected source inspection is in source-review.txt. Neither test run failed. Final command logs, formatting/whitespace/secret checks, complete untracked status, preservation verification and current checksum manifest are under corrections/.

Remaining blockers: complete runtime/immutable attestation; final accounts and permissions; unresolved values noted above; external LabelStore/callback and exact receipt-log review; fresh exact-state fork/gas simulation; independent architecture review and separately authorized execution. **Stage 3F remains NO-GO. Stop for architecture review; no stage/commit/deployment.**

Final-check history: the first untracked-file whitespace check detected spaces after line-number prefixes on empty lines in the newly generated source excerpt. Those derived prefixes were normalized; exact pre-fix bytes and checksum are retained in source-review-before-whitespace-fix.json, and the failed check/run are retained as validation-attempt1.log/json. No production source or raw test output was trimmed.

The second validation attempt caught trailing spaces generated by the temporary validation-summary writer itself. That writer was corrected; both failed run records and raw failed logs remain intact as validation-attempt1/2.json/log. A corrections-only .gitattributes rule exempts blank-at-eol for those two preserved raw logs only. All active scripts/reports and the regenerated final summary pass untracked whitespace checks; raw failure evidence was not rewritten.
