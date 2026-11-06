# Stage 3F deployment-gate readiness audit

**NO-GO. Stop for independent architecture/security review.** This is a preparation audit, not permission to execute Stage 3F. No historical file, production contract or committed Stage 3E artifact was modified.

Starting branch `master`, HEAD `3c6240f84d6010ac7dfcefb9f5f626655f22f767`; initial working tree clean; 293 tracked files. Current audit artifacts are intentionally untracked and no commit is requested. Final inventory/status/checksums are in the adjacent evidence directory.

## Observation and selected inputs

Owner: `0x40F6DcB0Fa311570f72aC6F64045EB80E66711F7`; Mira: `0x5a9191871b9117218F83Ed43293E011667053F39`. Both are owner-supplied public addresses; neither is inferred from ENS's administrator. The owner retained MockUSDC rent and 365-day root/90-day lock/one-day credential as **proposals for review**, not final transaction authorization. No private keys, seed phrases or registration commitment secrets were requested or generated.

Observation block **12071963**, hash `0x58bfa2bb15174e49b537d0d645c589e07adab37b8ede60ad6be5f1ab7ffc8caf`, timestamp **1793911920** (2026-11-05T20:52:00+00:00). End-of-run block-hash recheck succeeded. Single public RPC endpoint; stale-state, provider trust, future state and reorg risks remain. Do not describe this block as finalized.

`nak-lokesh-20261105.eth` remains available and unowned. Intended hierarchy unchanged: root → `lock` → `mira`; no test fixture implies live ownership. Owner nonce at observation and pending read was 50; Mira nonce1. Nonces are observations, not reserved.

## Every deployment gate

PASS means the specifically stated technical observation is established at the recorded block. FAIL means a current prerequisite is demonstrably not met, even when remediable during separately authorized execution. UNRESOLVED means missing decisions, future state, implementation or independent review. No PASS grants transaction authority.

