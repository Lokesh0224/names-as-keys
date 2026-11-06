# verifyReceipt correction

Changed only workflow.mjs and workflow.test.mjs; the prior versions are retained under prior/. No production-contract change or live RPC/wallet request.

- Latest canonical height must reach receiptHeight + confirmations - 1.
- Finalized height must separately reach receiptHeight, without requiring additional finalized confirmation depth.
- Historical postconditions remain at the receipt block. Current postconditions use a freshly identified latest block after historical verification; its confirmation depth is checked again.
- Both receipt and latest-state block hashes are re-read before confirmation. Journal evidence includes the latest-state and finalized block identities.

Workflow tests: **62 passed, 0 failed, 0 skipped** (54 existing and 8 new regression tests). Output: workflow-tests.log.

New regressions cover:

1. Latest111 / finalized100 / receipt100 meets12 confirmations and finality.
2. Latest110 / finalized100 fails12 confirmations.
3. Latest112 / finalized99 fails receipt finality despite sufficient confirmations.
4. Valid finalized state cannot hide invalid latest currentPostconditions.
5. Divergent finalized state does not replace valid latest currentPostconditions.
6. Latest advancing111→113 during historical reads uses113 for current state and records/rechecks its identity.
7. Reorged latest-state snapshot fails despite a stable receipt block.
8. Latest regressing111→110 during verification invalidates the confirmation count.

Focused changes: SOURCE_DIFF.patch. Hashes and command metadata: run.json. Earlier test logs, reports and review bundles remain historical and were not rewritten.

LIVE_EXECUTION_ALLOWED remains false. No staging, commit, signatures or broadcasts. Stage3F remains NO-GO.
