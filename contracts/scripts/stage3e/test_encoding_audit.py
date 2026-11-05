"""Stage 3E correction tests: ABI encoding is not execution or a live-state proof."""
import copy
import json
import re
import unittest
from pathlib import Path

import encoding_audit as audit
import prepare


class EncodingAuditTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((prepare.PLAN / 'deployment-manifest.json').read_text())
        self.abis = {p.stem: json.loads(p.read_text()) for p in (prepare.PLAN / 'abis').glob('*.json')}

    def test_registration_bitmap_source_document_manifest_and_fork_assertion_agree(self):
        bitmap, roles = audit.source_roles()
        self.assertEqual(bitmap, int(self.manifest['roles']['ROOT_REGISTRATION_ROLE_BITMAP']))
        self.assertIn(str(bitmap), (prepare.PLAN / 'ADMIN_ROLE_CHECKLIST.md').read_text())
        fork = (prepare.REPO / 'contracts/test/stage3e/RegistrationRoleReadback.t.sol').read_text()
        self.assertIn('DEPLOYED_REGISTRATION_BITMAP = ' + str(bitmap), fork)
        operations = sum(roles[name] for name in ['ROLE_REGISTRAR', 'ROLE_SET_PARENT', 'ROLE_UNREGISTER', 'ROLE_RENEW', 'ROLE_SET_SUBREGISTRY'])
        self.assertEqual(int(self.manifest['roles']['OWNER_OPERATIONS_AND_ADMINS']), operations | operations << 128)
        self.assertEqual(int(self.manifest['roles']['LOCK_OWNER_TOKEN_ROLES']), roles['ROLE_SET_SUBREGISTRY'] | roles['ROLE_SET_SUBREGISTRY_ADMIN'] | roles['ROLE_CAN_TRANSFER_ADMIN'])
        self.assertEqual((operations | operations << 128) & (roles['ROLE_UPGRADE'] | roles['ROLE_UPGRADE_ADMIN']), 0)

    def test_every_known_manifest_argument_encodes_against_independent_reference(self):
        report = audit.encoding_report(self.manifest, self.abis, prepare.signature)
        self.assertGreater(len(report['knownLeaves']), 20)
        self.assertEqual(len(report['blockedTransactions']), 15)
        self.assertTrue(all(s['calldata'] is None for s in report['blockedTransactions']))

    def test_known_set_parent_arguments_match_independent_dynamic_encoding(self):
        step = self.manifest['transactions'][6]
        actual = audit.cast_encode(step['signature'], [step['arguments'][0]['value'], step['arguments'][1]])
        address = audit.scalar_encoding('address', step['arguments'][0]['value'])[2:]
        label = step['arguments'][1].encode()
        word = lambda n: n.to_bytes(32, 'big').hex()
        arguments = address + word(64) + word(len(label)) + label.hex() + '00' * ((-len(label)) % 32)
        self.assertEqual(actual[10:], arguments)
        self.assertEqual(actual, step['validation']['knownArgumentEncoding'])
        self.assertIsNone(step['calldata'])
        self.assertIn('future.R1', step['validation']['unresolvedBindings'])

    def test_nested_initializer_and_factory_dynamic_bytes_round_trip_reference(self):
        # Explicit TEST ONLY account/salt, never substituted into the live manifest.
        account = '0x00000000000000000000000000000000000a11ce'
        roles = self.manifest['roles']['OWNER_OPERATIONS_AND_ADMINS']
        inner = audit.cast_encode('initialize((address,uint256)[])', [f'[({account},{roles})]'])
        word = lambda n: int(n).to_bytes(32, 'big').hex()
        self.assertEqual(inner[10:], word(32) + word(1) + word(int(account, 16)) + word(roles))
        impl = self.manifest['verifiedAddresses']['UserRegistryImpl']['value']
        outer = audit.cast_encode('deployProxy(address,uint256,bytes)', [impl, '1', inner])
        raw = bytes.fromhex(inner[2:])
        self.assertEqual(outer[10:], word(int(impl, 16)) + word(1) + word(96) + word(len(raw)) + raw.hex() + '00' * ((-len(raw)) % 32))
        self.assertIsNone(self.manifest['encodingRecipes']['initializeOwnerGrants']['encodedBytes'])

    def test_constructor_types_encode_without_function_selector_test_only(self):
        address = '0x00000000000000000000000000000000000a11ce'
        # Static encoding verifies widths only; no unknown production addresses are filled.
        value = audit.cast_encode('constructor(uint256,uint64,address)', ['1', str(2**64 - 1), address], constructor=True)
        self.assertEqual(value, '0x' + (1).to_bytes(32, 'big').hex() + (2**64 - 1).to_bytes(32, 'big').hex() + int(address, 16).to_bytes(32, 'big').hex())
        # Exercise both actual constructor signatures with explicit test-only inputs.
        label = 'nak-lokesh-20261105'
        raw = label.encode()
        word = lambda n: int(n).to_bytes(32, 'big').hex()
        for name, signature, epoch in [
            ('CredentialRegistrar', 'constructor(address,string,address,address)', []),
            ('DoorKeys', 'constructor(address,string,address,address,uint256)', ['1']),
        ]:
            self.assertIn(signature, [prepare.signature(x) for x in self.abis[name] if x['type'] == 'constructor'])
            encoded = audit.cast_encode(signature, [address, label, address, address, *epoch], constructor=True)
            heads = word(int(address, 16)) + word((4 + len(epoch)) * 32) + word(int(address, 16)) * 2
            if epoch:
                heads += word(1)
            tail = word(len(raw)) + raw.hex() + '00' * ((-len(raw)) % 32)
            self.assertEqual(encoded, '0x' + heads + tail)


    def test_integer_width_bytes_length_address_and_binding_mismatches_rejected(self):
        for kind, value in [('uint64', 2**64), ('uint64', -1), ('uint256', 2**256), ('address', '0x1234'), ('bytes32', '0x00'), ('uint64', True)]:
            with self.assertRaises(AssertionError):
                audit.check_value({'type': kind}, value, self.manifest)
        changed = copy.deepcopy(self.manifest)
        changed['transactions'][14]['arguments'][2] = prepare.binding('future.R1')
        with self.assertRaises(AssertionError):
            prepare.validate(changed, self.abis)

    def test_nested_tuple_and_event_layout_tampering_rejected(self):
        changed = copy.deepcopy(self.manifest)
        changed['encodingRecipes']['initializeOwnerGrants']['arguments'][0][0]['roleBitmap'] = str(2**256)
        with self.assertRaises(AssertionError):
            prepare.validate(changed, self.abis)
        changed = copy.deepcopy(self.manifest)
        changed['transactions'][0]['expectedEvents'][0]['fields'][0]['indexed'] = False
        with self.assertRaises(AssertionError):
            prepare.validate(changed, self.abis)

    def test_same_type_wrong_door_binding_and_event_emitter_rejected(self):
        changed = copy.deepcopy(self.manifest)
        changed['transactions'][9]['arguments'][1] = prepare.binding('future.R1')
        with self.assertRaises(AssertionError):
            prepare.validate(changed, self.abis)
        changed = copy.deepcopy(self.manifest)
        changed['transactions'][7]['expectedEvents'][0]['emitterBinding'] = 'future.R2'
        with self.assertRaises(AssertionError):
            prepare.validate(changed, self.abis)

    def test_verified_but_wrong_contract_or_payment_binding_rejected(self):
        changed = copy.deepcopy(self.manifest)
        changed['transactions'][4]['target'] = changed['verifiedAddresses']['ETHRegistry']
        with self.assertRaises(AssertionError):
            prepare.validate(changed, self.abis)
        changed = copy.deepcopy(self.manifest)
        changed['transactions'][3]['arguments'][6] = changed['verifiedAddresses']['MockDAI']
        with self.assertRaises(AssertionError):
            prepare.validate(changed, self.abis)

    def test_all_steps_distinguish_four_verification_layers_and_stay_blocked(self):
        for step in self.manifest['transactions']:
            self.assertTrue(step['validation']['abiSignature'].startswith('PASS'))
            self.assertIn('NOT_RUN', step['validation']['forkSimulation'])
            self.assertIn('BLOCKED', step['validation']['liveExecution'])
            self.assertTrue(step['validation']['unresolvedBindings'])
            self.assertIsNone(step['calldata'])
            self.assertIsNone(step['gasEstimate'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
