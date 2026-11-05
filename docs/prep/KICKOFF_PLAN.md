# Kickoff plan

All timeboxes and actions below are **PROPOSAL** and should be adjusted to the actual solo time budget (currently UNKNOWN). Order is intentional: first prove the ugly E2E path, then polish only if time remains.

| Order | Timebox from kickoff | Action | Exit criterion |
|---|---:|---|---|
| 1 | 0–20 min | Check environment, official deployment addresses, RPC/chain, HTTPS preview, wallets, and parent-name authorization. | All prerequisites pass or contingency rung selected. |
| 2 | 20–50 min | Owner grants guest access through the minimum viable UI/contract path. | Grant transaction/state confirmed. |
| 3 | 50–80 min | Guest opens MetaMask mobile and performs the unlock flow. | Guest authorization result observed. |
| 4 | 80–100 min | Door reacts to the expected event. | Correct event observed and simulated door changes. |
| 5 | Immediately on first success | Record the working demo. | A copy is saved before further edits. |
| 6 | Remaining time | Fix only blockers; then improve copy/layout. | E2E remains repeatable. |

## Cut list

1. Cut resolver polish first.
2. Cut Anon-RPC first (the alternate RPC endpoint convenience), while preserving a verified primary read path and a documented contingency.
3. Then cut visual polish and nonessential owner/guest flows; preserve grant → guest unlock → door event.

**HUMAN TO CONFIRM:** actual time available, parent-name authorization, wallet/device, RPC providers, and any current deployment changes. This plan does not authorize live transactions.
