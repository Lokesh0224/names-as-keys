"""Supplemental read-only ancestor token and operator history audit."""
import json
from pathlib import Path

import probe

OUT = probe.OUT


def main():
    current = json.loads((OUT / 'read-only-observation.json').read_text())
    contracts = current['contracts']
    block = hex(current['block'])
    address = contracts['RootRegistry']['address']
    label = probe.cast('keccak', 'eth')
    state = probe.call(address, 'getState(uint256)', [label], block)
    owner = probe.call(address, 'getOwner(uint256)', [label], block)
    resource = probe.call(address, 'getResource(uint256)', [label], block)
    report = {'block': current['block'], 'ethState': state, 'ethOwner': owner, 'ethResource': resource, 'tokenRoles': [], 'operatorHistories': {}}
    if 'result' in resource:
        topic = probe.cast('sig-event', 'EACRolesChanged(uint256,address,uint256,uint256)')
        first = current['roleHistories']['RootRegistry']['from']
        logs = []
        complete = True
        for start in range(first, current['block'] + 1, 10000):
            result = probe.rpc('eth_getLogs', [{'address': address, 'fromBlock': hex(start), 'toBlock': hex(min(start + 9999, current['block'])), 'topics': [topic, resource['result']]}])
            if 'result' not in result:
                complete = False
                break
            logs.extend(result['result'])
        for account in sorted({'0x' + e['topics'][2][-40:] for e in logs}):
            report['tokenRoles'].append({'account': account, 'roles': probe.call(address, 'roles(uint256,address)', [int(resource['result'], 16), account], block)})
        report['tokenRoleHistory'] = {'complete': complete, 'logs': logs, 'roleCount': probe.call(address, 'roleCount(uint256)', [int(resource['result'], 16)], block)}
    pairs = [('ETHRegistry', probe.OWNER)]
    if 'result' in owner:
        pairs.append(('RootRegistry', '0x' + owner['result'][-40:]))
    topic = probe.cast('sig-event', 'ApprovalForAll(address,address,bool)')
    for name, token_owner in pairs:
        logs = []
        complete = True
        for start in range(current['roleHistories'][name]['from'], current['block'] + 1, 10000):
            result = probe.rpc('eth_getLogs', [{'address': contracts[name]['address'], 'fromBlock': hex(start), 'toBlock': hex(min(start + 9999, current['block'])), 'topics': [topic, '0x' + token_owner[2:].lower().zfill(64)]}])
            if 'result' not in result:
                complete = False
                break
            logs.extend(result['result'])
        operators = []
        for operator in sorted({'0x' + e['topics'][2][-40:] for e in logs}):
            operators.append({'operator': operator, 'approved': probe.call(contracts[name]['address'], 'isApprovedForAll(address,address)', [token_owner, operator], block)})
        report['operatorHistories'][name] = {'owner': token_owner, 'complete': complete, 'logs': logs, 'operators': operators}
    renderer = '0x' + current['calls']['UserRegistryImpl.URI_RENDERER()']['result'][-40:]
    report['uriRenderer'] = {'address': renderer, 'code': probe.rpc('eth_getCode', [renderer, block]), 'scope': 'Nonempty code identity only; source/bytecode not yet reproduced; URI view dependency, not DoorKeys authorization.'}
    (OUT / 'ancestor-role-observation.json').write_text(json.dumps(report, indent=2) + '\n')
    (OUT / 'ancestor-rpc-transcript.json').write_text(json.dumps(probe.TRACE, indent=2) + '\n')
    print(json.dumps({'tokenHistoryComplete': report.get('tokenRoleHistory', {}).get('complete'), 'operatorHistories': {n: {'complete': h['complete'], 'operators': h['operators']} for n, h in report['operatorHistories'].items()}, 'rpcCalls': len(probe.TRACE)}))


if __name__ == '__main__':
    main()
