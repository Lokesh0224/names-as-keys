#!/usr/bin/env bash
# Human-local, read-only evidence capture. Never run this from Codex's networkless environment.
set -euo pipefail
set +x

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
REDACTOR="$SCRIPT_DIR/redact.py"

if (($# < 3)); then
  printf 'Usage: %s <TASK_ID> -- <command ...>\n' "$0" >&2
  exit 2
fi
TASK_ID="$1"
shift
if [[ "$1" != "--" ]]; then
  printf 'Usage: %s <TASK_ID> -- <command ...>\n' "$0" >&2
  exit 2
fi
shift
if (($# == 0)) || [[ ! "$TASK_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'Invalid task ID or empty command\n' >&2
  exit 2
fi

for arg in "$@"; do
  if [[ "$arg" == *"://"* || "$arg" == *"--broadcast"* || "$arg" == *"--private-key"* || "$arg" == *"--mnemonic"* ]]; then
    printf 'Refusing URL, broadcast, or signing argument\n' >&2
    exit 2
  fi
done

cd "$ROOT"
if [[ ! -f contracts/.env ]]; then
  printf 'Missing contracts/.env\n' >&2
  exit 2
fi
set -a
source contracts/.env
set +a
if [[ -z "${SEPOLIA_RPC_URL:-}" ]]; then
  printf 'SEPOLIA_RPC_URL is unset after loading contracts/.env\n' >&2
  exit 2
fi
# cast defaults to ETH_RPC_URL; set it in-process without placing the URL in argv.
export ETH_RPC_URL="$SEPOLIA_RPC_URL"
ENV_NAMES="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' contracts/.env | cut -d= -f1 | paste -sd, -)"
if [[ -z "$ENV_NAMES" ]]; then
  printf 'No environment variable names found in contracts/.env\n' >&2
  exit 2
fi

EVIDENCE_DIR="$ROOT/docs/prep/evidence"
mkdir -p "$EVIDENCE_DIR"
START_UTC="$(date -u +%Y%m%d-%H%M%S)"
LOG="$EVIDENCE_DIR/$TASK_ID-$START_UTC.log"
SHA="$LOG.sha256"
if [[ -e "$LOG" || -e "$SHA" ]]; then
  printf 'Refusing to overwrite existing evidence file\n' >&2
  exit 2
fi
umask 077
if ! (set -o noclobber; : > "$LOG") 2>/dev/null; then
  printf 'Refusing to overwrite existing evidence file\n' >&2
  exit 2
fi

append_redacted() {
  printf '%s' "$1" | python3 "$REDACTOR" --names "$ENV_NAMES" >> "$LOG"
}

capture_meta() {
  local label="$1"; shift
  local output
  if output=$("$@" 2>&1); then
    append_redacted "$label=$output"$'\n'
    [[ "$label" != chain_id_before && "$label" != chain_id_after ]] || [[ "$output" == 11155111 ]] || return 21
  else
    local category=unclassified
    if [[ "$output" =~ [Dd][Nn][Ss]|[Rr]esolv|[Ll]ookup ]]; then category='DNS resolution'
    elif [[ "$output" =~ [Tt]imeout|timed.out ]]; then category=timeout
    elif [[ "$output" =~ [Cc]onnection.refused ]]; then category='connection refused'
    elif [[ "$output" =~ [Uu]nauthorized|[Aa]uthentication|[Ii]nvalid.*[Kk]ey|[Ff]orbidden|[Hh][Tt][Tt][Pp].*(401|403) ]]; then category='authentication error'
    elif [[ "$output" =~ [Hh][Tt][Tt][Pp].*(4[0-9][0-9]|5[0-9][0-9])|[Ss]tatus.code ]]; then category='HTTP status'
    fi
    append_redacted "$label=FAILED ($category)"$'\n'
    return 22
  fi
}

append_redacted "task_id=$TASK_ID"$'\n'"start_utc=$START_UTC"$'\nexecuted_by=HUMAN-LOCAL\n'
if ! capture_meta forge_version forge --version; then
  append_redacted $'exit_code=22 (metadata preflight stopped)\n'
  python3 "$REDACTOR" --verify "$LOG" --names "$ENV_NAMES" || exit 1
  sha256sum "$LOG" > "$SHA"
  printf 'Evidence log: %s\n' "${LOG#"$ROOT/"}"
  exit 22
fi
if ! capture_meta chain_id_before cast chain-id; then
  append_redacted $'exit_code=22 (metadata preflight stopped)\n'
  python3 "$REDACTOR" --verify "$LOG" --names "$ENV_NAMES" || exit 1
  sha256sum "$LOG" > "$SHA"
  printf 'Evidence log: %s\n' "${LOG#"$ROOT/"}"
  exit 22
fi
if ! capture_meta block_before cast block-number; then
  append_redacted $'exit_code=22 (metadata preflight stopped)\n'
  python3 "$REDACTOR" --verify "$LOG" --names "$ENV_NAMES" || exit 1
  sha256sum "$LOG" > "$SHA"
  printf 'Evidence log: %s\n' "${LOG#"$ROOT/"}"
  exit 22
fi

append_redacted 'command='
printf '%q ' "$@" | python3 "$REDACTOR" --names "$ENV_NAMES" >> "$LOG"
append_redacted $'\n'
{
  find contracts/test/spike -type f \( -name '*.t.sol' -o -path '*/helpers/*' \) -print0 | sort -z | xargs -0 -r sha256sum
  sha256sum "$SCRIPT_DIR/run-evidence.sh" "$REDACTOR"
} | python3 "$REDACTOR" --names "$ENV_NAMES" >> "$LOG"

BUILD_CODE=0
set +e
(cd contracts && forge build) 2>&1 | python3 "$REDACTOR" --names "$ENV_NAMES" >> "$LOG"
BUILD_PIPESTATUS=("${PIPESTATUS[@]}")
set -e
BUILD_CODE="${BUILD_PIPESTATUS[0]}"
if [[ "${BUILD_PIPESTATUS[1]}" -ne 0 ]]; then BUILD_CODE=90; fi
append_redacted "forge_build_exit_code=$BUILD_CODE"$'\n'
RUN_CODE=0
if [[ "$BUILD_CODE" -eq 0 ]]; then
  set +e
  "$@" 2>&1 | python3 "$REDACTOR" --names "$ENV_NAMES" >> "$LOG"
  RUN_PIPESTATUS=("${PIPESTATUS[@]}")
  set -e
  RUN_CODE="${RUN_PIPESTATUS[0]}"
  if [[ "${RUN_PIPESTATUS[1]}" -ne 0 ]]; then RUN_CODE=90; fi
else
  RUN_CODE="$BUILD_CODE"
fi

capture_meta chain_id_after cast chain-id || true
capture_meta block_after cast block-number || true
append_redacted "exit_code=$RUN_CODE"$'\n'

if ! python3 "$REDACTOR" --verify "$LOG" --names "$ENV_NAMES"; then
  exit 1
fi
if [[ -e "$SHA" ]]; then
  rm -f "$LOG"
  printf 'Refusing to overwrite existing evidence checksum\n' >&2
  exit 2
fi
sha256sum "$LOG" > "$SHA"
printf 'Evidence log: %s\n' "${LOG#"$ROOT/"}"
printf 'Checksum: %s\n' "${SHA#"$ROOT/"}"
exit "$RUN_CODE"
