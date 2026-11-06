"""Local evidence/guard tests, never wallet or transaction tests."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import probe
import reconcile_runtime


class GateAuditTests(unittest.TestCase):
    def test_rpc_write_and_sign_methods_rejected_before_network(self):
        with patch('urllib.request.urlopen') as transport:
            for method in ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'eth_sign', 'eth_signTypedData_v4', 'wallet_sendCalls', 'wallet_requestPermissions']:
                with self.assertRaises(ValueError):
                    probe.rpc(method, [])
            transport.assert_not_called()

    def test_every_recorded_method_is_read_only_or_nonpersistent_estimation(self):
        records = json.loads((probe.OUT / 'rpc-transcript.json').read_text())
        self.assertTrue(records)
        for record in records:
            self.assertIn(record['method'], probe.ALLOWED)
            self.assertNotIn(record['method'], ['eth_sendTransaction', 'eth_sendRawTransaction'])

    def test_both_candidates_use_owner_verified_token_and_zero_eth(self):
        report = json.loads((probe.OUT / 'read-only-observation.json').read_text())
        self.assertEqual([s['id'] for s in report['simulations']], ['T01', 'T02'])
        for step in report['simulations']:
            self.assertEqual(step['transaction']['from'], probe.OWNER)
            self.assertEqual(step['transaction']['to'], report['contracts']['MockUSDC']['address'])
            self.assertEqual(step['transaction']['value'], '0x0')
            self.assertIn('NOT_APPROVED_DEPLOYMENT_INPUT', step['classification'])
            self.assertIn('result', step['ethCall'])
            self.assertGreater(int(step['estimateGas']['result'], 16), 0)

    def test_semantic_runtime_evidence_every_named_immutable_matches(self):
        record = json.loads((probe.OUT / 'semantic-runtime-reconciliation.json').read_text())
        self.assertEqual(len(record['contracts']), 9)
        for result in record['contracts'].values():
            self.assertTrue(result['fullRuntimeByteEqual'])
            for entry in result.get('immutableChecks', []):
                self.assertTrue(entry['matches'])
                self.assertTrue(all(v == entry['expected'] for v in entry['observed']))

    def test_semantic_reconciliation_detects_runtime_corruption(self):
        # Re-run the actual source-derived reconciliation, then corrupt real runtime bytes.
        compiled_path = Path('/tmp/nak-stage3f-reproduced.json')
        self.assertTrue(compiled_path.exists(), 'Run compile_sources.py first')
        compiled = json.loads(compiled_path.read_text())
        ast = json.loads((probe.OUT / 'compiler-audit.json').read_text())['immutableDeclarations']
        current = json.loads((probe.OUT / 'read-only-observation.json').read_text())
        reproduction = json.loads((probe.ROOT / 'docs/prep/evidence/stage3e/source-reproduction.json').read_text())
        old = json.loads((probe.ROOT / 'docs/prep/evidence/stage3e/live-artifact-comparison.json').read_text())
        baseline = reconcile_runtime.reconcile(compiled, ast, current, reproduction, old)
        self.assertTrue(all(c['fullRuntimeByteEqual'] for c in baseline.values()))
        bad = copy.deepcopy(current)
        code = bad['contracts']['ETHRegistrar']['code']
        bad['contracts']['ETHRegistrar']['code'] = '0x' + ('ff' if code[2:4] != 'ff' else '00') + code[4:]
        corrupted = reconcile_runtime.reconcile(compiled, ast, bad, reproduction, old)
        self.assertFalse(corrupted['ETHRegistrar']['fullRuntimeByteEqual'])

    def test_labelstore_and_ancestor_token_proofs(self):
        label = json.loads((probe.OUT / 'labelstore-verification.json').read_text())
        for key in ['creationTemplateExact', 'runtimeTemplateExact', 'fullLiveRuntimeExact', 'abiExact', 'canonicalSuccessfulReceipt']:
            self.assertTrue(label[key])
        self.assertEqual(label['namerGetter']['result'][2:], label['expectedContractNamer'])
        self.assertEqual(label['eventSignatures'], ['Label(bytes32,string)'])
        ancestor = json.loads((probe.OUT / 'ancestor-reconciliation.json').read_text())
        self.assertTrue(all(ancestor['checks'].values()))

    def test_existing_root_role_histories_reconcile_full_counts(self):
        report = json.loads((probe.OUT / 'read-only-observation.json').read_text())
        for history in report['roleHistories'].values():
            self.assertTrue(history['complete'])
            self.assertTrue(history['reconciled'])
            self.assertTrue(all(h['matchesEvents'] for h in history['holders']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
