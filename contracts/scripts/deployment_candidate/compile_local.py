"""Reproduce unchanged production artifacts and named immutable references offline."""
from pathlib import Path
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/prep/evidence/deployment-candidate'
records={}
for name in ['CredentialRegistrar','DoorKeys']:
    artifact=json.loads((ROOT/f'contracts/out/{name}.sol/{name}.json').read_text())
    metadata=artifact['metadata'];settings=dict(metadata['settings']);target=settings.pop('compilationTarget')
    settings['outputSelection']={'*':{'':['ast']},**{p:{n:['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']} for p,n in target.items()}}
    sources={p:{'content':(ROOT/'contracts'/p).read_text()} for p in metadata['sources']}
    standard={'language':'Solidity','sources':sources,'settings':settings}
    result=subprocess.run(['/home/l/.local/share/svm/0.8.25/solc-0.8.25','--standard-json'],input=json.dumps(standard),capture_output=True,text=True,check=True)
    compiled=json.loads(result.stdout);assert not any(e['severity']=='error' for e in compiled.get('errors',[]))
    path,contract=next(iter(target.items()));value=compiled['contracts'][path][contract]
    assert sorted(json.dumps(x,sort_keys=True) for x in value['abi'])==sorted(json.dumps(x,sort_keys=True) for x in artifact['abi'])
    assert value['evm']['bytecode']['object']==artifact['bytecode']['object'][2:]
    assert value['evm']['deployedBytecode']['object']==artifact['deployedBytecode']['object'][2:]
    declarations={}
    def walk(node):
        if isinstance(node,dict):
            if node.get('nodeType')=='VariableDeclaration' and node.get('mutability')=='immutable':declarations[str(node['id'])]=node['name']
            for v in node.values():walk(v)
        elif isinstance(node,list):
            for v in node:walk(v)
    for info in compiled['sources'].values():walk(info['ast'])
    records[name]={'abiExact':True,'creationExact':True,'runtimeTemplateExact':True,'runtimeTemplate':value['evm']['deployedBytecode']['object'],'immutableReferences':[{ 'name':declarations[ast_id],'slots':slots} for ast_id,slots in value['evm']['deployedBytecode']['immutableReferences'].items()],'sourceHashes':{p:hashlib.sha256(s['content'].encode()).hexdigest() for p,s in sources.items()},'settings':metadata['settings']}
(OUT/'local-artifact-proof.json').write_text(json.dumps(records,indent=2)+'\n')
print('PASS: both unchanged production creation/runtime templates and ABIs reproduced, with AST-named immutable slots')
