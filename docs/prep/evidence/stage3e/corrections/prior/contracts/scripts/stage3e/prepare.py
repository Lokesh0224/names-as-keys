#!/usr/bin/env python3
"""Offline ABI-checked deployment plan export/review. No RPC, wallet or signer imports."""
import argparse
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PLAN = REPO / "docs/prep/stage3e"
EVIDENCE = REPO / "docs/prep/evidence/stage3e"
ZERO = "0x" + "00" * 20  # Intentional absent resolver/subregistry, never an unknown future address.


def abi_type(item):
    if item["type"].startswith("tuple"):
        return "(" + ",".join(abi_type(v) for v in item["components"]) + ")" + item["type"][5:]
    return item["type"]


def signature(item):
    return item.get("name", "constructor") + "(" + ",".join(abi_type(v) for v in item.get("inputs", [])) + ")"


def binding(path):
    return {"binding": path, "value": None, "classification": "UNVERIFIED"}


def validate(manifest, abis):
    assert manifest["chainId"] == 11155111
    assert manifest["broadcastEnabled"] is False and manifest["walletRequestsEnabled"] is False
    assert manifest["stage3FDecision"] == "NO_GO"
    assert all(v["address"] is None for v in manifest["futureAddresses"].values())
    for recipe in manifest["encodingRecipes"].values():
        matches = [item for item in abis[recipe["abi"]] if item["type"] == "function" and signature(item) == recipe["signature"]]
        assert len(matches) == 1, recipe["signature"]
        if "arguments" in recipe:
            assert len(recipe["arguments"]) == len(matches[0]["inputs"])
    seen = set()
    for step in manifest["transactions"]:
        assert all(d in seen for d in step["dependsOn"]), step["id"]
        seen.add(step["id"])
        assert step["status"] == "BLOCKED" and step["calldata"] is None and step["gasEstimate"] is None
        assert step["signer"]["value"] is None
        target = step["target"]
        assert step["contractCreation"] == (target is None)
        if target is not None and "reference" in target:
            name = target["reference"].removeprefix("verified.")
            assert target == manifest["verifiedAddresses"][name]
        elif target is not None:
            assert target["binding"].startswith("future.") and target["value"] is None
            assert target["binding"].split(".")[1] in manifest["futureAddresses"]
        abi = abis[step["abi"]]
        matching = [v for v in abi if v["type"] in ("function", "constructor") and signature(v) == step["signature"]]
        assert len(matching) == 1, step["signature"]
        assert len(matching[0].get("inputs", [])) == len(step["arguments"]), step["id"]
        for event in step["expectedEvents"]:
            # Cross-contract events identify their own ABI.
            assert event["name"] in {v["name"] for v in abis[event.get("abi", step["abi"])] if v["type"] == "event"}
        for field in ["requiredRoles", "preValidation", "postVerification", "recovery", "estimationMethod", "expectedState"]:
            assert step[field], (step["id"], field)
    return len(seen)


