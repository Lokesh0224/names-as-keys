# AI-use disclosure draft

This is a provenance draft, not a claim that it satisfies event rules.

| Work category | Tool attribution | Status |
|---|---|---|
| Architecture, planning, research, and review | Claude, as attributed by the human. | USER-REPORTED; the exact per-task dates are not independently established in the repository. |
| Repository execution, implementation, test authoring/preparation, and test-result analysis | Codex, as attributed by the human and consistent with the repository work recorded in this workspace. | USER-REPORTED attribution; repository artifacts corroborate the work categories but do not encode tool identity. |
| Human-local Sepolia/Anvil fork test execution | Human operator. Retained evidence logs identify `executed_by=HUMAN-LOCAL`. | VERIFIED ARTIFACT in the evidence headers. Do not attribute those local RPC-dependent executions to an AI tool. |
| Initial project specification and review/handoff drafting | ChatGPT, as stated by the human. | USER-REPORTED; details and dates HUMAN TO CONFIRM if required. |
| Phase 1.5 documentation-only corrections | Codex desktop assistant. | VERIFIED ARTIFACT for this session's document edits. |
| Phase 0 / Phase 1 attribution conflict in the earlier draft | Resolved using the human's attribution above: Claude handled architecture/planning/research/review; Codex handled repository execution, implementation, and test work. Specific human-local fork runs remain attributed to the human operator as recorded in their logs. | CONFLICT RESOLVED with USER-REPORTED attribution and retained repository/evidence records. No per-task attribution beyond this split is inferred. |

Attribution basis: the prior conflict is recorded in `docs/prep/PHASE1_5_CHANGELOG.md`; the Claude/Codex category split above is the human-provided attribution. Repository documents and source artifacts establish the work performed but do not by themselves identify an AI tool. The T6a, T6b, A3-LITE, Q11, and consolidated T6 evidence headers identify the human-local fork executions as `HUMAN-LOCAL`.

## Scope deviation

[VERIFIED ARTIFACT] This `AI_USAGE.md` file was created during Phase 1 although the master prompt allocated it to Phase 3. This was a documentation-only scope deviation; it is recorded here and does not imply Phase 3 authorization.

## Disclosure requirement

Required disclosure format: **HUMAN TO CONFIRM from the official rules.** Do not treat this draft as verified compliance or organizer approval.
