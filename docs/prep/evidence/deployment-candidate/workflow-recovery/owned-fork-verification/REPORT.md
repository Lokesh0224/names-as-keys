# Production T04 owned-fork verification

**PASS for the local verification gate.** The production `estimateOnOwnedFork()` ran through the same `privateEstimateHandler(bundle, estimateOnOwnedFork)` wiring used by `serve.mjs`. An owned fixture fork loaded the reviewed Sepolia snapshot at block 12073440 and mined T01, T02 and T03 only on loopback. The test advanced fixture time to 61 seconds after commitment. Its other reveal input had no commitment at the same block, sender and nonce.

| Check | Observed result |
|---|---|
| Child fork identity | Both runs read chain 11155111 and pinned block `0xb839e4`, hash `0x207eb2cc6a156788279d0502fe9aa514b96917104a155bf54901be39fb86ac26` |
| Valid T04 | Production endpoint returned 226,795 gas |
| Missing commitment | Fixture control reverted with `CommitmentTooOld`. Production endpoint returned HTTP 400 and `{"error":"Private estimate blocked"}` |
| Upstream isolation | Inspected production proxy ingress before filtering and outbound request bodies. Zero occurrences of either preimage or either raw reveal payload. 52 allowlisted production proxy reads reached the local fixture |
| Error and log redaction | Error response matched the generic body. Child output was discarded. Retained logs contain only sanitized stage names, method counts and public block identifiers |
| Cleanup and state | Both production child RPC listeners were unreachable after return and their proxy servers were closed. The fixture tip and original commitment stayed unchanged during estimation. Fixture and relay shut down afterward |

The test redirects the production proxy's fixed outbound public URL to the local fixture in process. A separate allowlisted relay supplies the fixture's historical public reads. The production estimator, proxy, child launch and local RPC estimate run unchanged. The local fixture allows the fresh child to see the mined commitment without publishing it to Sepolia. Gas is specific to this local block and execution model.

Reproduce with `node contracts/scripts/deployment_workflow/test/owned-fork-verification.mjs`. The standalone test is opt-in and requires Anvil, loopback sockets and read-only Sepolia RPC access. The first two attempts stopped during fixture funding. The third passed the committed estimate and stopped in the missing-commitment control at a pre-commit block. The successful control uses the same pinned block and nonce with a separate uncommitted preimage. Attempt logs remain alongside this report.

Production contracts, approved defaults and limits were untouched. `LIVE_EXECUTION_ALLOWED=false`. Stage 3F remains NO-GO.
