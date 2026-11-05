# MetaMask transaction-review specification

**Preparation-only implementation:** `contracts/scripts/stage3e/prepare.py` exports and validates the decoded JSON plan and prints a local text review. It imports no network, wallet, Web3 or signing module. It never constructs a wallet provider, requests accounts or submits calldata. The two RPC inspection clients have explicit read-only method allowlists. Nine local tests check ABI consistency, rejection of invented targets/arguments, dependency ordering and refusal of transaction/signing methods before transport. No owner/guest website, extension integration or transaction executor exists in Stage 3E.

Local commands:

```sh
python3 contracts/scripts/stage3e/prepare.py --check
python3 contracts/scripts/stage3e/prepare.py --review
python3 -m unittest discover -s contracts/scripts/stage3e -p 'test_*.py' -v
```

Future separately authorized workflow requirements:

1. Explicitly connect selected MetaMask account and confirm chain 11155111. Display account, nonce, target and full decoded function/arguments, ETH value, ERC20 allowance/rent spend, predicted/derived address, expected changes/events, current block/hash, gas estimate/fee limits and all unresolved gates. Never infer account from the ENS deployment owner. No transaction control while BLOCKED.
2. User explicitly selects one step and separately chooses submit in the future execution UI. Every step requires its own wallet review/approval; no background queue, automatic broadcast, retry or blind signature. MetaMask can display network/target/value but decoding support varies; the local decoded review is mandatory and is compared to wallet details. Unknown/null inputs cannot be replaced with zero addresses.
3. The future executor must listen for chain/account changes, invalidate prepared estimates/calldata when either changes, and re-read time-sensitive ENS state immediately before asking for approval. Verify source/ABI hashes and detect stale ownership, role churn, registry replacement, expiry, allowance or commitment window changes.
4. Keep a local manifest status machine: BLOCKED → PREPARED → REVIEWED → user-requested submission → PENDING → CONFIRMED or FAILED/REJECTED. These states are a specification, not implemented signing capability. Persist public transaction hash immediately after user submission; preserve rejected/failed receipts and reasons. A local timeout is not a failed transaction.
5. Detect duplicate submissions by chain/account/nonce, step ID and calldata digest; check pending nonce/hash/receipt before any user-chosen replacement. Never resubmit merely because a page reload lost state. Replacement/cancellation must be explicit and reconciled against actual chain state. No automatic retries of pending or failed calls.
6. Advance only after receipt status=1, appropriate confirmation policy and independent expected-state reads. Wrong/missing events, unexpected contractAddress/code/config or reorg returns the plan to BLOCKED. Reconcile owner/ancestor token IDs after each transaction; do not rely on log names alone.
7. Keep plaintext registration commitment secret in private ephemeral local state until reveal, outside shared Git manifests; do not request/import/store MetaMask seeds or private keys. Public plan/logs contain no actual secret. Do not expose credential-bearing RPC endpoints. Registration secret recovery/loss policy must be reviewed before commit; expired commitment requires a fresh explicitly authorized attempt.

The current plan stores no public owner/guest account because none was supplied. Future manifest receipt/evidence fields must retain block/hash, from/to, input digest, status, decoded relevant events, addresses/config readbacks and confirmation/reorg state. No status transition may silently authorize the next transaction. Exact creation bytecode+constructor inputs must be prepared using reviewed compiler artifacts, not `forge --broadcast` expecting to invoke the MetaMask extension. Implementing the execution UI or an external deployer is a future authorization, not part of this stage.