| Gate | Status | Evidence / remaining requirement |
|---|---|---|
| G01: Approved HEAD and initially clean tree | **PASS** | HEAD 3c6240f84d6010ac7dfcefb9f5f626655f22f767; initial git status empty; 293 tracked files. |
| G02: Historical evidence and production source integrity | **PASS** | All HEAD-tracked file bytes unchanged; Stage 3E current 81 checksums validated; original 43-entry snapshot resolves six archived prior versions. |
| G03: Sepolia identity and stable observation | **PASS** | Chain 11155111; block 12071963; canonical block hash checked again at end. This is not a finality or multi-provider proof. |
| G04: Exact intended root available and initially unused | **PASS** | isAvailable true; getState AVAILABLE, expiry 0, latestOwner zero; tokenVersion0/resourceVersion1; getOwner zero. No project ownership or reservation. |
| G05: Ordinary registration mechanism and timing | **PASS** | Direct commit/reveal; min 60s, max 86400s (strict upper bound); min duration/grace 2419200s; no mainnet ownership prerequisite in reviewed available-label path. |
| G06: Address, code and consumed ABI identities | **PASS** | All 16 runtime hashes unchanged from Stage 3E; eth forward link, registrar ETH_REGISTRY/oracle/BENEFICIARY and timing getters match; eight original creation receipts rechecked. |
| G07: Reproducible source compiler evidence | **PASS** | Retained source closure/solc binary/settings reproduced offline; AST mapping reproduced; eight compiled creation+args match original transaction inputs; ABIs equal retained ABIs. |
| G08: Semantic immutable/full-runtime equality (technical) | **PASS** | Eight main runtimes match all bytes after source-derived immutable reconciliation; additional UUPSProxyLogic matches full runtime and factory/derived CREATE address. Independent review is separate G23. |
| G09: LabelStore runtime and conditional log behavior | **PASS** | Pinned official artifact reproduced; CONTRACT_NAMER derived from sole constructor argument and AST-mapped; full runtime exact. setLabel has no external calls and emits Label(bytes32,string) only if absent. |
| G10: Existing ENS administrator/operator census at observation | **PASS** | ETHRegistry, RootRegistry, oracle creation-to-block root-role logs replayed, current roles and packed counts/getAssigneeCount agree. RootRegistry eth-token resource and relevant operator histories inspected; no active relevant operators. |
| G11: Selected public accounts | **PASS** | Owner 0x40F6DcB0Fa311570f72aC6F64045EB80E66711F7; Mira 0x5a9191871b9117218F83Ed43293E011667053F39; supplied explicitly and distinct; no secrets requested. |
| G12: EOA/no callback code condition at observation | **PASS** | eth_getCode returns 0x for both selected addresses. Recheck before issuance; delegated/smart-account code changes invalidate this observation. |
| G13: MetaMask account/signing control | **UNRESOLVED** | No wallet connection or signatures requested. Future authorized workflow must show selected owner on Sepolia; owner attestation/control confirmation remains required. |
| G14: Accounts currently funded with Sepolia ETH | **PASS** | Owner 0.885875646490742252 ETH; Mira 0.008968499999601 ETH. Positive balance only; entire deployment budget sufficiency is G21. |
| G15: Owner mock-rent balance currently sufficient | **FAIL** | MockUSDC balance 0; snapshot one-year quote 8000021 units, premium0. Future T01 needed unless balance changes; no mint executed. |
| G16: Registrar allowance currently sufficient | **FAIL** | Owner allowance to ETHRegistrar 0; future T02 bounded approval needed after explicit spend review. No approval executed. |
| G17: Exact owner deployment inputs and policy decisions | **UNRESOLVED** | Durations/payment retained as proposals, not final transaction approval. Need salts, epoch confirmation, spend cap/quote-slippage handling, absolute expiry reference policy, secret lifecycle/recovery policy, gas/fee ceiling and confirmation/reorg policy. |
| G18: Future addresses and initialization on chain | **UNRESOLVED** | Initializer bytes now known offline for actual owner/restricted bitmap; salts null; R1/R2, registrar and DoorKeys null. Prediction/receipt/code/implementation checks required; no substitutes. |
| G19: Live hierarchy, ancestor generations and project roles | **UNRESOLVED** | Root/lock unregistered; no R1/R2 to inspect. Both forward/back links, owners, expiries, generation IDs, owner grants, registrar4097, guest/door zero roles must be checked per step. |
| G20: Full exact-manifest ordered fork simulation | **UNRESOLVED** | Only T01/T02 snapshot candidates simulated non-persistently; other inputs unresolved. No full manifest execution, state override or placeholder-based deployment claimed. |
| G21: Complete exact gas/fee and ETH budget review | **UNRESOLVED** | T01 snapshot estimate141730; T02 estimate129366. Remaining 13 gas values unknown; no total or approved max fee/tip/budget. Estimates are not charged gas or limits. |
| G22: Safe MetaMask execution workflow implemented | **FAIL** | Stage 3E has a specification only. No account/chain listeners, nonce locks, duplicate/retry guards, receipt/reorg state machine or reviewed submission UI implemented. Not implemented in this audit. |
| G23: Independent architecture/security review | **UNRESOLVED** | New semantic proofs, role/operator census, conditional LabelStore events and candidate simulations require independent review; technical PASS does not self-approve deployment. |
| G24: Explicit authorization for live actions | **UNRESOLVED** | Stage 3F explicitly NO-GO. No current registration, mint, allowance, deployment, grant, issuance, unlock or wallet request authorized. |
| G25: Approved trusted-administrator model preserved | **PASS** | No production changes, privileges broadened or local guest list. Global renewers and eth ancestor owner documented; future R2 owner can renew expired unburned credentials; current-state restoration semantics retained. |
| G26: Actual receipt/state reconciliation and finality | **UNRESOLVED** | No deployment receipts exist. Public per-step receipt/header/event/state journal and chosen confirmation/finality/reorg policy are required during controlled execution. |
| G27: Non-authorizing URI renderer provenance review | **UNRESOLVED** | Bound URI renderer has nonempty code at 0x0f5b101b6fc626b9b210bb5e70f60f3dd9ca0d96. No source reproduction performed; source proves initialization stores pointer/emits it, and reviewed authorization path does not call renderer. Independent review must explicitly accept limited scope or require full renderer verification. |

## Proof references and trust boundaries

