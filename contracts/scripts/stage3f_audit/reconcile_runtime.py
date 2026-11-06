"""Offline semantic immutable reconciliation. No RPC, signer or execution path."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/prep/evidence/stage3f-audit'


def keccak(data):
    return subprocess.check_output(['cast', 'keccak', '0x' + data.hex()], text=True).strip()[2:]


def word(value):
    return int(value, 16).to_bytes(32, 'big').hex() if isinstance(value, str) and value.startswith('0x') else int(value).to_bytes(32, 'big').hex()


def constructor_words(record):
    raw = record['constructorArgumentsHex'][2:]
    return [int(raw[i:i + 64], 16) for i in range(0, len(raw), 64)]


def expectations(name, record):
    args = constructor_words(record)
    if name == 'ETHRegistrar':
        return dict(zip(['ETH_REGISTRY', 'BENEFICIARY', 'GRACE_PERIOD', 'MIN_COMMITMENT_AGE', 'MAX_COMMITMENT_AGE', 'MIN_REGISTER_DURATION'], map(word, [args[1], args[2], *args[4:8]])))
    if name in ('ETHRegistry', 'RootRegistry'):
        return {'LABEL_STORE': word(args[0])}
    if name == 'UserRegistryImpl':
        return {'LABEL_STORE': word(args[0]), 'URI_RENDERER': word(args[1]), '__self': word(record['address'])}
    if name == 'VerifiableFactory':
        # Fresh contract's first CREATE uses nonce 1, sole CREATE in constructor.
        proxy = keccak(bytes.fromhex('d694' + record['address'][2:] + '01'))[-40:]
        return {'proxyLogic': word('0x' + proxy)}
    if name == 'StandardRentPriceOracle':
        discount_count = args[args[2] // 32]
        assert args[5] != 0 and args[6] % args[5] == 0, 'This proof supports the observed integer halving ratio only'
        return dict(zip(['DISCOUNT_DENOMINATOR', 'PREMIUM_PRICE_INITIAL', 'PREMIUM_HALVING_PERIOD', 'PREMIUM_PERIOD', 'PREMIUM_PRICE_OFFSET'], map(word, [args[3] if discount_count else 0, args[4], args[5], args[6], args[4] >> (args[6] // args[5])])) )
    if name in ('MockUSDC', 'MockDAI'):
        raw = bytes.fromhex(record['constructorArgumentsHex'][2:])
        start = int.from_bytes(raw[:32], 'big')
        length = int.from_bytes(raw[start:start + 32], 'big')
        symbol = raw[start + 32:start + 32 + length]
        assert length <= 31
        hashed_name, hashed_version = keccak(symbol), keccak(b'1')
        domain = keccak(bytes.fromhex(keccak(b'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)') + hashed_name + hashed_version + word(11155111) + word(record['address'])))
        return {'_cachedDomainSeparator': domain, '_cachedChainId': word(11155111), '_cachedThis': word(record['address']), '_hashedName': hashed_name, '_hashedVersion': hashed_version, '_name': symbol.hex() + '00' * (31 - len(symbol)) + bytes([len(symbol)]).hex(), '_version': b'1'.hex() + '00' * 30 + '01'}
    raise ValueError(name)


def reconcile(compiled, ast_map, observation, reproduction, old_live):
    reports = {}
    for name, record in reproduction['contracts'].items():
        result = compiled['contracts'][record['source']][record['contract']]
        template = result['evm']['deployedBytecode']['object']
        actual = observation['contracts'][name]['code'].removeprefix('0x')
        expected = expectations(name, record)
        patched = bytearray.fromhex(template)
        entries = []
        for ast_id, slots in result['evm']['deployedBytecode']['immutableReferences'].items():
            declaration = ast_map[ast_id]
            value = expected[declaration['name']]
            observed = []
            for slot in slots:
                assert slot['length'] == 32
                start = slot['start']
                observed.append(actual[start * 2:(start + 32) * 2])
                patched[start:start + 32] = bytes.fromhex(value)
            entries.append({'declaration': declaration, 'expected': value, 'observed': observed, 'matches': all(x == value for x in observed), 'referenceOffsets': slots})
        creation = result['evm']['bytecode']['object'] + record['constructorArgumentsHex'][2:]
        old = old_live['contracts'][name]
        reports[name] = {'immutableChecks': entries, 'allImmutablesDerivedAndMatched': all(x['matches'] for x in entries), 'fullRuntimeByteEqual': patched.hex() == actual, 'patchedRuntimeSHA256': hashlib.sha256(patched).hexdigest(), 'observedRuntimeSHA256': hashlib.sha256(bytes.fromhex(actual)).hexdigest(), 'creationInputExact': old['transaction']['input'][2:] == creation, 'canonicalReceiptRechecked': observation['contracts'][name]['deploymentReceiptCanonical'], 'abiEqualsRetainedABI': result['abi'] == json.loads((ROOT / f'docs/prep/stage3e/abis/{name}.json').read_text())}
    proxy = observation['proxyLogic']
    result = compiled['contracts']['project/lib/verifiable-factory/src/UUPSProxyLogic.sol']['UUPSProxyLogic']
    patched = bytearray.fromhex(result['evm']['deployedBytecode']['object'])
    for ast_id, slots in result['evm']['deployedBytecode']['immutableReferences'].items():
        assert ast_map[ast_id]['name'] == 'verifiableProxyFactory'
        for slot in slots:
            patched[slot['start']:slot['start'] + 32] = bytes.fromhex(word(reproduction['contracts']['VerifiableFactory']['address']))
    factory_expected = expectations('VerifiableFactory', reproduction['contracts']['VerifiableFactory'])['proxyLogic'][-40:]
    reports['UUPSProxyLogic'] = {'derivedCreateAddressMatchesGetter': proxy['address'][2:].lower() == factory_expected, 'fullRuntimeByteEqual': patched.hex() == proxy['code']['result'][2:], 'factoryGetterMatches': proxy['verifiableProxyFactory'].get('result', '')[-40:].lower() == reproduction['contracts']['VerifiableFactory']['address'][2:].lower(), 'patchedRuntimeSHA256': hashlib.sha256(patched).hexdigest()}
    return reports


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--compiled', type=Path, required=True)
    args = p.parse_args()
    compiled = json.loads(args.compiled.read_text())
    ast_map = json.loads((OUT / 'compiler-audit.json').read_text())['immutableDeclarations']
    observation = json.loads((OUT / 'read-only-observation.json').read_text())
    reproduction = json.loads((ROOT / 'docs/prep/evidence/stage3e/source-reproduction.json').read_text())
    old_live = json.loads((ROOT / 'docs/prep/evidence/stage3e/live-artifact-comparison.json').read_text())
    reports = reconcile(compiled, ast_map, observation, reproduction, old_live)
    (OUT / 'semantic-runtime-reconciliation.json').write_text(json.dumps({'scope': 'Technical evidence for independent review, not deployment approval; eight main artifacts plus factory proxy logic; external LabelStore/URI renderer not included', 'block': observation['block'], 'blockHash': observation['blockHash'], 'contracts': reports}, indent=2) + '\n')
    for name, result in reports.items():
        print(name, {k: v for k, v in result.items() if isinstance(v, bool)})
    assert all(r['fullRuntimeByteEqual'] for r in reports.values())
    assert all(r.get('allImmutablesDerivedAndMatched', True) and r.get('creationInputExact', True) and r.get('canonicalReceiptRechecked', True) and r.get('abiEqualsRetainedABI', True) for r in reports.values())


if __name__ == '__main__':
    main()
