# Source-to-bytecode verification report

## Classification

**VERIFIED:** reproducible source-to-published creation/runtime templates and ABIs for eight ENS deployment artifacts. **VERIFIED:** exact original successful direct creation transaction input equals reproduced creation bytecode plus published constructor args, original receipt contractAddress matches expected address, and current runtime matches every byte outside recorded immutable slots. **BLOCKED:** final independently reviewed source-to-live-runtime/immutable semantic attestation. The Stage 3C live-deployment gate has not been waived or silently declared complete.

## New reproducible evidence

Official ENS deployment page links to artifacts at contracts-v2 commit `07e55a056f5b6a9c90119f501bdd05714e67dddd`. Eight artifacts (ETHRegistrar, ETHRegistry, RootRegistry, UserRegistryImpl, VerifiableFactory, MockUSDC, MockDAI, StandardRentPriceOracle) contain metadata with literal source contents. Their metadata yields one consistent **82-source closure** and identical compiler settings. Relevant embedded protocol sources match the inspected source at that commit.

Compiler: **0.8.25+commit.b61c2a91**; Cancun; optimizer enabled, **1000 runs**; exact metadata settings/remappings preserved. This differs from the project's own 200-run setting, which must not be used to claim reproduction of upstream ENS. `reproduce_sources.py` reconstructs standard-json, invokes the installed matching compiler offline and compares full creation/runtime templates and ABI outputs.

Actual result: **8/8 exact creation-template matches, 8/8 exact runtime-template matches, 8/8 ABI matches**. No guessed dependency versions, compiler flags or address substitution was used. `ens-standard-input.json` retains every literal source and setting; `source-reproduction.json` records compiler binary hash, version, settings, targets, immutable reference offsets, constructor args and buildInfo IDs. `upstream-artifact-index.json` records exact artifact URLs and hashes. Full artifacts remain retrievable at those pinned URLs; the source closure is retained independently of temporary downloads.

Reproduction command used:

```sh
python3 contracts/scripts/stage3e/reproduce_sources.py /tmp/nak-stage3e-upstream \
  --solc /home/l/.local/share/svm/0.8.25/solc-0.8.25
```

To repeat without the temporary artifact directory, retrieve the eight pinned URLs in upstream-artifact-index.json, verify their SHA-256 values, then run the command with that directory and a verified matching solc binary. The retained standard-json can also be passed directly to that compiler's `--standard-json`; preserve stdout and compare target creation/runtime outputs. Source licenses are preserved in the input contents.

## Live chain reconciliation

`live-artifact-comparison.json` retains read-only original transaction and receipt records, current runtime comparison and immutable bytes at observation block 12071722. All eight deployments are direct CREATE transactions (`to == null`), receipt status 1 and expected contractAddress. All transaction inputs exactly match compiled creation bytecode plus args. Runtime lengths and fixed bytes match, including metadata; repeated references for each immutable agree. These are stronger checks than address equality or getters alone.

Remaining separation: published ABI signatures; independently reproduced compiler outputs; original deployment transaction/receipt provenance; runtime fixed-byte equality; semantic mapping of immutable bytes to source constructor values. The last reconciliation and independent review are not completed in this stage. A historical call-trace attempt to inspect implementation constructor output failed with HTTPError; `deployment-trace-probe.json` preserves that failure. No trace success is claimed and no live deployment or eth_send transaction was attempted.

## Evidence needed to close the remaining gate

For every consumed upstream contract, independently review/re-run retained compiler inputs and comparison; map immutable reference IDs to AST/source variables; reconcile each live immutable value with constructor args, chain ID/address, derived EIP712 constants or factory-created proxyLogic as applicable. A reviewed historical replay/trace that reproduces constructor output can substitute where appropriate; it must use actual deployment context and compare full output bytes. Confirm expected creation receipt remains canonical and reviewed code identities remain unchanged at the proposed deployment block. Verify factory proxyLogic/current implementation and future R1/R2 identities separately. Do not treat a masked runtime comparison as a whole-runtime byte match.

The existing user contracts' exported ABIs match current unchanged Foundry output; they are not yet deployed. Future constructor arguments/nonce/salts and exact bytecode payloads need their own review/simulation. Source reproduction does not solve unknown owner/guest account control, balances, role inventory, actual future addresses, fees or transaction authorization. Stage 3F remains NO-GO.