def build(artifact_directory):
    PLAN.mkdir(exist_ok=True);(PLAN / "abis").mkdir(exist_ok=True)
    chain = json.loads((EVIDENCE / "current-sepolia.json").read_text())
    abis, inventory = {}, {}
    for name in ["ETHRegistrar", "ETHRegistry", "RootRegistry", "UserRegistryImpl", "VerifiableFactory", "MockUSDC", "MockDAI", "StandardRentPriceOracle"]:
        artifact = json.loads((artifact_directory / (name + ".json")).read_text())
        observation = chain["contracts"][name]
        assert artifact["address"].lower() == observation["address"].lower()
        abis[name] = artifact["abi"]
        inventory[name] = {**observation, "abi": "abis/" + name + ".json", "abiProvenance": "official deployment-linked artifact", "sourceCommit": "07e55a056f5b6a9c90119f501bdd05714e67dddd"}
    for name in ["CredentialRegistrar", "DoorKeys"]:
        path = REPO / "contracts/out" / (name + ".sol") / (name + ".json")
        artifact = json.loads(path.read_text());abis[name] = artifact["abi"]
        inventory[name] = {"address": None, "status": "UNVERIFIED", "abi": "abis/" + name + ".json", "abiProvenance": "current locally compiled unchanged production contract", "creationBytecodeSHA256": hashlib.sha256(bytes.fromhex(artifact["bytecode"]["object"].removeprefix("0x"))).hexdigest()}
    for name, abi in abis.items():
        path = PLAN / "abis" / (name + ".json");path.write_text(json.dumps(abi, indent=2) + "\n")
        inventory[name]["abiSHA256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    inventory["otherVerifiedAddresses"] = {n: v for n, v in chain["contracts"].items() if n not in abis}
    (PLAN / "address-abi-inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")
    address = lambda name: {"reference": "verified." + name, "value": chain["contracts"][name]["address"], "classification": "VERIFIED", "block": chain["block"]}
    future = lambda name: binding("future." + name)
    owner = binding("accounts.owner")
    operations = 1 | (1 << 8) | (1 << 12) | (1 << 16) | (1 << 20)
    grants = operations | (operations << 128)
    lock_roles = (1 << 20) | (1 << 148) | (1 << 156)
    steps = []
    def add(number, label, target, abi, sig, args, roles, state, events, pre, post, conditional=None):
        step = {"id": f"T{number:02d}", "label": label, "target": target, "contractCreation": target is None,
                "abi": abi, "signature": sig, "arguments": args, "signer": owner.copy(), "requiredRoles": roles,
                "dependsOn": [steps[-1]["id"]] if steps else [], "valueWei": "0", "status": "BLOCKED",
                "calldata": None, "gasEstimate": None, "transactionHash": None, "receipt": None,
                "expectedState": state, "expectedEvents": events, "preValidation": pre,
                "postVerification": post, "conditionalSkip": conditional,
                "estimationMethod": "After every blocking input/gate is resolved: eth_estimateGas with exact from, target (omit for creation), value=0 and full calldata/creation bytecode at identified current state; inspect gas/fee limits and simulation; no numeric estimate is asserted here.",
                "recovery": "Never auto-retry or advance. If pending, inspect hash/receipt and account nonce; if reverted, preserve receipt/reason and re-read all affected ENS state. Re-prepare with a new explicit review. If successful but app interrupted, reconcile receipt/events/state before resuming; never resubmit solely because local status is missing."}
        steps.append(step)
    ev = lambda name, abi=None: {"name": name, **({"abi": abi} if abi else {})}
    add(1,"Obtain mock rent tokens if needed",address("MockUSDC"),"MockUSDC","mint(address,uint256)",[owner,binding("quote.basePlusPremium")],"No mint role in linked MockERC20; conditional on reviewed implementation","Owner mock token balance increases",[ev("Transfer")],"Current price; owner and token identity; balance deficit; sufficient gas ETH","balanceOf(owner) increases by reviewed amount; Transfer from zero","Skip only if verified balance already sufficient; record skip evidence")
    add(2,"Approve bounded registrar rent spend",address("MockUSDC"),"MockUSDC","approve(address,uint256)",[address("ETHRegistrar"),binding("quote.basePlusPremium")],"Token holder owner","Allowance to ETHRegistrar set to reviewed bounded spend",[ev("Approval")],"Read balance/allowance; reject unlimited spend; refresh quote","allowance(owner,ETHRegistrar) equals approved limit","Skip only if verified existing bounded allowance is sufficient and owner accepts it")
    add(3,"Commit root registration intent",address("ETHRegistrar"),"ETHRegistrar","commit(bytes32)",[binding("registration.commitment")],"Any caller; owner account pays gas","Commitment timestamp recorded",[ev("CommitmentMade")],"isAvailable true; exact approved root and commitment parameters; fresh CSPRNG secret kept outside shared artifacts","commitmentAt(commitment) and receipt block/time match; wait min age, strictly less than max age")
    add(4,"Reveal/register the approved Sepolia root",address("ETHRegistrar"),"ETHRegistrar","register(string,address,bytes32,address,address,uint64,address,bytes32)",["nak-lokesh-20261105",owner,binding("privateRegistrationState.secret"),ZERO,ZERO,31536000,address("MockUSDC"),"0x"+"00"*32],"Payer owner has rent balance/allowance; registrar owns global REGISTRAR permission","Root token owned by owner; actual expiry and token ID read from receipt/state",[ev("NameRegistered"),ev("LabelRegistered","ETHRegistry")],"All source/account/role gates; commitment bounds; availability/quote/allowance; no mainnet prerequisite in ordinary available-label path","ETHRegistry getState/getOwner/getExpiry; record actual root token/resource; root owner SET_SUBREGISTRY confirmed")
    add(5,"Create R1 and initialize owner grants atomically",address("VerifiableFactory"),"VerifiableFactory","deployProxy(address,uint256,bytes)",[address("UserRegistryImpl"),binding("salts.R1"),binding("encoded.initializeOwnerGrants")],"Factory permissionless; explicit owner granted root roles by initialize","New R1 proxy; OWNER_OPERATIONS_AND_ADMINS initialized",[ev("ProxyDeployed"),ev("RegistryCreated","UserRegistryImpl"),ev("EACRolesChanged","UserRegistryImpl")],"Owner grants exactly policy bitmap; validate initialize((address,uint256)[]) ABI; predictProxyAddress(owner,salt); unused salt/address; code identities","Receipt ProxyDeployed address equals predicted; verifyContract(R1) expected implementation; exact owner root bitmap and aggregate role counts")
    add(6,"Attach R1 to root",address("ETHRegistry"),"ETHRegistry","setSubregistry(uint256,address)",[binding("receipts.rootTokenId"),future("R1")],"Owner SET_SUBREGISTRY on current root resource","Root forward attachment becomes R1",[ev("SubregistryUpdated")],"Active root owner/token generation and attachment permission","ETHRegistry.getSubregistry(rootLabel)==R1; root token unchanged")
    add(7,"Set R1 canonical parent metadata",future("R1"),"UserRegistryImpl","setParent(address,string)",[address("ETHRegistry"),"nak-lokesh-20261105"],"Owner R1 root SET_PARENT","Canonical R1 parent recorded; no forward grant implied",[ev("ParentUpdated")],"Owner has SET_PARENT; R1 factory verified","R1.getParent() equals ETHRegistry/root label; root forward link still correct")
    add(8,"Register owner-controlled lock with no child attached yet",future("R1"),"UserRegistryImpl","register(string,address,address,address,uint256,uint64)",["lock",owner,ZERO,ZERO,str(lock_roles),binding("inputs.lockExpiry")],"Owner R1 root REGISTRAR","Lock token owned by same owner; roles mirror Stage 3B fixture; expiry <= root",[ev("LabelRegistered"),ev("TokenResource")],"Lock unused/available; root owner active; planned 90-day lock expiry within root; owner accepts transfer-admin role on owner token","R1.getState/getOwner/getExpiry(lock); lock role bitmap; capture actual token/resource; no R2 attachment yet")
    add(9,"Create R2 and initialize owner grants atomically",address("VerifiableFactory"),"VerifiableFactory","deployProxy(address,uint256,bytes)",[address("UserRegistryImpl"),binding("salts.R2"),binding("encoded.initializeOwnerGrants")],"Explicit owner initial grants, factory permissionless","New R2 proxy; same reviewed owner root grants",[ev("ProxyDeployed"),ev("RegistryCreated","UserRegistryImpl"),ev("EACRolesChanged","UserRegistryImpl")],"Distinct unused salt; predicted address; exact owner grants and implementation","Factory verifyContract(R2); owner bitmap/counts; unemancipated; no guest root privileges")
    add(10,"Attach R2 under lock",future("R1"),"UserRegistryImpl","setSubregistry(uint256,address)",[binding("receipts.lockTokenId"),future("R2")],"Owner SET_SUBREGISTRY on lock resource or R1 root","Lock forward attachment becomes R2",[ev("SubregistryUpdated")],"Lock/root current owner/expiry/token generations; R2 verified","R1.getSubregistry(lock)==R2; lock token generation unchanged")
    add(11,"Set R2 canonical parent metadata",future("R2"),"UserRegistryImpl","setParent(address,string)",[future("R1"),"lock"],"Owner R2 root SET_PARENT","Canonical R2 parent recorded",[ev("ParentUpdated")],"R2 verified; owner SET_PARENT","R2.getParent()==(R1,lock); both forward links still correct")
    add(12,"Deploy CredentialRegistrar",None,"CredentialRegistrar","constructor(address,string,address,address)",[owner,"nak-lokesh-20261105",future("R1"),future("R2")],"Owner EOA pays gas; constructor validates full active hierarchy","New immutable owner/R1/R2 and ancestor token bindings",[],"Stable ancestor generations; full hierarchy, roles/runtime/source gates; fresh local creation artifact hash","Receipt contractAddress; code; owner/rootLabel/parentRegistry/guestRegistry/rootTokenId/lockTokenId getters; no roles assumed from deployment")
    add(13,"Grant only minimal registrar permissions",future("R2"),"UserRegistryImpl","grantRootRoles(uint256,address)",[4097,future("CredentialRegistrar")],"Owner R2 REGISTRAR_ADMIN and UNREGISTER_ADMIN","Registrar root bitmap exactly 4097; no admin/RENEW/UPGRADE",[ev("EACRolesChanged")],"Registrar config verified; root inventory trusted; existing registrar bitmap zero","R2.roles(ROOT_RESOURCE,registrar)==4097; hasRootRoles(1/4096); registry unemancipated")
    add(14,"Deploy DoorKeys",None,"DoorKeys","constructor(address,string,address,address,uint256)",[owner,"nak-lokesh-20261105",future("R1"),future("R2"),1],"Owner EOA pays gas; constructor validates hierarchy","Door contract snapshots same owner, registries and ancestor generations; epoch 1",[],"Complete current path; stable generation IDs; approved bytecode/constructor arguments","Receipt contractAddress; administrator/registries/rootLabelHash/token snapshots/epoch/doorId; requestNonce zero; no ENS roles granted to DoorKeys")
    add(15,"Issue Mira temporary credential",future("CredentialRegistrar"),"CredentialRegistrar","issue(string,address,uint64)",["mira",binding("accounts.guest"),binding("inputs.guestExpiry")],"Configured owner only; registrar 4097 on R2","Mira token owned by guest; zero roles/child registry/resolver; fresh one-day expiry proposal",[ev("CredentialIssued"),ev("LabelRegistered","UserRegistryImpl")],"Guest nonzero, not owner/registrar, no root roles; complete initial R2 label state; expiry 60s..30d and <=lock/root; planned one day must fit without silent truncation","R2 getState/getOwner/getExpiry; roleCount(resource)==0 and guest root roles==0; getResolver/getSubregistry zero; full DoorKeys authorization reads; no unlock/signature request")
    manifest={"stage":"3E preparation only","chainId":11155111,"approvedCheckpoint":"d3fd2cce7ac75a76810202a7a83de40fe5c2fe32","broadcastEnabled":False,"walletRequestsEnabled":False,"stage3FDecision":"NO_GO","blockingGates":["reproducible source-to-live-runtime equivalence review","owner/guest public accounts and balances","complete ENS administrator/role inventory","future addresses, salts and constructor calldata","fresh gas/fee simulations and explicit transaction authorization"],"root":"nak-lokesh-20261105.eth","observationBlock":chain['block'],"verifiedAddresses":{n:address(n) for n in chain['contracts']},"futureAddresses":{n:{"address":None,"status":"UNVERIFIED","resolveFrom":"future successful receipt plus independent code/config verification"} for n in ['R1','R2','CredentialRegistrar','DoorKeys']},"accounts":{"owner":None,"guest":None},"roles":{"OWNER_OPERATIONS":str(operations),"OWNER_OPERATIONS_AND_ADMINS":str(grants),"LOCK_OWNER_TOKEN_ROLES":str(lock_roles),"REGISTRAR_ROOT_ROLES":4097,"GUEST_TOKEN_ROLES":0,"DOOR_KEYS_ROLES":0},"registration":{"durationSeconds":31536000,"secret":None,"secretStoragePolicy":"future private local ephemeral registration state only; never commit or include plaintext in shared manifest","subregistry":ZERO,"resolver":ZERO,"referrer":"0x"+'00'*32},"transactions":steps,"receiptReviewPolicy":"Every write user-initiated only in a separately authorized future workflow. This exporter cannot connect to a wallet or submit transactions. No automatic retries. Confirm receipt success AND expected state before advancing.","expectedOwnerConfirmations":{"maximumPlanned":15,"conditionalSkips":["T01","T02"],"guestUnlockIncluded":False}}
    manifest["inputs"] = {"lockExpiry": None, "guestExpiry": None, "salts": {"R1": None, "R2": None}, "deploymentEpoch": 1}
    manifest["encodingRecipes"] = {"initializeOwnerGrants": {"abi": "UserRegistryImpl", "signature": "initialize((address,uint256)[])", "arguments": [[{"account": owner, "roleBitmap": str(grants)}]], "encodedBytes": None}, "commitment": {"abi": "ETHRegistrar", "signature": "makeCommitment(string,address,bytes32,address,address,uint64,bytes32)", "output": None, "secretPolicy": "CSPRNG secret generated only in separately authorized future workflow; absent from public artifacts"}}
    validate(manifest,abis)
    (PLAN/'deployment-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Required initializer is nested factory calldata, not a standalone transaction.
    assert any(v['type']=='function' and signature(v)=='initialize((address,uint256)[])' for v in abis['UserRegistryImpl'])
    print(f"PASS: {len(steps)} ABI-checked planned transactions; nested initializer verified; no executable payloads or wallet/RPC capabilities")


def main():
    p=argparse.ArgumentParser();p.add_argument('--build',type=Path);p.add_argument('--check',action='store_true');p.add_argument('--review',action='store_true');a=p.parse_args()
    if a.build:build(a.build)
    if a.check or a.review:
        m=json.loads((PLAN/'deployment-manifest.json').read_text());abis={p.stem:json.loads(p.read_text()) for p in (PLAN/'abis').glob('*.json')};validate(m,abis)
        if a.review:
            for s in m['transactions']:print(s['id'],s['label'],s['signature'],json.dumps(s['arguments']),s['status'])
        else:print('PASS: offline manifest validation')


if __name__=='__main__':main()
