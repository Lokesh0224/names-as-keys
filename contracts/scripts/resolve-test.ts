import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Contract, JsonRpcProvider, Interface, getAddress, namehash, toUtf8Bytes } from "ethers";

const rpcUrl = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
const name = process.env.ENS_TEST_NAME;
const expectedAddress = process.env.ENS_EXPECTED_ADDRESS;
const manifest = JSON.parse(readFileSync(resolve("deployments/sepolia.json"), "utf8"));
const resolverAddress = manifest.contracts.UpgradableUniversalResolverProxy.address as string;
const SEPOLIA_CHAIN_ID = 11155111n;

if (!name || !expectedAddress) {
  throw new Error("Set ENS_TEST_NAME and ENS_EXPECTED_ADDRESS for a registered ENSv2 name with an addr record.");
}
if (!name.toLowerCase().endsWith(".eth") || name.split(".").length < 3) {
  throw new Error("ENS_TEST_NAME must have the form mira.<parent>.eth.");
}

const provider = new JsonRpcProvider(rpcUrl, Number(SEPOLIA_CHAIN_ID), { staticNetwork: true });
const directResolver = new Contract(
  resolverAddress,
  ["function resolve(bytes name, bytes data) view returns (bytes result, address resolver)"],
  provider,
);
const addrInterface = new Interface(["function addr(bytes32 node) view returns (address)"]);

function revertSelector(error: unknown): string | null {
  const e = error as { data?: unknown; info?: { error?: { data?: unknown } } };
  const candidates = [e?.data, e?.info?.error?.data];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^0x[0-9a-fA-F]{8}/.test(candidate)) return candidate.slice(0, 10);
  }
  return null;
}

function dnsEncode(fullName: string): string {
  const labels = fullName.replace(/\.$/, "").split(".");
  const chunks: Uint8Array[] = [];
  for (const label of labels) {
    const bytes = toUtf8Bytes(label);
    if (bytes.length === 0 || bytes.length > 255) throw new Error("DNS label length is invalid");
    chunks.push(new Uint8Array([bytes.length]), bytes);
  }
  chunks.push(new Uint8Array([0]));
  return "0x" + Buffer.from(Uint8Array.from(chunks.flatMap((x) => [...x]))).toString("hex");
}

async function main() {
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== SEPOLIA_CHAIN_ID) throw new Error(`Expected Sepolia chain ID ${SEPOLIA_CHAIN_ID}, received ${chainId}`);

  let ethersV6Result: string | null = null;
  let ethersV6Error: string | null = null;
  try {
    ethersV6Result = await provider.resolveName(name);
  } catch (error) {
    // Suppress raw transport errors because some providers include the RPC URL.
    const selector = revertSelector(error);
    ethersV6Error = selector
      ? `provider.resolveName reverted with ${selector}`
      : "provider.resolveName threw; transport details suppressed";
  }

  const encodedName = dnsEncode(name);
  const node = namehash(name);
  const callData = addrInterface.encodeFunctionData("addr", [node]);
  let directResolverAddress: string | null = null;
  let directResult: string | null = null;
  let directError: string | null = null;
  try {
    const [result, resolver] = await directResolver.resolve(encodedName, callData);
    [directResult] = addrInterface.decodeFunctionResult("addr", result);
    directResolverAddress = resolver;
  } catch (error) {
    const selector = revertSelector(error);
    directError = selector
      ? `Universal Resolver call reverted with ${selector}`
      : "Universal Resolver call failed; transport details suppressed";
  }

  const expected = getAddress(expectedAddress);
  const ethersMatches = ethersV6Result !== null && getAddress(ethersV6Result) === expected;
  const directMatches = directResult !== null && getAddress(directResult) === expected;
  const pathsAgree = ethersV6Result !== null && directResult !== null
    && getAddress(ethersV6Result) === getAddress(directResult);
  const result = {
    chainId: chainId.toString(),
    name,
    expectedAddress: expected,
    ethersV6: ethersV6Result,
    ethersV6Error,
    universalResolverContract: getAddress(resolverAddress),
    resolverReturnedByUniversalResolver: directResolverAddress,
    directResult,
    directError,
    ethersMatches,
    directMatches,
    pathsAgree,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!ethersMatches || !directMatches || !pathsAgree) process.exitCode = 1;
}

main().catch(() => {
  console.error("Resolution probe failed; transport details suppressed to protect RPC credentials.");
  process.exitCode = 1;
});