- `../evidence/stage3f-audit/read-only-observation.json` and `rpc-transcript.json`: 159 allowlisted read/simulation calls; all 16 code identities; public account balances/code/nonces; root/configuration; full existing root-role histories and counts; two individual candidate simulations.
- `compiler-audit.json`, `compiler-reproduction.log`, `semantic-runtime-reconciliation.json`, `runtime-reconciliation.log`: independently reproduced retained compiler input/binary/AST mapping, all expected and actual immutable bytes/offsets, full-runtime comparisons and original creation-input/canonical-receipt reconciliation. Eight core artifacts plus UUPSProxyLogic pass. Mock token EIP-712 domain/name/version values derive from constructors, chain11155111 and actual addresses; UserRegistry __self derives from implementation address; factory child derives from CREATE nonce1; oracle premium offset derives from the observed integer 21-halving configuration. The helper deliberately refuses unimplemented fractional oracle cases; this is not a general-purpose verifier for changed configurations.
- `labelstore-artifact.json`, `labelstore-standard-input.json`, `labelstore-verification.json`: pinned official public artifact, complete literal source closure, reproducible compile, constructor-derived CONTRACT_NAMER immutable and whole runtime equality. LabelStore setLabel writes only its own mapping and conditionally emits `Label(bytes32,string)`. CONTRACT_NAMER is consulted only by its separate naming view, not registration. Initial verifier deliberately stopped upon unexpected immutable references; two failed inspection logs and first script version are preserved. The final verifier resolves the immutable rather than ignoring it.
- `ancestor-role-observation.json`, `ancestor-rpc-transcript.json`: creation-through-observation RootRegistry eth-token role history and owner, plus operator histories for that ancestor owner and selected future ETH token owner. Both histories complete with no approved operators. The eth ancestor is owned by ENS administrator `0x84d3a426d4e12e955d1df95db0b24fe26afe39d3`, not project owner.
- Existing Stage 3E `CORRECTIONS_REVIEW.md` and `ADMIN_ROLE_CHECKLIST.md` remain the source for exact role policy and event layouts. Existing Stage 3B–3D evidence remains historical; no full production fork-suite total is claimed as rerun here. Seven new local guard/evidence tests pass; see audit-tests.log.

Current network permissions: ETHRegistrar holds global REGISTRAR|RENEW; `0xf2ece44980778966b8a0fccb3a9e339440f6e045` holds RENEW; `0x2a35b94df22cc7354570be2284655e2cdc0e64a2` and `0x6029a063d69b09d23c52a754a90e4fe43adac3a8` hold REGISTER_RESERVED. One additional historical assignee now has zero roles. The ENS administrator holds the documented root admin/parent/URI/naming permissions; exact bitmaps are retained rather than inferred from ownership. The oracle administrator controls rent configuration. Complete event replay is reconciled with live packed role counts/getAssigneeCount; it relies on the RPC providing complete canonical logs and is not a cryptographic log-inclusion proof. RootRegistry eth-token owner can replace the ETH attachment. Global renewal can restore ancestor expiry. These are trusted network powers; project owner cannot remove them.

Future R1/R2 owner root bitmap remains `380593917518227438537563280301172632627253505`; lock bitmap `91700664256357922357994873537130062512592519168`; registrar root bitmap4097; guest token roleCount0; DoorKeys roles0. No UPGRADE rights added. R2 owner retains administrative renewal: an expired unburned credential can regain current-state access after renewal. Restored owners/attachments may restore validity without generation change; generation changes invalidate immutable snapshots. Review must accept these existing semantics, not silently promise irrevocable expiry/revocation against a malicious administrator.

## Owner decisions and inputs still needed

1. Confirm ability to control the two selected public addresses in the intended MetaMask accounts without sharing wallet secrets. Future connection/account selection is separately authorized, not performed by this audit. Confirm these are direct EOA calls, not a relayer/smart-account caller substitution.
2. Approve final root/payment/duration policy and deployment epoch1. Choose two distinct uint256 factory user salts for R1/R2; salts are public deterministic-address inputs, not wallet secrets. Null until approved; no placeholder prediction is represented as a project address.
3. Approve exact fresh bounded token approval/mint policy and maximum rent amount. Current proposal is 8.000021 MockUSDC, but price may change; stop/review rather than silently increase spend or grant unlimited allowance.
4. Choose the timestamp reference policy for absolute uint64 lock and guest expiries. Proposed rule: derive from the latest identified review block after ancestors exist, with 90-day/one-day duration, recheck mining/staleness margin and parent caps; reject rather than silently clamp. Root365-day expiry is actual T04 receipt block timestamp +duration.
5. Approve a future private CSPRNG registration-secret lifecycle, local storage/recovery and deletion policy. This secret is a commitment preimage, never a MetaMask seed/key. No secret exists in public artifacts or this audit; losing it before reveal prevents that commitment from completing and requires a newly reviewed attempt.
6. Set per-step and total gas/fee ceilings, maximum priority fee, price/estimate staleness bound, nonce-freeze policy and a confirmation/finality/reorg policy. Exact future gas limits must follow complete simulation, not these two estimates.
7. Keep the already approved trusted-administrator model. Have the independent reviewer assess the newly enumerated network holders and resolve the URI-renderer scope; the existing R2 renewal/restoration semantics are not a new approval request. Select/authorize implementation and review of a safe MetaMask execution workflow; Stage 3E supplies a specification, not one that can currently execute.
8. After independent review and all gates close, explicitly authorize the exact live transaction sequence. This report makes no such request and does not activate Stage 3F.

