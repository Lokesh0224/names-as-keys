#!/usr/bin/env python3
"""Credential-free Sepolia inspection. Only a hard allowlist of read RPC methods exists."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

REPO = Path(__file__).resolve().parents[3]
ENDPOINT = "https://sepolia.gateway.tenderly.co"
ALLOWED = frozenset({"eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_gasPrice"})


def rpc(method, params):
    if method not in ALLOWED:
        raise ValueError("RPC method is not read-only allowlisted")
    request = urllib.request.Request(ENDPOINT, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), headers={"Content-Type": "application/json", "User-Agent": "Names-as-Keys-read-only"})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.load(response)
    except Exception as exc:
        return {"error": {"transport": type(exc).__name__}}


def calldata(signature, args=()):
    return subprocess.check_output(["cast", "calldata", signature, *map(str, args)], text=True).strip()


def words(value):
    data = value[2:]
    if len(data) % 64:
        raise ValueError("not ABI words")
    return [int(data[i:i + 64], 16) for i in range(0, len(data), 64)]


def main():
    manifest = json.loads((REPO / "contracts/deployments/sepolia.json").read_text())["contracts"]
    chain = rpc("eth_chainId", [])
    if chain.get("result") != hex(11155111):
        raise RuntimeError("Sepolia chain verification failed")
    block = hex(int(rpc("eth_blockNumber", [])["result"], 16) - 32)
    header = rpc("eth_getBlockByNumber", [block, False])["result"]
    report = {"chainId": 11155111, "block": int(block, 16), "blockHash": header["hash"], "blockTimestamp": int(header["timestamp"], 16), "observedUTC": datetime.datetime.now(datetime.timezone.utc).isoformat(), "methodsAllowed": sorted(ALLOWED), "contracts": {}, "queries": [], "noSigningOrBroadcast": True}
    for name, item in manifest.items():
        response = rpc("eth_getCode", [item["address"], block])
        code = response.get("result")
        value = {"address": item["address"], "block": int(block, 16), "status": "VERIFIED" if code and code != "0x" else "BLOCKED", "runtimeBytes": (len(code) - 2) // 2 if code else None, "runtimeKeccak256": subprocess.check_output(["cast", "keccak", code], text=True).strip() if code else None}
        if code:
            raw = bytes.fromhex(code[2:]);size = int.from_bytes(raw[-2:], "big") if len(raw) > 2 else 0
            value["trailingMetadataHex"] = raw[-size - 2:].hex() if size and size + 2 < len(raw) else None
        else:
            value["error"] = response.get("error")
        report["contracts"][name] = value
    def call(target, signature, args=()):
        data = calldata(signature, args)
        result = rpc("eth_call", [{"to": manifest[target]["address"], "data": data}, block])
        record = {"target": target, "signature": signature, "arguments": list(args), "data": data, "response": result}
        report["queries"].append(record)
        return result.get("result")
    report["root"] = {"label": "nak-lokesh-20261105", "durationSeconds": 31536000, "prices": {}}
    root = report["root"]
    labelhash = subprocess.check_output(["cast", "keccak", root["label"]], text=True).strip();root["labelHash"] = labelhash
    for name, sig, args in [("available", "isAvailable(string)", [root["label"]])]:
        value = call("ETHRegistrar", sig, args);root[name] = bool(words(value)[0]) if value else None
    state = call("ETHRegistry", "getState(uint256)", [labelhash])
    root["stateWords"] = words(state) if state else None
    owner = call("ETHRegistry", "getOwner(uint256)", [labelhash]);root["owner"] = "0x" + owner[-40:] if owner else None
    for token in ["MockUSDC", "MockDAI"]:
        value = call("ETHRegistrar", "getRegisterPrice(string,uint64,address)", [root["label"], root["durationSeconds"], manifest[token]["address"]])
        decimals = call(token, "decimals()")
        root["prices"][token] = {"rawBasePremium": words(value) if value else None, "decimals": words(decimals)[0] if decimals else None}
    report["registrarConfiguration"] = {}
    for sig in ["MIN_COMMITMENT_AGE()", "MAX_COMMITMENT_AGE()", "MIN_REGISTER_DURATION()", "GRACE_PERIOD()", "ETH_REGISTRY()", "BENEFICIARY()", "rentPriceOracle()", "owner()"]:
        value = call("ETHRegistrar", sig);report["registrarConfiguration"][sig] = value
    report["ethAttachment"] = call("RootRegistry", "getSubregistry(string)", ["eth"])
    report["resolverReportsENSv2"] = call("UpgradableUniversalResolverProxy", "isENSv2()")
    report["gasPriceObservation"] = rpc("eth_gasPrice", [])
    report["sourceSHA256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    path = REPO / "docs/prep/evidence/stage3e/current-sepolia.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"block": report["block"], "blockHash": report["blockHash"], "root": root, "configuration": report["registrarConfiguration"], "queries": len(report["queries"]), "codePresent": sum(v["status"] == "VERIFIED" for v in report["contracts"].values())}, indent=2))


if __name__ == "__main__":
    main()
