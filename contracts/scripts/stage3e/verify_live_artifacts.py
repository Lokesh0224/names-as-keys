#!/usr/bin/env python3
"""Read-only comparison of published deployment bytecode and chain provenance. Never signs."""
import argparse
import json
from pathlib import Path
import urllib.request

REPO = Path(__file__).resolve().parents[3]
ALLOWED = frozenset({"eth_getCode", "eth_getTransactionByHash", "eth_getTransactionReceipt"})


def rpc(method, params):
    if method not in ALLOWED:
        raise ValueError("not a read-only method")
    request = urllib.request.Request("https://sepolia.gateway.tenderly.co", data=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}).encode(), headers={"Content-Type":"application/json","User-Agent":"Names-as-Keys-bytecode-read"})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.load(response)
    except Exception as exc:
        return {"error":{"transport":type(exc).__name__}}


def main():
    p=argparse.ArgumentParser();p.add_argument('artifacts',type=Path);a=p.parse_args()
    out=REPO/'docs/prep/evidence/stage3e';chain=json.loads((out/'current-sepolia.json').read_text());results={}
    for path in sorted(a.artifacts.glob('*.json')):
        name=path.stem;artifact=json.loads(path.read_text());code_response=rpc('eth_getCode',[artifact['address'],hex(chain['block'])]);value=code_response.get('result')
        if value is None:
            results[name]={'status':'BLOCKED','error':code_response.get('error')};continue
        actual=bytes.fromhex(value.removeprefix('0x'));template=bytes.fromhex(artifact['deployedBytecode'].removeprefix('0x'))
        mask=set();immutable=[]
        for ast_id, refs in artifact['immutableReferences'].items():
            vals=[]
            for ref in refs:
                start,size=ref['start'],ref['length'];mask.update(range(start,start+size));vals.append(actual[start:start+size].hex())
            immutable.append({'astId':ast_id,'valuesHex':sorted(set(vals)),'consistentAcrossReferences':len(set(vals))==1})
        txhash=artifact['transaction']['hash'];tx_response=rpc('eth_getTransactionByHash',[txhash]);receipt_response=rpc('eth_getTransactionReceipt',[txhash]);tx=tx_response.get('result');receipt=receipt_response.get('result')
        expected=artifact['bytecode'].removeprefix('0x')+artifact['argsData'].removeprefix('0x')
        results[name]={'address':artifact['address'],'runtimeLengthEqual':len(actual)==len(template),'runtimeByteEqualWithoutImmutablePatching':actual==template,'runtimeMatchesOutsideImmutableSlots':len(actual)==len(template) and all(x==y or i in mask for i,(x,y) in enumerate(zip(actual,template))),'immutableValues':immutable,'transactionHash':txhash,'transaction':tx,'receipt':receipt,'creationInputExact':tx is not None and tx.get('input','').removeprefix('0x')==expected,'creationInputEndsWithCompiledCreationAndArgs':tx is not None and tx.get('input','').removeprefix('0x').endswith(expected),'status':'VERIFIED' if tx and receipt else 'BLOCKED','limitation':'Immutable bytes observed, not yet individually reconciled to constructor/source variables. Internal deployment provenance may require trace/replay.'}
    (out/'live-artifact-comparison.json').write_text(json.dumps({'block':chain['block'],'contracts':results,'sourceToLiveRuntimeGate':'BLOCKED until independent immutable/deployment provenance reconciliation is complete'},indent=2)+'\n')
    print(json.dumps({n:{k:v.get(k) for k in ['status','runtimeMatchesOutsideImmutableSlots','creationInputExact','creationInputEndsWithCompiledCreationAndArgs']} for n,v in results.items()},indent=2))


if __name__=='__main__':main()