## Simulation boundary

T01/T02 candidates have known addresses and snapshot quote; eth_call succeeds without persistent state, and eth_estimateGas returns141730 /129366. These are **snapshot proposals**, not approved spend parameters, final signable transactions or an ordered full-manifest fork simulation. No state overrides, fake balances, impersonated deployments, generated secrets or test salts were used. `review-plan.json` retains all final calldata/gas fields null and stores candidate simulations in explicitly separate fields. The actual-owner/restricted-role nested initializer is fully known and encoded offline; proxy calls remain blocked by salts.

T03/T04 require a future private secret/commitment and exact approved price/timing. T05/T09 require approved salts. R1/R2 targets, actual root/lock token generations, lock/guest absolute expiries and CREATE-deployed addresses block later exact transactions. Once decisions resolve, prepare a **separate** disposable pinned-fork harness with these exact real public inputs and a locally isolated registration secret, execute the ordered sequence only in local EVM state, retain input digests/results/gas/logs and clearly mark every fork artifact. Any synthetic secret/salt/address used merely to test mechanics must stay outside the approved deployment manifest and cannot establish its exact readiness. No such full simulation or deployment happened here.

The ordered transaction-review and receipt/runtime protocol is in TRANSACTION_REVIEW_PLAN.md. **No commit, push, wallet request, live registration, deployment or broadcast. Stop for independent architecture/security review.**

## Crosswalk to every original Stage 3E gate

Composite original gates remain open when independent review or future state is missing, even if a narrower technical subcheck now passes.

| Original Stage 3E gate | Current composite status | Subchecks / evidence |
|---|---|---|
| Approved checkpoint / unchanged contracts | PASS | G01/G02/G25; HEAD and source checks. |
| Sepolia root mechanism and availability | PASS at observation | G04/G05; must refresh before future commit/reveal. |
| ENS address and consumed ABI identities | PASS at observation | G06; all16 unchanged runtime hashes and configuration. |
| Reproducible published templates | PASS | G07; exact compiler reproduction and creation input comparisons. |
| Complete source/live-runtime attestation including independent review | UNRESOLVED | G08/G09 technical proofs now pass, but G23 independent attestation is still pending. |
| Owner/guest accounts and signing control | UNRESOLVED | G11/G12 public account selection/code pass; G13 control not demonstrated. |
| Balances, allowances, total gas sufficiency | FAIL | G15/G16 zero rent token/allowance; G14 positive ETH, G21 total budget unresolved. |
| Future addresses and initialization | UNRESOLVED | G18/G19; known initializer encoded, salts/addresses/live roles unresolved. |
| Full trusted-administrator inventory and accepted trust boundaries | UNRESOLVED | G10 existing census passes; future project roles G19 and independent trust acceptance G17/G23 remain. |
| Exact gas/fee simulations and transaction review | UNRESOLVED | G20/G21/G26; only two nonpersistent snapshot candidates simulated. |
| Safe execution workflow | FAIL | G22; specification exists, reviewed execution implementation does not. |
| Exact owner approval for write sequence | UNRESOLVED | G24; explicit NO-GO remains in effect. |

New local execution: seven audit tests and 19 unchanged Stage 3E offline tests passed; the committed offline manifest checker passed. No full Foundry fork suite or actual ordered deployment simulation was run in this audit. The new LabelStore source proves no registration callback beyond its own storage/log update; URI renderer source equivalence remains outside the proof and requires an explicit reviewer scope decision.
