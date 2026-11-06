"""Verify the published LabelStore dependency without any chain writes."""
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

import probe

OUT = probe.OUT
URL = 'https://raw.githubusercontent.com/ensdomains/contracts-v2/07e55a056f5b6a9c90119f501bdd05714e67dddd/contracts/deployments/sepolia/LabelStore.json'


def main():
    with urllib.request.urlopen(URL, timeout=25) as response:
        raw = response.read()
    artifact = json.loads(raw)
    metadata = json.loads(artifact['metadata'])
    observation = json.loads((OUT / 'read-only-observation.json').read_text())
    assert artifact['address'].lower() == observation['contracts']['LabelStore']['address'].lower()
    target = metadata['settings']['compilationTarget']
    settings = dict(metadata['settings'])
    settings.pop('compilationTarget')
    settings['outputSelection'] = {s: {c: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences']} for s, c in target.items()}
    settings['outputSelection']['*'] = {'': ['ast']}
    standard = {'language': 'Solidity', 'sources': {n: {'content': s['content']} for n, s in metadata['sources'].items()}, 'settings': settings}
    solc = Path('/home/l/.local/share/svm/0.8.25/solc-0.8.25')
    assert metadata['compiler']['version'].startswith('0.8.25+')
    compiled = subprocess.run([str(solc), '--standard-json'], input=json.dumps(standard, sort_keys=True), text=True, capture_output=True, check=True)
    result = json.loads(compiled.stdout)
    assert not any(e['severity'] == 'error' for e in result.get('errors', []))
    source, name = next(iter(target.items()))
    contract = result['contracts'][source][name]
    code = contract['evm']['deployedBytecode']['object']
    references = contract['evm']['deployedBytecode']['immutableReferences']
    (OUT / 'labelstore-artifact.json').write_bytes(raw)
    declarations = {}
    def walk(node):
        if isinstance(node, dict):
            if node.get('nodeType') == 'VariableDeclaration' and node.get('mutability') == 'immutable':
                declarations[str(node['id'])] = node['name']
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
    for info in result['sources'].values():
        walk(info['ast'])
    patched = bytearray.fromhex(code)
    expected_namer = artifact['argsData'][2:]
    assert len(expected_namer) == 64
    for ast_id, slots in references.items():
        assert declarations[ast_id] == 'CONTRACT_NAMER'
        for slot in slots:
            assert slot['length'] == 32
            patched[slot['start']:slot['start'] + 32] = bytes.fromhex(expected_namer)
    label_reads = {label: probe.call(artifact['address'], 'getLabel(uint256)', [probe.cast('keccak', label)], hex(observation['block'])) for label in ['nak-lokesh-20261105', 'lock', 'mira']}
    namer_read = probe.call(artifact['address'], 'CONTRACT_NAMER()', [], hex(observation['block']))
    (OUT / 'labelstore-artifact.json').write_bytes(raw)
    (OUT / 'labelstore-standard-input.json').write_text(json.dumps(standard, sort_keys=True) + '\n')
    receipt = probe.rpc('eth_getTransactionReceipt', [artifact['transaction']['hash']])
    report = {'url': URL, 'artifactSHA256': hashlib.sha256(raw).hexdigest(), 'source': source, 'contract': name, 'sources': len(standard['sources']), 'compiler': metadata['compiler']['version'], 'solcBinarySHA256': hashlib.sha256(solc.read_bytes()).hexdigest(), 'sourceInputSHA256': hashlib.sha256((OUT / 'labelstore-standard-input.json').read_bytes()).hexdigest(), 'creationTemplateExact': contract['evm']['bytecode']['object'] == artifact['bytecode'][2:], 'runtimeTemplateExact': code == artifact['deployedBytecode'][2:], 'fullLiveRuntimeExact': patched.hex() == observation['contracts']['LabelStore']['code'][2:], 'abiExact': contract['abi'] == artifact['abi'], 'immutableReferences': references, 'immutableDeclarations': declarations, 'expectedContractNamer': expected_namer, 'namerGetter': namer_read, 'labelReads': label_reads, 'receipt': receipt, 'canonicalSuccessfulReceipt': receipt.get('result', {}).get('status') == '0x1' and receipt.get('result', {}).get('contractAddress', '').lower() == artifact['address'].lower(), 'eventSignatures': [e['name'] + '(' + ','.join(i['type'] for i in e['inputs']) + ')' for e in artifact['abi'] if e['type'] == 'event']}
    (OUT / 'labelstore-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    (OUT / 'labelstore-rpc-transcript.json').write_text(json.dumps(probe.TRACE, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if isinstance(v, bool) or k == 'eventSignatures'}))
    assert all(report[k] for k in ['creationTemplateExact', 'runtimeTemplateExact', 'fullLiveRuntimeExact', 'abiExact', 'canonicalSuccessfulReceipt'])


if __name__ == '__main__':
    main()
