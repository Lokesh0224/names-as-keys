"""Stage 3F gate audit: public read-only RPC and non-persistent simulations only."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/prep/evidence/stage3f-audit'
OWNER = '0x40F6DcB0Fa311570f72aC6F64045EB80E66711F7'
GUEST = '0x5a9191871b9117218F83Ed43293E011667053F39'
ALLOWED = frozenset({'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getBalance', 'eth_getTransactionCount', 'eth_gasPrice', 'eth_getLogs', 'eth_getTransactionReceipt', 'eth_estimateGas'})
TRACE = []


def rpc(method, params):
    if method not in ALLOWED:
        raise ValueError('Not an allowed read/simulation method')
    request = urllib.request.Request('https://sepolia.gateway.tenderly.co', data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode(), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.load(response)
    except Exception as exc:
        result = {'error': {'transport': type(exc).__name__}}
    TRACE.append({'method': method, 'params': params, 'response': result})
    return result


def cast(command, *args):
    assert command in ('calldata', 'keccak', 'sig-event')
    return subprocess.check_output(['cast', command, *map(str, args)], text=True).strip()


def call(address, signature, args, block):
    return rpc('eth_call', [{'to': address, 'data': cast('calldata', signature, *args)}, block])


def main():
    chain = rpc('eth_chainId', [])
    assert chain.get('result') == hex(11155111)
    block = hex(int(rpc('eth_blockNumber', [])['result'], 16) - 32)
    header = rpc('eth_getBlockByNumber', [block, False])['result']
    old = json.loads((ROOT / 'docs/prep/evidence/stage3e/current-sepolia.json').read_text())
    contracts = {name: value['address'] for name, value in old['contracts'].items()}
    report = {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'chainId': 11155111, 'block': int(block, 16), 'blockHash': header['hash'], 'timestamp': int(header['timestamp'], 16), 'baseFeePerGas': header.get('baseFeePerGas'), 'contracts': {}, 'accounts': {}, 'root': {}, 'calls': {}, 'roleHistories': {}, 'simulations': [], 'stage3F': 'NO_GO'}
    for name, address in contracts.items():
        response = rpc('eth_getCode', [address, block])
        code = response.get('result')
        report['contracts'][name] = {'address': address, 'code': code, 'nonempty': bool(code and code != '0x'), 'keccak256': cast('keccak', code) if code else None, 'sameAsStage3E': cast('keccak', code) == old['contracts'][name]['runtimeKeccak256'] if code else False}
    for name, address in [('owner', OWNER), ('mira', GUEST)]:
        report['accounts'][name] = {'address': address, 'selection': 'OWNER_SUPPLIED_PUBLIC_ADDRESS; signing control not demonstrated', 'code': rpc('eth_getCode', [address, block]), 'balanceWei': rpc('eth_getBalance', [address, block]), 'nonceAtBlock': rpc('eth_getTransactionCount', [address, block]), 'pendingNonce': rpc('eth_getTransactionCount', [address, 'pending'])}
        for sig, args in [('balanceOf(address)', [address]), ('allowance(address,address)', [address, contracts['ETHRegistrar']])]:
            report['accounts'][name][sig] = call(contracts['MockUSDC'], sig, args, block)
    for name, sig, args in [
        ('ETHRegistrar', 'isAvailable(string)', ['nak-lokesh-20261105']),
        ('ETHRegistry', 'getState(uint256)', [cast('keccak', 'nak-lokesh-20261105')]),
        ('ETHRegistry', 'getOwner(uint256)', [cast('keccak', 'nak-lokesh-20261105')]),
        ('ETHRegistrar', 'getRegisterPrice(string,uint64,address)', ['nak-lokesh-20261105', 31536000, contracts['MockUSDC']]),
        ('RootRegistry', 'getSubregistry(string)', ['eth']),
        ('ETHRegistrar', 'ETH_REGISTRY()', []), ('ETHRegistrar', 'BENEFICIARY()', []), ('ETHRegistrar', 'owner()', []), ('ETHRegistrar', 'rentPriceOracle()', []),
        ('ETHRegistrar', 'MIN_COMMITMENT_AGE()', []), ('ETHRegistrar', 'MAX_COMMITMENT_AGE()', []), ('ETHRegistrar', 'MIN_REGISTER_DURATION()', []), ('ETHRegistrar', 'GRACE_PERIOD()', []),
        ('VerifiableFactory', 'proxyLogic()', []), ('UserRegistryImpl', 'LABEL_STORE()', []), ('UserRegistryImpl', 'URI_RENDERER()', []),
    ]:
        report['calls'][name + '.' + sig] = call(contracts[name], sig, args, block)
    proxy = report['calls']['VerifiableFactory.proxyLogic()'].get('result')
    if proxy:
        address = '0x' + proxy[-40:]
        report['proxyLogic'] = {'address': address, 'code': rpc('eth_getCode', [address, block]), 'verifiableProxyFactory': call(address, 'verifiableProxyFactory()', [], block)}
    # Reconstruct complete root-resource EAC histories from actual creation blocks.
    old_live = json.loads((ROOT / 'docs/prep/evidence/stage3e/live-artifact-comparison.json').read_text())['contracts']
    topic = cast('sig-event', 'EACRolesChanged(uint256,address,uint256,uint256)')
    for name in ['ETHRegistry', 'RootRegistry', 'StandardRentPriceOracle']:
        address = contracts[name]
        first = int(old_live[name]['receipt']['blockNumber'], 16)
        root_response = call(address, 'ROOT_RESOURCE()', [], block)
        resource = root_response.get('result')
        history = {'from': first, 'through': int(block, 16), 'resource': root_response, 'complete': bool(resource), 'logs': [], 'holders': []}
        if resource:
            for start in range(first, int(block, 16) + 1, 10000):
                result = rpc('eth_getLogs', [{'address': address, 'fromBlock': hex(start), 'toBlock': hex(min(start + 9999, int(block, 16))), 'topics': [topic, resource]}])
                if 'result' not in result:
                    history['complete'] = False
                    history['error'] = result.get('error')
                    break
                history['logs'].extend(result['result'])
            accounts = sorted({'0x' + event['topics'][2][-40:] for event in history['logs']})
            expected = {}
            for event in sorted(history['logs'], key=lambda e: (int(e['blockNumber'], 16), int(e['transactionIndex'], 16), int(e['logIndex'], 16))):
                words = event['data'][2:]
                account = '0x' + event['topics'][2][-40:]
                before, after = int(words[:64], 16), int(words[64:128], 16)
                if expected.get(account, 0) != before:
                    history['complete'] = False
                expected[account] = after
            packed = 0
            for account in accounts:
                current = call(address, 'roles(uint256,address)', [int(resource, 16), account], block)
                roles = int(current['result'], 16) if 'result' in current else None
                history['holders'].append({'address': account, 'roles': roles, 'eventFinal': expected.get(account), 'matchesEvents': roles == expected.get(account)})
                if roles is not None:
                    for bit in range(0, 256, 4):
                        if roles & (1 << bit):
                            packed += 1 << bit
            history['roleCount'] = call(address, 'roleCount(uint256)', [int(resource, 16)], block)
            all_roles = sum(1 << bit for bit in range(0, 256, 4))
            history['getAssigneeCount'] = call(address, 'getAssigneeCount(uint256,uint256)', [int(resource, 16), all_roles], block)
            history['expectedPackedCount'] = packed
            count = history['roleCount'].get('result')
            assignees = history['getAssigneeCount'].get('result')
            history['reconciled'] = history['complete'] and all(h['matchesEvents'] for h in history['holders']) and count is not None and int(count, 16) == packed and assignees is not None and int(assignees[2:66], 16) == packed
        report['roleHistories'][name] = history
    # Snapshot candidate simulation only. No secret, proxy salts, future addresses or expiry guesses.
    quote = report['calls']['ETHRegistrar.getRegisterPrice(string,uint64,address)'].get('result')
    if quote:
        price = int(quote[2:66], 16) + int(quote[66:130], 16)
        report['root']['quoteUnits'] = price
        balance = report['accounts']['owner']['balanceOf(address)'].get('result')
        allowance = report['accounts']['owner']['allowance(address,address)'].get('result')
        candidates = []
        if balance is not None and int(balance, 16) < price:
            candidates.append(('T01', 'mint(address,uint256)', [OWNER, price - int(balance, 16)]))
        if allowance is not None and int(allowance, 16) < price:
            candidates.append(('T02', 'approve(address,uint256)', [contracts['ETHRegistrar'], price]))
        for step, sig, args in candidates:
            transaction = {'from': OWNER, 'to': contracts['MockUSDC'], 'value': '0x0', 'data': cast('calldata', sig, *args)}
            report['simulations'].append({'id': step, 'classification': 'SNAPSHOT_PROPOSAL_NOT_APPROVED_DEPLOYMENT_INPUT', 'signature': sig, 'arguments': args, 'transaction': transaction, 'ethCall': rpc('eth_call', [transaction, block]), 'estimateGas': rpc('eth_estimateGas', [transaction, block]), 'scope': 'Non-persistent individual call. Not a full ordered fork-manifest execution, signed transaction or approved spending limit.'})
    report['gasPrice'] = rpc('eth_gasPrice', [])
    report['sameCanonicalBlockAtEnd'] = rpc('eth_getBlockByNumber', [block, False]).get('result', {}).get('hash') == header['hash']
    for name, value in old_live.items():
        receipt = rpc('eth_getTransactionReceipt', [value['transactionHash']])
        report['contracts'][name]['deploymentReceiptCanonical'] = bool(receipt.get('result') and receipt['result']['blockHash'] == value['receipt']['blockHash'] and receipt['result']['contractAddress'].lower() == contracts[name].lower() and receipt['result']['status'] == '0x1')
    (OUT / 'read-only-observation.json').write_text(json.dumps(report, indent=2) + '\n')
    (OUT / 'rpc-transcript.json').write_text(json.dumps(TRACE, indent=2) + '\n')
    print(json.dumps({'block': report['block'], 'blockHash': report['blockHash'], 'codesUnchanged': all(c['sameAsStage3E'] for c in report['contracts'].values()), 'roles': {n: {'complete': h['complete'], 'reconciled': h.get('reconciled')} for n, h in report['roleHistories'].items()}, 'simulationCount': len(report['simulations']), 'rpcCalls': len(TRACE)}))


if __name__ == '__main__':
    main()
