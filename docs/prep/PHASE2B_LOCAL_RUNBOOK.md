# Phase 2b human-local runbook

The agent execution environment has no working DNS. All RPC-dependent commands in this runbook are for the human's local terminal only. Do not paste `.env` values or unredacted process output into chat. The evidence runner captures output, redacts `.env` values and URL components, verifies that none remain in the log, and writes a SHA-256 sidecar.

## One-time runner check (offline)

From the repository root, run the synthetic-only self-test:

```sh
python3 docs/prep/runners/redact.py --self-test
```

Expected output: `REDACTOR SELF-TEST: PASS (synthetic values only)`. This self-test was run while preparing the runner and passed. It did not read `.env`, call the network, or run Forge.

## T6a — existing A4/A5 closure tests

No test source was changed. The exact matching pattern is `testClosure`, which selects these four existing tests in `ENSv2QuestionsTest`:

- `testClosureV2ValidWrongOwnerChildExpiredAndRevoked`
- `testClosureV2RejectsExpiredParentAndDetachedSubregistry`
- `testClosureV2CapsChildExpiryAtParentAndThirtyDayLimit`
- `testClosureA4ParentResaleAndReplacementSubregistry`

From the repository root, run locally:

```sh
bash docs/prep/runners/run-evidence.sh T6a -- bash -c 'cd contracts && forge test --fork-url sepolia --match-path "test/spike/*" --match-test testClosure -vvv'
```

The runner sources `contracts/.env` into its process environment without displaying values. `--fork-url sepolia` uses the `sepolia` endpoint alias from `contracts/foundry.toml`; the URL is read from the environment and is not placed in the command line. The runner performs a `forge build` before the requested test command, and captures `cast chain-id` and `cast block-number` before and after. It stops before tests if the pre-run chain ID is not `11155111` or chain metadata cannot be read.

Expected evidence in the resulting `docs/prep/evidence/T6a-<UTC timestamp>.log`:

- Task ID, UTC start time, `executed_by=HUMAN-LOCAL`, Forge version, chain ID `11155111`, and before/after block numbers.
- SHA-256 entries for the spike `.t.sol` files and the runner scripts.
- `forge_build_exit_code=0` and output showing the four test names above.
- Each of the four tests reported passing; the overall Forge test exit code is zero.
- A sibling `.log.sha256` file matching the complete log.

Any compile or test failure is evidence and must be preserved. Do not alter or weaken an assertion. After the run, provide only the sanitized evidence filename and sidecar, e.g. `T6a evidence ready: docs/prep/evidence/T6a-YYYYMMDD-HHMMSS.log`; do not paste raw terminal output or the `.env` file.

## T6b — A6 paired-resolution probe

The inspected scripts are `contracts/scripts/seed-anvil-resolution.ts` and `contracts/scripts/resolve-test.ts`. Both use ethers; `tsx` and `ethers` are already available under `contracts/node_modules` in this workspace. The runner helper checks these dependencies before seeding. No installation or dependency-file change is required. `anvil --help` confirms `--fork-url`, `--chain-id`, and `--host` flags.

The scripts' `ANVIL_RPC_URL` is set by the helper to `http://127.0.0.1:8545`, matching the explicit Anvil host/port below, so all seed transactions and both resolution calls target only the local fork. The seed verifies local chain ID `11155111`, then seeds a parent name, UserRegistry subregistry, permissioned resolver, guest child `mira`, and guest address record. The helper clears optional `A6_PARENT_LABEL`/`A6_PARENT_OWNER` overrides in its own process and uses the script defaults, preventing those `.env` values from appearing in seed output. The paired probe checks `provider.resolveName(name)` against a direct Universal Resolver `resolve(bytes,bytes)` call and compares both with the seeded guest address. These writes occur only in the local Anvil fork.

**Terminal A — start Anvil locally.** From the repository root, run this in a dedicated terminal. Its output goes only to a unique private file; never paste or share that file. Keep this terminal open while running the evidence command, then stop Anvil with Ctrl-C.

```sh
cd contracts
set +x
set -a
source .env
set +a
ANVIL_PRIVATE_LOG="/tmp/anvil-T6b-$(date -u +%Y%m%d-%H%M%S)-private.log"
if [ -e "$ANVIL_PRIVATE_LOG" ]; then printf 'Private Anvil log already exists; choose a new timestamp.\n' >&2; exit 1; fi
anvil --fork-url sepolia --chain-id 11155111 --host 127.0.0.1 --port 8545 > "$ANVIL_PRIVATE_LOG" 2>&1
```

The `sepolia` alias comes from `contracts/foundry.toml`. The RPC URL stays in the process environment and is not passed in argv. Do not use a private-key or signing variable.

**Terminal B — capture seed and paired probe.** From the repository root, run:

```sh
bash docs/prep/runners/run-evidence.sh T6b -- bash docs/prep/runners/run-a6-pair.sh
```

The evidence runner performs its environment preflight and `forge build` first. The A6 helper records SHA-256 hashes for both TypeScript scripts and itself, runs the seed script through the existing local `tsx` binary, extracts the generated name/address from the seed output, and runs the paired probe. It refuses to proceed if `tsx` or `ethers` is unavailable. If that check fails, preserve the sanitized T6b log and report the dependency error; do not install packages during this run.

Expected evidence in `docs/prep/evidence/T6b-<UTC timestamp>.log`:

- Header: task ID, `executed_by=HUMAN-LOCAL`, Forge version, Sepolia chain ID `11155111` and before/after head blocks. The helper also records the local Anvil chain ID and fork block before seeding, then the Anvil chain ID and local head after the probe.
- Successful build exit code and SHA-256 entries for the `.t.sol`/helper files, evidence runner scripts, `seed-anvil-resolution.ts`, and `resolve-test.ts`.
- Seed script reports chain ID `11155111`, a generated full name ending `.eth`, expected guest address `0x0000000000000000000000000000000000000B0b`, and completion of parent registration, subregistry/resolver setup, child registration, and address-record setup.
- Probe JSON reports `chainId: "11155111"`, `ethersV6` and `directResult` equal to the expected guest address, `ethersMatches: true`, `directMatches: true`, `pathsAgree: true`, `ethersV6Error: null`, and `directError: null`. Probe exit code is zero.
- Redaction verification passes, the log contains no endpoint or `.env` value, and the sibling `.log.sha256` matches.

Any failed seed/probe assertion or mismatching result is a finding; preserve the log unchanged. If a revert selector appears, map it to `docs/ens-errors.md`; any unmatched selector remains UNKNOWN. This is local-fork evidence, never live Sepolia evidence. Afterward, stop Anvil and send only `T6b evidence ready: docs/prep/evidence/T6b-<UTC timestamp>.log` plus the checksum sidecar path.

## Later tasks

Do not run A3-runtime or T9/A2 until their test files, runbooks, exact commands, and expected observations have been prepared and reviewed. N1 and N2 remain blocked unless specifically approved during Checkpoint R review.
