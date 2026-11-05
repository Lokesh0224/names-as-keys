# Phase 2a changelog

- Created `docs/prep/vendor-drift.md`: official address comparison and blocked upstream/on-chain checks.
- Created `docs/prep/A3_EXPERIMENT_DESIGN.md`: incomplete, explicitly UNEXECUTED source-limited design.
- Modified `docs/ens-errors.md`: selector inventory and observed selector mapping; retained generic unknown fallback. Original backed up to `/tmp/names-as-keys-phase2a-originals/ens-errors.md` before modification.
- Created evidence logs: `docs/prep/evidence/phase2a-E0-20261104-100936.log`, `docs/prep/evidence/phase2a-T7-20261104-100936.log`, `docs/prep/evidence/phase2a-T8-20261104-100936.log`, `docs/prep/evidence/phase2a-T10-20261104-100936.log`, `docs/prep/evidence/phase2a-E0-20261104-100948.log`, `docs/prep/evidence/phase2a-T7-20261104-100948.log`, `docs/prep/evidence/phase2a-T8-20261104-100948.log`, `docs/prep/evidence/phase2a-T10-20261104-100948.log`.

## Blocked

- E0 chain ID and block number: RPC DNS failure (redacted); `.env.example` absent.
- T7 upstream source diff and on-chain selector/implementation checks: source retrieval and RPC unavailable.
- T8 target-commit error inventory: upstream source unavailable; vendored inventory completed.
- T10 implementation-derived gates, entry points, and expected outcomes: source unavailable; design remains incomplete and unexecuted.
