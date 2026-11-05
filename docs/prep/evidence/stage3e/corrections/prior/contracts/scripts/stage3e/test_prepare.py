"""Offline deployment-preparation checks; no RPC query, signing or transaction submission."""
import ast
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import prepare
import read_only_probe
import verify_live_artifacts


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((prepare.PLAN / 'deployment-manifest.json').read_text())
        self.abis = {p.stem: json.loads(p.read_text()) for p in (prepare.PLAN / 'abis').glob('*.json')}

    def test_all_fifteen_calls_and_events_match_exported_abis(self):
        self.assertEqual(prepare.validate(self.manifest, self.abis), 15)

    def test_initializer_tuple_and_role_policy(self):
        self.assertIn('initialize((address,uint256)[])', [prepare.signature(x) for x in self.abis['UserRegistryImpl'] if x['type']=='function'])
        roles=self.manifest['roles'];ops=1|(1<<8)|(1<<12)|(1<<16)|(1<<20)
        self.assertEqual(int(roles['OWNER_OPERATIONS_AND_ADMINS']),ops|(ops<<128))
        self.assertEqual(roles['REGISTRAR_ROOT_ROLES'],4097)
        self.assertEqual(roles['GUEST_TOKEN_ROLES'],0)
        self.assertEqual(roles['DOOR_KEYS_ROLES'],0)

    def test_own_exported_abis_equal_current_compiler_output(self):
        for name in ['CredentialRegistrar','DoorKeys']:
            compiled=json.loads((prepare.REPO/'contracts/out'/(name+'.sol')/(name+'.json')).read_text())['abi']
            self.assertEqual(self.abis[name],compiled)

    def test_vendored_consumed_signatures_outputs_and_mutability(self):
        pairs=[('IETHRegistrar','ETHRegistrar'),('IPermissionedRegistry','UserRegistryImpl'),('IVerifiableFactory','VerifiableFactory'),('IMockERC20','MockUSDC')]
        for local,export in pairs:
            abi=json.loads((prepare.REPO/'contracts/out'/(local+'.sol')/(local+'.json')).read_text())['abi']
            full={prepare.signature(x):x for x in self.abis[export] if x['type']=='function'}
            for item in abi:
                if item['type']!='function':continue
                current=full[prepare.signature(item)]
                self.assertEqual(item['stateMutability'],current['stateMutability'])
                self.assertEqual([prepare.abi_type(x) for x in item['outputs']],[prepare.abi_type(x) for x in current['outputs']])

    def test_missing_future_addresses_and_gas_never_fabricated(self):
        self.assertTrue(all(x['address'] is None for x in self.manifest['futureAddresses'].values()))
        for step in self.manifest['transactions']:
            self.assertIsNone(step['calldata']);self.assertIsNone(step['gasEstimate']);self.assertIsNone(step['transactionHash'])
        changed=copy.deepcopy(self.manifest);changed['futureAddresses']['R1']['address']='invented-address'
        with self.assertRaises(AssertionError):prepare.validate(changed,self.abis)

    def test_unknown_abi_or_argument_count_fails(self):
        changed=copy.deepcopy(self.manifest);changed['transactions'][0]['signature']='invented()'
        with self.assertRaises(AssertionError):prepare.validate(changed,self.abis)
        changed=copy.deepcopy(self.manifest);changed['transactions'][0]['arguments']=[]
        with self.assertRaises(AssertionError):prepare.validate(changed,self.abis)

    def test_target_tampering_and_out_of_order_dependencies_fail(self):
        changed=copy.deepcopy(self.manifest);changed['transactions'][0]['target']['value']=prepare.ZERO
        with self.assertRaises(AssertionError):prepare.validate(changed,self.abis)
        changed=copy.deepcopy(self.manifest);changed['transactions'][0]['dependsOn']=['T15']
        with self.assertRaises(AssertionError):prepare.validate(changed,self.abis)

    def test_rpc_clients_refuse_every_write_or_sign_method_before_transport(self):
        forbidden=['eth_sendTransaction','eth_sendRawTransaction','eth_sign','personal_sign','eth_signTypedData_v4','wallet_sendCalls','wallet_requestPermissions']
        for module in [read_only_probe,verify_live_artifacts]:
            with patch('urllib.request.urlopen') as transport:
                for method in forbidden:
                    with self.assertRaises(ValueError):module.rpc(method,[])
                transport.assert_not_called()

    def test_offline_exporter_has_no_network_or_wallet_imports(self):
        tree=ast.parse(Path(prepare.__file__).read_text());imports=[]
        for item in ast.walk(tree):
            if isinstance(item,ast.Import):imports.extend(x.name for x in item.names)
            elif isinstance(item,ast.ImportFrom):imports.append(item.module)
        self.assertEqual(set(imports),{'argparse','hashlib','json','pathlib'})
        self.assertFalse(self.manifest['broadcastEnabled']);self.assertFalse(self.manifest['walletRequestsEnabled'])
        self.assertEqual(self.manifest['stage3FDecision'],'NO_GO')


if __name__=='__main__':unittest.main(verbosity=2)
