# Live demo readiness plan

This is a preparation checklist, not a statement that a live demo is ready or authorized.

| Area | Readiness item | Status / action |
|---|---|---|
| Owner wallet | Identify the parent owner account and confirm control/permissions. | HUMAN TO CONFIRM; no wallet address is committed here. |
| Guest wallet | Identify a separate guest account and ensure the guest's mobile wallet can access it. | HUMAN TO CONFIRM. |
| Test ETH | Amount to hold for each wallet. | UNKNOWN; calculate from actual permitted transaction sequence and current fees, then hold a buffer. Do not fund or transact during preparation. |
| Faucet | Candidate Sepolia faucet(s), caps, auth, and availability. | HUMAN TO CONFIRM from official Ethereum Sepolia faucet and selected provider faucet pages; no availability claim. |
| RPC primary/backup | Select two Sepolia read/write endpoints and check limits. | HUMAN TO CONFIRM provider and quotas; keep values in ignored environment only, never docs. |
| Hosting | Use static Vercel hosting; no backend. | PROPOSAL consistent with frozen architecture; project/account/domain/HTTPS status is HUMAN TO CONFIRM. |
| Mobile wallet | Open the HTTPS demo in MetaMask mobile's in-app browser; test Sepolia chain detection/switch. | NOT TESTED; HUMAN TO CONFIRM on target device and official wallet behavior. |
| Timing | Budget for commit/reveal and confirmations; handle pending, rejected, delayed, and failed transactions. | PROPOSAL: display each state and allow safe retry; Stage 0 reported a 60-second commitment minimum on a local fork, but recheck current deployment before a live sequence. |
| Deployment drift | Compare every consumed address in deployment manifest against ENS's official deployments page; check non-empty code and expected chain before proceeding. | PROPOSAL; official page must be rechecked at kickoff. Any mismatch blocks the live demo until reviewed. |
| Parent name | Confirm an existing authorized parent name or another approved test path. | HUMAN TO CONFIRM; no purchase or registration is implied by this plan. |

## First live E2E sequence after kickoff

Every action below is **PROPOSAL** and requires the applicable future phase/live-action authorization. No live transaction has been run by this preparation phase.

1. Confirm chain ID, deployment addresses, bytecode, owner/guest balances, RPC health, HTTPS URL, and an authorized existing parent.
2. Owner connects and grants the guest an expiring subname under the approved flow.
3. Guest opens the HTTPS page in MetaMask mobile, confirms Sepolia, and attempts the authorized unlock flow.
4. Simulated door reacts only after the expected on-chain event is observed.
5. Test expiry/revocation/failure states and record timestamps/errors.
6. Capture the first successful end-to-end run before polishing UI.

No step asserts live-demo readiness until actually performed and recorded.
