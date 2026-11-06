# Deployment candidate — approved static inputs, live execution disabled

HEAD baseline: `a23821d7fd8056c0ec473d67d18890e775a16f11`. The owner approved all six recommended default groups **for candidate preparation only**. Public owner `0x40F6DcB0Fa311570f72aC6F64045EB80E66711F7` and Mira `0x5a9191871b9117218F83Ed43293E011667053F39` were already supplied; no new wallet addresses or secrets are requested. `LIVE_EXECUTION_ALLOWED=false` is unchanged. Stage3F remains NO-GO.

## Recorded candidate decisions

| Decision | Approved candidate value | Practical consequence |
|---|---|---|
| Salts/epoch | R1 `0x21cb34c9e8dade33ad3f2c2359ba164ed8703d57de0d4fd707230785b00f9e39`; R2 `0x3818f62a943ba4836a0f0991d9ca1bdece7f4c9144862352aeb52a5c47accd95`; epoch1 | Public deterministic predictions, no fallback reuse; collision/receipt checks remain mandatory. |
| Registration preimage |32 CSPRNG bytes, memory-only; abandon a lost commitment | No wallet seed/key. Nothing persisted to logs/Git; a future live preimage is separate from disposable fork preimages. |
| Expiries |365-day root,90-day lock,one-day guest; identified review block,600s guest margin; ≤120s/2-block review age | Absolute uint64 expiry timestamps must be recomputed after actual ancestors exist; reject rather than clamp. |
| Rent | Exact fresh quote/deficit, capped8.1 MockUSDC; exact quote allowance | Any changed quote or balance/allowance changes the reviewed prefix/nonce plan. No unlimited allowance. |
| Gas/fees |120% estimate, ≤3M gas/step, maxFee≤2gwei, priority≤0.1gwei, total≤0.03ETH | Ceilings only; no live gas estimate has been promoted from the fork. |
| Confirmation/reorg |12 confirmations against latest, separately finalized receipt coverage; current state at identified latest block | Every prerequisite receipt and current state must be revalidated. No automatic retry/replacement. |

Canonical values/approval provenance: `APPROVED_INPUTS.json`. No further defaults decision is pending; future live authorization and independent review are separate requirements, not implied by this approval.

## Public predictions and remaining bindings

Snapshot Sepolia block **12073207**, hash `0x9b3982ff5b8e962aaa1e658583dc3f33e7e0e997be3228fd4fe7a331189ecf07`. Approved root `nak-lokesh-20261105.eth` was available and unowned at this snapshot; no live ownership/registration is implied. Fresh one-year rent quote: **8000021** MockUSDC units; balance/allowance snapshot required T01/T02. Starting owner nonce: **50**, equal to the pending nonce when observed. These values are time-sensitive and are not reserved.

| Contract | Public prediction | Condition |
|---|---|---|
| R1 | `0x9EeE3b2A2C47C458BCEfb475679330fC1C76bD4C` | Fixed reviewed factory/logic, exact owner caller and approved R1 salt; empty code checked. |
| R2 | `0x5D86d3AF67103091e3Ba85A77405c1074D394849` | Same requirements with approved R2 salt; empty code checked. |
| CredentialRegistrar | `0x4F5F652308F19386cEC8876f9B3F34385C5724A2` | CREATE nonce61: starting nonce50 plus the exact included prefix, no unrelated transactions or changed skips. |
| DoorKeys | `0x93ac7E046AcdE7BBFb3F5086775bcA5032c6c7e6` | CREATE nonce63 under the same exact prefix assumption. |

Factory predictions were independently derived from the pinned clone creation/runtime recipe and `keccak256(abi.encode(owner,userSalt))`, matched to factory RPC readbacks, and the proxy-logic runtime hash matched the retained whole-runtime proof. R1/R2 predictions do not depend on EOA transaction nonce. Direct CREATE predictions do. All four addresses must be verified from actual canonical live receipts/code before becoming confirmed bindings. No code existed at R1/R2 at observation; direct CREATE collision checks also run locally before simulated creation and must run again in live preparation.

`review-plan.json` resolves public static/snapshot inputs and encodes unsigned candidate calldata where known. It intentionally keeps **all finalCalldata/finalGasEstimate/liveReceipt fields null**. T03/T04 stay unencoded publicly because the future private preimage/commitment is not bound. T06/T10 need actual root/lock token IDs. T08/T15 need later absolute expiry timestamps. T12/T14 constructor input bytes are known with the predicted registry addresses, but constructor runtime immutable values still read actual ancestor generations during execution. T13 can only use the registrar prediction after the actual T12 receipt confirms it.

Later **live** receipt/state bindings required:

- T03 commitment timestamp and block/hash; strict min/max reveal window and fresh quote.
- T04 actual root token/resource/generation, owner and expiry; payment/events and canonical receipt.
- T05/T09 actual proxy addresses, complete runtime/implementation, initialization grants/counts and no unexpected assignees/operators.
- T08 actual lock token/resource/generation, owner and expiry.
- T12/T14 actual CREATE addresses, full runtime bytes/getters and matching ancestor snapshots; derive DoorKeys doorId from actual address/generations/epoch.
- T15 actual credential token/resource/expiry, zero roles and current owner; all hierarchy links remain valid.

Predictions/local receipt values are never silently substituted for these live records. Independent review and fresh nonce/price/runtime/role checks remain required before any request.

## Exact-input local candidate simulation

