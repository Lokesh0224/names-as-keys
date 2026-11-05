#!/usr/bin/env bash
# Seed and compare the A6 resolution paths against the human's local Anvil fork.
set -euo pipefail
set +x

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
cd "$ROOT/contracts"

# Use the seed script's deterministic defaults so optional .env overrides do
# not appear in the seed's generated-name/account output.
unset A6_PARENT_LABEL A6_PARENT_OWNER

SEED_SCRIPT="scripts/seed-anvil-resolution.ts"
PROBE_SCRIPT="scripts/resolve-test.ts"
TSX="./node_modules/.bin/tsx"
for file in "$SEED_SCRIPT" "$PROBE_SCRIPT" "$TSX"; do
  if [[ ! -e "$file" ]]; then
    printf 'A6 dependency or script unavailable: %s\n' "$file" >&2
    exit 2
  fi
done
if ! node -e 'require.resolve("ethers")' >/dev/null 2>&1; then
  printf 'A6 dependency unavailable: ethers\n' >&2
  exit 2
fi

# Record the Anvil fork's actual local head separately from the runner's
# remote Sepolia pre/post head metadata.
LOCAL_ANVIL_RPC="http://127.0.0.1:8545"
anvil_chain_before="$(ETH_RPC_URL="$LOCAL_ANVIL_RPC" cast chain-id)"
anvil_block_before="$(ETH_RPC_URL="$LOCAL_ANVIL_RPC" cast block-number)"
printf 'anvil_chain_id_before=%s\nanvil_fork_block_before=%s\n' "$anvil_chain_before" "$anvil_block_before"
if [[ "$anvil_chain_before" != 11155111 ]]; then
  printf 'Expected local Anvil chain ID 11155111\n' >&2
  exit 4
fi

# Keep the actual probe and helper hashes in the same sanitized evidence log.
sha256sum "$SEED_SCRIPT" "$PROBE_SCRIPT" "$SCRIPT_DIR/run-a6-pair.sh"

seed_output="$(ANVIL_RPC_URL="$LOCAL_ANVIL_RPC" "$TSX" "$SEED_SCRIPT")"
printf '%s\n' "$seed_output"
full_name="$(printf '%s\n' "$seed_output" | sed -n 's/^A6_FULL_NAME=//p' | tail -n 1)"
expected_address="$(printf '%s\n' "$seed_output" | sed -n 's/^[[:space:]]*"expectedAddress": "\([^"]*\)"[,]*/\1/p' | tail -n 1)"
if [[ -z "$full_name" || -z "$expected_address" ]]; then
  printf 'A6 seed output did not include the generated name and expected address\n' >&2
  exit 3
fi

ENS_TEST_NAME="$full_name" ENS_EXPECTED_ADDRESS="$expected_address" \
  ANVIL_RPC_URL="$LOCAL_ANVIL_RPC" "$TSX" "$PROBE_SCRIPT"

anvil_chain_after="$(ETH_RPC_URL="$LOCAL_ANVIL_RPC" cast chain-id)"
anvil_block_after="$(ETH_RPC_URL="$LOCAL_ANVIL_RPC" cast block-number)"
printf 'anvil_chain_id_after=%s\nanvil_block_after=%s\n' "$anvil_chain_after" "$anvil_block_after"
if [[ "$anvil_chain_after" != 11155111 ]]; then
  printf 'Local Anvil chain ID changed during the probe\n' >&2
  exit 5
fi
