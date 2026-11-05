#!/usr/bin/env python3
"""Offline ENS compiler reproduction from official deployment metadata source contents.
No wallet, transaction submission, RPC or signing capability.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact_directory", type=Path)
    parser.add_argument("--solc", type=Path, required=True)
    args = parser.parse_args()
    artifacts = {p.stem: json.loads(p.read_text()) for p in sorted(args.artifact_directory.glob("*.json"))}
    sources, settings, targets = {}, None, {}
    for name, artifact in artifacts.items():
        metadata = json.loads(artifact["metadata"])
        current = dict(metadata["settings"])
        target = current.pop("compilationTarget")
        if settings is not None and settings != current:
            raise ValueError("inconsistent compiler settings")
        settings = current
        for path, source in metadata["sources"].items():
            value = {"content": source["content"]}
            if path in sources and sources[path] != value:
                raise ValueError("source contents differ across artifacts")
            sources[path] = value
        targets[name] = next(iter(target.items()))
    settings["outputSelection"] = {path: {contract: ["abi", "metadata", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"]} for path, contract in targets.values()}
    standard = {"language": "Solidity", "sources": sources, "settings": settings}
    out = REPO / "docs/prep/evidence/stage3e"
    input_path = out / "ens-standard-input.json"
    input_path.write_text(json.dumps(standard, sort_keys=True) + "\n")
    process = subprocess.run([str(args.solc), "--standard-json"], input=input_path.read_text(), capture_output=True, text=True, check=True)
    result = json.loads(process.stdout)
    errors = [e for e in result.get("errors", []) if e["severity"] == "error"]
    if errors:
        raise RuntimeError("solc reported compilation errors")
    report = {"solcVersion": subprocess.check_output([str(args.solc), "--version"], text=True).strip(), "solcBinarySHA256": hashlib.sha256(args.solc.read_bytes()).hexdigest(), "standardInputSHA256": hashlib.sha256(input_path.read_bytes()).hexdigest(), "sourceCount": len(sources), "settings": settings, "contracts": {}, "scope": "Reproducible source-to-published-bytecode templates; immutable values and live deployment provenance must be reconciled separately."}
    for name, (path, contract) in targets.items():
        compiled = result["contracts"][path][contract]
        artifact = artifacts[name]
        creation = compiled["evm"]["bytecode"]["object"].removeprefix("0x")
        runtime = compiled["evm"]["deployedBytecode"]["object"].removeprefix("0x")
        record = {"source": path, "contract": contract, "address": artifact["address"], "creationTemplateByteEqual": creation == artifact["bytecode"].removeprefix("0x"), "runtimeTemplateByteEqual": runtime == artifact["deployedBytecode"].removeprefix("0x"), "abiEqual": compiled["abi"] == artifact["abi"], "immutableReferences": compiled["evm"]["deployedBytecode"].get("immutableReferences", {}), "constructorArgumentsHex": artifact.get("argsData"), "buildInfoId": artifact["buildInfoId"], "transactionHash": artifact.get("transaction", {}).get("hash") if isinstance(artifact.get("transaction"), dict) else artifact.get("transaction"), "metadataSourcesSHA256": hashlib.sha256(artifact["metadata"].encode()).hexdigest()}
        report["contracts"][name] = record
    (out / "source-reproduction.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"sources": len(sources), "contracts": {n: {k: v[k] for k in ["creationTemplateByteEqual", "runtimeTemplateByteEqual", "abiEqual"]} for n, v in report["contracts"].items()}}, indent=2))


if __name__ == "__main__":
    main()
