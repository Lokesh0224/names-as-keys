#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$CONTRACTS_DIR"

if [[ ! -f .env ]]; then
  echo "Missing contracts/.env with SEPOLIA_RPC_URL" >&2
  exit 2
fi
set -a
source .env
set +a
if [[ -z "${SEPOLIA_RPC_URL:-}" ]]; then
  echo "SEPOLIA_RPC_URL is empty" >&2
  exit 2
fi

# Redact the endpoint from both terminal output and the saved log. Do not enable
# shell tracing: the RPC endpoint may contain a credential.
VERBOSITY="${SPIKE_VERBOSITY:--vvv}"
set +e
forge test --match-path 'test/spike/*' "$@" --fork-url "$SEPOLIA_RPC_URL" --fork-retries 3 --fork-retry-backoff 500 "$VERBOSITY" --gas-report 2>&1 |
  python3 -c 'import os,sys,urllib.parse; s=sys.stdin.read(); u=os.environ.get("SEPOLIA_RPC_URL", ""); s=s.replace(u, "[REDACTED_RPC_URL]") if u else s; h=urllib.parse.urlsplit(u).netloc; s=s.replace(h, "[REDACTED_RPC_HOST]") if h else s; sys.stdout.write(s)' |
  tee spike-output.log
status=${PIPESTATUS[0]}
set -e
exit "$status"
