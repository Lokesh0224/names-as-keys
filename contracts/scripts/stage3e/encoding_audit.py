"""Offline ABI typing/encoding and source-derived role checks. Never a transaction client."""
import ast
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'docs/prep/evidence/stage3e/ens-standard-input.json'
REGISTRATION_BITMAP = 97409655027181761882228017414928043058140282880


def source_roles():
    sources = json.loads(SOURCE.read_text())['sources']
    library = sources['project/src/registry/libraries/RegistryRolesLib.sol']['content']
    registrar = sources['project/src/registrar/ETHRegistrar.sol']['content']
    values = {}

    def evaluate(text):
        def visit(node):
            if isinstance(node, ast.Constant) and type(node.value) is int:
                return node.value
            if isinstance(node, ast.Name):
                return values[node.id]
            if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.BitOr, ast.LShift)):
                a, b = visit(node.left), visit(node.right)
                return a | b if isinstance(node.op, ast.BitOr) else a << b
            raise ValueError('Unsupported role expression')
        return visit(ast.parse(text.strip(), mode='eval').body)

    for name, expression in re.findall(r'uint256\s+internal\s+constant\s+(\w+)\s*=\s*([^;]+);', library):
        values[name] = evaluate(' '.join(expression.split()))
    expression = re.search(r'uint256 constant REGISTRATION_ROLE_BITMAP\s*=\s*([^;]+);', registrar)[1]
    result = evaluate(' '.join(expression.replace('RegistryRolesLib.', '').split()))
    assert result == REGISTRATION_BITMAP
    return result, values


def cast_encode(signature, arguments, constructor=False):
    """Only pure local encoders; no URL, environment, signer or shell arguments."""
    command = 'abi-encode' if constructor else 'calldata'
    return subprocess.check_output(['cast', command, signature, *arguments], text=True).strip().lower()


def check_value(spec, value, manifest):
    kind = spec['type']
    if kind.endswith('[]'):
        assert isinstance(value, list)
        for item in value:
            check_value({**spec, 'type': kind[:-2]}, item, manifest)
        return
    if kind == 'tuple':
        assert isinstance(value, dict) and set(value) == {x['name'] for x in spec['components']}
        for field in spec['components']:
            check_value(field, value[field['name']], manifest)
        return
    if isinstance(value, dict):
        if 'reference' in value:
            name = value['reference'].removeprefix('verified.')
            assert value == manifest['verifiedAddresses'][name]
            value = value['value']
        else:
            assert value['value'] is None and value['classification'] == 'UNVERIFIED'
            assert value['binding'] in {
                'accounts.owner', 'accounts.guest', 'quote.basePlusPremium',
                'registration.commitment', 'privateRegistrationState.secret',
                'salts.R1', 'salts.R2', 'encoded.initializeOwnerGrants',
                'receipts.rootTokenId', 'receipts.lockTokenId',
                'inputs.lockExpiry', 'inputs.guestExpiry',
                *(f'future.{n}' for n in manifest['futureAddresses']),
            }
            path = value['binding']
            expected_type = ('address' if path.startswith(('accounts.', 'future.')) else
                             'bytes32' if path in ('registration.commitment', 'privateRegistrationState.secret') else
                             'bytes' if path == 'encoded.initializeOwnerGrants' else
                             'uint64' if path in ('inputs.lockExpiry', 'inputs.guestExpiry') else 'uint256')
            assert kind == expected_type, (path, kind, expected_type)
            return
    if kind == 'address':
        assert isinstance(value, str) and re.fullmatch(r'0x[0-9a-fA-F]{40}', value)
    elif kind.startswith('uint'):
        assert type(value) in (str, int) and not isinstance(value, bool)
        assert 0 <= int(value) < 2 ** int(kind[4:] or '256')
    elif kind.startswith('bytes'):
        assert isinstance(value, str) and re.fullmatch(r'0x(?:[0-9a-fA-F]{2})*', value)
        if kind != 'bytes':
            assert len(value) == 2 + 2 * int(kind[5:])
    elif kind == 'string':
        assert isinstance(value, str)
    else:
        raise AssertionError('Unhandled ABI type ' + kind)


def unresolved(value):
    if isinstance(value, dict):
        if 'binding' in value:
            return [value['binding']]
        return [x for v in value.values() for x in unresolved(v)]
    if isinstance(value, list):
        return [x for v in value for x in unresolved(v)]
    return []


