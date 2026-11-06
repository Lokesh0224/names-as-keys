"""Reproduce retained ENS sources offline; add AST and factory child output only."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/prep/evidence/stage3f-audit'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--solc', type=Path, required=True)
    args = p.parse_args()
    source = ROOT / 'docs/prep/evidence/stage3e/ens-standard-input.json'
    standard = json.loads(source.read_text())
    standard['settings']['outputSelection']['*'] = {'': ['ast']}
    standard['settings']['outputSelection']['project/lib/verifiable-factory/src/UUPSProxyLogic.sol'] = {'UUPSProxyLogic': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences']}
    text = json.dumps(standard, sort_keys=True) + '\n'
    result = subprocess.run([str(args.solc), '--standard-json'], input=text, text=True, capture_output=True, check=True)
    (OUT / 'compiler-stderr-reproducible.log').write_text(result.stderr)
    compiled = json.loads(result.stdout)
    assert not any(e['severity'] == 'error' for e in compiled.get('errors', []))
    args.output.write_text(result.stdout)
    declarations = {}

    def walk(node, path):
        if isinstance(node, dict):
            if node.get('nodeType') == 'VariableDeclaration' and node.get('mutability') == 'immutable':
                declarations[str(node['id'])] = {'name': node['name'], 'source': path, 'src': node['src'], 'type': node['typeDescriptions']['typeString']}
            for value in node.values():
                walk(value, path)
        elif isinstance(node, list):
            for value in node:
                walk(value, path)

    for path, info in compiled['sources'].items():
        walk(info['ast'], path)
    record = {'sourceInput': str(source.relative_to(ROOT)), 'sourceInputSHA256': hashlib.sha256(source.read_bytes()).hexdigest(), 'auditInputSHA256': hashlib.sha256(text.encode()).hexdigest(), 'outputSelection': standard['settings']['outputSelection'], 'solcBinarySHA256': hashlib.sha256(args.solc.read_bytes()).hexdigest(), 'solcVersion': subprocess.check_output([str(args.solc), '--version'], text=True).strip(), 'immutableDeclarations': declarations}
    expected = json.loads((OUT / 'compiler-audit.json').read_text())
    assert record == expected, 'Initial compiler evidence differs; do not overwrite historical record'
    print('PASS: compiler input, binary, version and every AST immutable mapping reproduced; compiled output retained at requested local path')


if __name__ == '__main__':
    main()