`simulate.mjs` ran **15 separate local-only transactions** on an owned ephemeral Anvil fork pinned to the public snapshot. It used the approved actual owner, Mira, intended root, salts, epoch, durations and caps, not the earlier synthetic fixture. No owner keys were handled: local impersonation exercised the public addresses without proving live signing control.

Every executed transaction matched its encoded input, nonce, destination and exact ordered event topics/data/emitters. Both forward and parent metadata links, ownership/expiry nesting, restricted roles/counts, implementation identities, both full77-byte proxy runtimes, and full production runtimes (including every source-derived immutable byte and metadata) were checked. Both unchanged project creation/runtime templates were independently reproduced at optimizer200 with AST-named immutable references; ABI entries agree irrespective of ordering. A read-only local unlock call succeeded without changing requestNonce or persisting an event.

The local nonce sequence produced the four public predicted addresses. Local block numbers/hashes, token generations, resources, expiries and doorId are recorded only in `simulation-result.json.localBindings`; `liveReceipts` remains empty. Fork gas used totaled **5099422**, not a live fee estimate. Node/proxy stopped: **True**.

Boundary: all static candidate inputs are exact; private and receipt/time-dependent inputs were bound **inside this disposable fork**. A fresh random32-byte fork-only preimage existed only in RAM and was never logged, committed, exported or reused live. Its buffers were cleared after reveal; JS/native process memory cannot promise secure physical erasure. Transaction/receipt input digests are public, but raw reveal/commit calldata and preimages are not. A final live manifest is therefore still conditional on a newly bound private live-session preimage and actual confirmed live receipts.

Anvil used zero generated accounts, quiet/discarded native output, no persisted state or RPC cache, and a fresh random loopback port. An owned upstream proxy allowed only specific read methods, rejected writes/signing/eth_call forwarding and filtered private bytes from requests/responses. It forwarded only recorded read-method classes; two unsupported/filtered requests were blocked and the run still passed. No raw RPC payloads or node traces were persisted. This is not a real consensus/finality test: Anvil1.3.5 uses a Prague model, locally mined confirmation/finalized tags and local fee settings. Live fork-rule parity and real exact gas/fees remain review gates.

## Connection-only MetaMask test and launch

The isolated `ConnectionOnlyMetaMask` module permits eth_requestAccounts only from the Connect handler's trusted user click. It then reads eth_accounts/eth_chainId twice and verifies the selected supplied owner and chain11155111. Page load performs no wallet request. Permission rejection, wrong account/network, concurrency and context changes invalidate the connection. No signatures, submission method or automatic network switching is exposed. The original generic ReadOnlyWallet adapter still rejects eth_requestAccounts and all signing/send methods; this is a separate narrow permission path.

The agent did **not** click Connect, request actual account permission or interact with a live wallet. The real extension connection remains for the owner to perform. A selected account/chain match is not a signing-control proof and does not close deployment gates.

From repository root:

```sh
npm --prefix contracts/scripts/deployment_workflow test
node contracts/scripts/deployment_candidate/test.mjs
node contracts/scripts/deployment_workflow/build.mjs
python3 -m http.server 8769 --bind 127.0.0.1 --directory /tmp/nak-local-deployment-review
```

Open `http://127.0.0.1:8769/` yourself in a MetaMask-enabled browser on standard Ethereum Sepolia; click Connect and approve only account access. Do not add the private simulation RPC. Verify owner `0x40F6DcB0Fa311570f72aC6F64045EB80E66711F7` and chain11155111. If any signing/transaction dialog appears, cancel and stop. The live execution control remains disabled even after connection verification. Stop the server afterward. No server is left running by this preparation.

For a refreshed simulation, run compile_local.py, inspect.mjs, derive.mjs, prepare.mjs, then simulate.mjs under contracts/scripts/deployment_candidate. The last command creates only its own guarded disposable local processes; no public write route is available. A fresh read can legitimately change the prefix/nonce predictions or block if the root/configuration/caps change.

## Results and remaining gates

- Workflow + connection tests: **72 passed,0 failed** (62 existing +10 connection-only).
- Candidate transport/prediction/privacy tests: **8 passed,0 failed**.
- Isolated candidate sequence: **15/15 transactions succeeded**, exact event/state/runtime checks passed.
- UI bundle build passed. No real MetaMask E2E permission test or live transaction was performed.
- Initial local compiler check stopped on ABI array ordering; semantic entries plus exact creation/runtime bytes were then checked successfully. The original failed output is preserved. Earlier successful simulation variants are retained as separate local-only evidence, not claimed as new live state.

Remaining gates: independent architecture/security review of new code/evidence; owner-performed connection test; fresh public state and account funding/allowance handling under separate authorization; private live-session binding; exact live nonce/prefix and all confirmed receipt/time/generation bindings; current network hardfork/gas/fee attestation; real canonical receipt/finality/reorg reconciliation; explicit future Stage3F authorization. Source/ABI/code identity and full trust inventories must be refreshed/accepted at execution; this preparation does not waive them.

No production contracts or historical evidence were changed. No live mint, approval, ENS registration, deployment, broadcast, signatures, Git staging, commit or push. **Stage3F remains NO-GO.**

Evidence formatting: the first final whitespace check found unified-diff blank context prefixes in the generated SOURCE_DIFF.patch, not source whitespace. The failed validation record is retained as validation-attempt1.json. The review patch was regenerated with zero context so it remains a valid unified patch without trailing context-only spaces; no source or historical evidence was trimmed.