def enrich(manifest, abis, signature):
    root_bitmap, _ = source_roles()
    manifest['roles']['ROOT_REGISTRATION_ROLE_BITMAP'] = str(root_bitmap)
    # Exact mandatory application events. External LabelStore logs are separately blocked.
    additions = {
        'T04': [('MockUSDC', 'Transfer', 'verified.MockUSDC'), ('ETHRegistry', 'TransferSingle', 'verified.ETHRegistry'), ('ETHRegistry', 'TokenResource', 'verified.ETHRegistry'), ('ETHRegistry', 'EACRolesChanged', 'verified.ETHRegistry')],
        'T05': [('UserRegistryImpl', x, 'future.R1') for x in ['Upgraded', 'URIUpdated', 'Initialized']],
        'T08': [('UserRegistryImpl', x, 'future.R1') for x in ['TransferSingle', 'EACRolesChanged']],
        'T09': [('UserRegistryImpl', x, 'future.R2') for x in ['Upgraded', 'URIUpdated', 'Initialized']],
        'T15': [('UserRegistryImpl', x, 'future.R2') for x in ['TransferSingle', 'TokenResource']],
    }
    for step in manifest['transactions']:
        target = step['target']
        emitter = None if target is None else target.get('reference', target.get('binding'))
        for event in step['expectedEvents']:
            event['emitterBinding'] = emitter
            if step['id'] in ('T05', 'T09') and event.get('abi') == 'UserRegistryImpl':
                event['emitterBinding'] = 'future.R1' if step['id'] == 'T05' else 'future.R2'
            if step['id'] == 'T04' and event.get('abi') == 'ETHRegistry':
                event['emitterBinding'] = 'verified.ETHRegistry'
            if step['id'] == 'T15' and event.get('abi') == 'UserRegistryImpl':
                event['emitterBinding'] = 'future.R2'
        for abi, name, event_emitter in additions.get(step['id'], []):
            step['expectedEvents'].append({'abi': abi, 'name': name, 'emitterBinding': event_emitter})
        for event in step['expectedEvents']:
            item = next(x for x in abis[event.get('abi', step['abi'])] if x['type'] == 'event' and x['name'] == event['name'])
            event['signature'] = signature(item)
            event['fields'] = [{'name': x['name'], 'type': x['type'], 'indexed': x['indexed']} for x in item['inputs']]
            event['requiredCount'] = 1
            event['valueValidation'] = 'Reconcile every decoded field with exact reviewed arguments, sender, receipt-created addresses, token/resource readback and receipt block; ABI matching alone is insufficient.'
        blockers = sorted(set(unresolved(step['arguments']) + unresolved(target)))
        step['validation'] = {
            'abiSignature': 'PASS: canonical signature, recursive argument types and exact event layouts checked offline',
            'offlineEncoding': 'BLOCKED: unresolved ' + ', '.join(blockers) if blockers else 'ARGUMENTS_KNOWN: target unresolved; standalone encoder vector only',
            'unresolvedBindings': blockers,
            'forkSimulation': 'NOT_RUN: exact future transaction inputs/state unresolved; earlier security tests are not a simulation of this manifest',
            'liveExecution': 'BLOCKED: Stage 3F NO_GO; source/runtime, accounts, roles, fresh quote/state/gas and separate authorization required',
        }
        if step['id'] == 'T07':
            # Known arguments can be tested, but the unresolved R1 target blocks a final payload.
            step['validation']['knownArgumentEncoding'] = cast_encode(step['signature'], [manifest['verifiedAddresses']['ETHRegistry']['value'], 'nak-lokesh-20261105'])
        step['eventScope'] = 'Exact mandatory application event signatures/layouts and emitter bindings, not a proven exhaustive receipt log stream. LabelStore external logs/callbacks and value/order reconciliation require future exact-state simulation; unexpected logs stop review.'
    orders = {
        'T04': ['Transfer', 'LabelRegistered', 'TransferSingle', 'TokenResource', 'EACRolesChanged', 'NameRegistered'],
        'T05': ['Upgraded', 'RegistryCreated', 'EACRolesChanged', 'URIUpdated', 'Initialized', 'ProxyDeployed'],
        'T08': ['LabelRegistered', 'TransferSingle', 'TokenResource', 'EACRolesChanged'],
        'T09': ['Upgraded', 'RegistryCreated', 'EACRolesChanged', 'URIUpdated', 'Initialized', 'ProxyDeployed'],
        'T15': ['LabelRegistered', 'TransferSingle', 'TokenResource', 'CredentialIssued'],
    }
    for step in manifest['transactions']:
        step['expectedApplicationEventOrder'] = orders.get(step['id'], [e['name'] for e in step['expectedEvents']])
    manifest['validationLayers'] = ['ABI_SIGNATURE_AND_TYPES', 'OFFLINE_ENCODING', 'FORK_SIMULATION', 'FUTURE_LIVE_STATE_EXECUTION']


def validate(manifest, abis, signature):
    assert int(manifest['roles']['ROOT_REGISTRATION_ROLE_BITMAP']) == source_roles()[0]
    operations = 1 | (1 << 8) | (1 << 12) | (1 << 16) | (1 << 20)
    grants = operations | operations << 128
    lock_roles = (1 << 20) | (1 << 148) | (1 << 156)
    assert int(manifest['roles']['OWNER_OPERATIONS_AND_ADMINS']) == grants
    assert int(manifest['roles']['LOCK_OWNER_TOKEN_ROLES']) == lock_roles
    assert manifest['roles']['REGISTRAR_ROOT_ROLES'] == 4097
    assert manifest['roles']['GUEST_TOKEN_ROLES'] == manifest['roles']['DOOR_KEYS_ROLES'] == 0
    assert int(manifest['encodingRecipes']['initializeOwnerGrants']['arguments'][0][0]['roleBitmap']) == grants
    assert int(manifest['transactions'][7]['arguments'][4]) == lock_roles
    assert manifest['transactions'][12]['arguments'][0] == 4097
    assert manifest['root'] == 'nak-lokesh-20261105.eth'
    assert manifest['encodingRecipes']['initializeOwnerGrants']['arguments'][0][0]['account'] == {
        'binding': 'accounts.owner', 'value': None, 'classification': 'UNVERIFIED'}
    targets = ['verified.MockUSDC', 'verified.MockUSDC', 'verified.ETHRegistrar',
               'verified.ETHRegistrar', 'verified.VerifiableFactory', 'verified.ETHRegistry',
               'future.R1', 'future.R1', 'verified.VerifiableFactory', 'future.R1',
               'future.R2', None, 'future.R2', None, 'future.CredentialRegistrar']
    known = {
        'T02': {0: manifest['verifiedAddresses']['ETHRegistrar']},
        'T04': {0: 'nak-lokesh-20261105', 3: '0x' + '00' * 20, 4: '0x' + '00' * 20,
                5: 31536000, 6: manifest['verifiedAddresses']['MockUSDC'], 7: '0x' + '00' * 32},
        'T05': {0: manifest['verifiedAddresses']['UserRegistryImpl']},
        'T07': {0: manifest['verifiedAddresses']['ETHRegistry'], 1: 'nak-lokesh-20261105'},
        'T08': {0: 'lock', 2: '0x' + '00' * 20, 3: '0x' + '00' * 20, 4: str(lock_roles)},
        'T09': {0: manifest['verifiedAddresses']['UserRegistryImpl']},
        'T11': {1: 'lock'}, 'T12': {1: 'nak-lokesh-20261105'},
        'T14': {1: 'nak-lokesh-20261105', 4: 1}, 'T15': {0: 'mira'},
    }
    assert len(manifest['transactions']) == len(targets)
    for index, step in enumerate(manifest['transactions']):
        assert step['id'] == f'T{index + 1:02d}'
        target = step['target']
        assert (None if target is None else target.get('reference', target.get('binding'))) == targets[index]
        for argument, expected in known.get(step['id'], {}).items():
            assert step['arguments'][argument] == expected
    expected_paths = {
        'T01': {0: 'accounts.owner', 1: 'quote.basePlusPremium'},
        'T02': {1: 'quote.basePlusPremium'}, 'T03': {0: 'registration.commitment'},
        'T04': {1: 'accounts.owner', 2: 'privateRegistrationState.secret'},
        'T05': {1: 'salts.R1', 2: 'encoded.initializeOwnerGrants'},
        'T06': {0: 'receipts.rootTokenId', 1: 'future.R1'},
        'T08': {1: 'accounts.owner', 5: 'inputs.lockExpiry'},
        'T09': {1: 'salts.R2', 2: 'encoded.initializeOwnerGrants'},
        'T10': {0: 'receipts.lockTokenId', 1: 'future.R2'},
        'T11': {0: 'future.R1'},
        'T12': {0: 'accounts.owner', 2: 'future.R1', 3: 'future.R2'},
        'T13': {1: 'future.CredentialRegistrar'},
        'T14': {0: 'accounts.owner', 2: 'future.R1', 3: 'future.R2'},
        'T15': {1: 'accounts.guest', 2: 'inputs.guestExpiry'},
    }
    for step in manifest['transactions']:
        for index, expected in expected_paths.get(step['id'], {}).items():
            assert step['arguments'][index]['binding'] == expected
        item = next(x for x in abis[step['abi']] if x['type'] in ('function', 'constructor') and signature(x) == step['signature'])
        for spec, value in zip(item['inputs'], step['arguments'], strict=True):
            check_value(spec, value, manifest)
        assert sorted(step['expectedApplicationEventOrder']) == sorted(e['name'] for e in step['expectedEvents'])
        for event in step['expectedEvents']:
            item = next(x for x in abis[event.get('abi', step['abi'])] if x['type'] == 'event' and x['name'] == event['name'])
            target = step['target']
            emitter = None if target is None else target.get('reference', target.get('binding'))
            event_abi = event.get('abi', step['abi'])
            if step['id'] == 'T04':
                emitter = 'verified.' + event_abi
            elif step['id'] in ('T05', 'T09') and event_abi == 'UserRegistryImpl':
                emitter = 'future.R1' if step['id'] == 'T05' else 'future.R2'
            elif step['id'] == 'T15' and event_abi == 'UserRegistryImpl':
                emitter = 'future.R2'
            assert event['emitterBinding'] == emitter
            assert event['signature'] == signature(item)
            assert event['fields'] == [{'name': x['name'], 'type': x['type'], 'indexed': x['indexed']} for x in item['inputs']]
            assert event['emitterBinding'] in {*('verified.' + x for x in manifest['verifiedAddresses']), *('future.' + x for x in manifest['futureAddresses'])}
        assert step['validation']['unresolvedBindings'] == sorted(set(unresolved(step['arguments']) + unresolved(step['target'])))
    recipe = manifest['encodingRecipes']['initializeOwnerGrants']
    item = next(x for x in abis[recipe['abi']] if x['type'] == 'function' and signature(x) == recipe['signature'])
    for spec, value in zip(item['inputs'], recipe['arguments'], strict=True):
        check_value(spec, value, manifest)


def scalar_encoding(kind, value):
    """Independent single-argument ABI reference encoder for known manifest leaves."""
    word = lambda n: int(n).to_bytes(32, 'big').hex()
    if kind == 'address':
        return '0x' + word(int(value, 16))
    if kind.startswith('uint'):
        return '0x' + word(value)
    if kind == 'bytes32':
        return value.lower()
    if kind == 'string':
        raw = value.encode()
        return '0x' + word(32) + word(len(raw)) + raw.hex() + '00' * ((-len(raw)) % 32)
    raise AssertionError('Unsupported reference type ' + kind)


def encoding_report(manifest, abis, signature):
    report = {'scope': 'OFFLINE_ONLY: no complete manifest transaction or future live execution simulated', 'knownLeaves': [], 'blockedTransactions': []}
    for step in manifest['transactions']:
        item = next(x for x in abis[step['abi']] if x['type'] in ('function', 'constructor') and signature(x) == step['signature'])
        for index, (spec, value) in enumerate(zip(item['inputs'], step['arguments'], strict=True)):
            if unresolved(value):
                continue
            if isinstance(value, dict):
                value = value['value']
            actual = cast_encode('f(' + spec['type'] + ')', [str(value)], constructor=True)
            assert actual == scalar_encoding(spec['type'], value)
            report['knownLeaves'].append({'transaction': step['id'], 'argumentIndex': index, 'type': spec['type'], 'value': value, 'encoding': actual, 'comparison': 'PASS: cast vs independent reference encoder'})
        report['blockedTransactions'].append({'id': step['id'], 'calldata': None, 'unresolved': step['validation']['unresolvedBindings'], 'forkSimulation': 'NOT_RUN', 'liveExecution': 'BLOCKED'})
    return report
