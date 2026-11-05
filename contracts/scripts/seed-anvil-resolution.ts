import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  JsonRpcSigner,
  ZeroAddress,
  getAddress,
  keccak256,
  parseEther,
  toUtf8Bytes,
} from "ethers";

const manifest = JSON.parse(readFileSync(resolve("deployments/sepolia.json"), "utf8"));
const c = manifest.contracts;
const provider = new JsonRpcProvider(
  process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:8545",
  11155111,
  { staticNetwork: true },
);
const errorInterface = new Interface([
  "error ERC1155InvalidReceiver(address receiver)",
  "error UnexpiredCommitmentExists(bytes32 commitment)",
  "error CommitmentTooNew(bytes32 commitment,uint64 validFrom,uint64 blockTimestamp)",
  "error CommitmentTooOld(bytes32 commitment,uint64 validTo,uint64 blockTimestamp)",
  "error NameNotAvailable(string label)",
  "error DurationTooShort(uint64 duration,uint64 minDuration)",
  "error EACUnauthorizedAccountRoles(uint256 resource,uint256 roleBitmap,address account)",
]);
const guest = getAddress("0x0000000000000000000000000000000000000B0b");
const defaultOwner = getAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
const duration = 30 * 24 * 60 * 60;
const resolverAbi = [
  "function initialize((address account,uint256 roleBitmap)[] grants,bytes[] calls)",
  "function setAddress(bytes name,uint256 coinType,bytes addressBytes)",
];
function dnsEncode(fullName: string): string {
  const chunks: Uint8Array[] = [];
  for (const label of fullName.replace(/\.$/, "").split(".")) {
    const bytes = toUtf8Bytes(label);
    if (!bytes.length || bytes.length > 255) throw new Error("DNS label length is invalid");
    chunks.push(new Uint8Array([bytes.length]), bytes);
  }
  chunks.push(new Uint8Array([0]));
  return "0x" + Buffer.from(Uint8Array.from(chunks.flatMap((x) => [...x]))).toString("hex");
}

function findRevertData(value: unknown, seen = new Set<unknown>()): string | null {
  if (typeof value === "string") return /^0x[0-9a-fA-F]{8,}$/.test(value) ? value : null;
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of ["data", "error", "info", "cause", "result"]) {
    if (key in record) {
      const found = findRevertData(record[key], seen);
      if (found) return found;
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (["data", "error", "info", "cause", "result"].includes(key)) continue;
    const found = findRevertData(child, seen);
    if (found) return found;
  }
  return null;
}

function explainRevert(error: unknown): { selector: string | null; decoded: string | null; data: string | null } {
  const data = findRevertData(error);
  if (!data) return { selector: null, decoded: null, data: null };
  const selector = data.slice(0, 10);
  try {
    const parsed = errorInterface.parseError(data);
    return { selector, decoded: parsed ? `${parsed.name}(${[...parsed.args].join(", ")})` : null, data };
  } catch {
    return { selector, decoded: null, data };
  }
}

async function sendLogged(
  step: string,
  contract: string,
  signer: JsonRpcSigner,
  functionSignature: string,
  submit: () => Promise<any>,
  context: Record<string, unknown> = {},
) {
  const from = await signer.getAddress();
  const functionSelector = `0x${keccak256(toUtf8Bytes(functionSignature)).slice(2, 10)}`;
  console.log(JSON.stringify({ step, action: "submit", from, contract: getAddress(contract), functionSignature, functionSelector, ...context }));
  try {
    const tx = await submit();
    return await tx.wait();
  } catch (error) {
    const detail = explainRevert(error);
    console.error(JSON.stringify({ step, contract: getAddress(contract), functionSignature, functionSelector, ...context, ...detail }));
    throw error;
  }
}

async function main() {
  // Query Anvil directly so a provider's configured staticNetwork cannot mask
  // the endpoint chain ID or change how the unlocked accounts are enumerated.
  const actualChainId = BigInt(await provider.send("eth_chainId", []));
  if (actualChainId !== 11155111n) {
    throw new Error(`Expected Anvil fork chain ID 11155111, received ${actualChainId}`);
  }
  const unlocked = (await provider.send("eth_accounts", [])) as string[];
  const requestedOwner = getAddress(process.env.A6_PARENT_OWNER ?? defaultOwner);
  const deterministicFallback = getAddress(
    `0x${keccak256(toUtf8Bytes("EthMumbai2026 Names as Keys A6 Anvil parent owner")).slice(-40)}`,
  );
  const orderedCandidates = [
    requestedOwner,
    ...unlocked.filter((a) => a.toLowerCase() !== requestedOwner.toLowerCase()),
    deterministicFallback,
  ].filter((address, index, all) => all.findIndex((a) => a.toLowerCase() === address.toLowerCase()) === index);
  const diagnostics: Array<{ address: string; unlocked: boolean; codeLengthBytes: number | null; error?: string }> = [];
  let owner: string | null = null;
  let ownerCode = "";
  for (const candidate of orderedCandidates) {
    const address = getAddress(candidate);
    const isUnlocked = unlocked.some((a) => a.toLowerCase() === address.toLowerCase());
    let code: string | null = null;
    try {
      // Raw eth_getCode directly exercises this endpoint and address.
      code = await provider.send("eth_getCode", [address, "latest"]);
      const codeLengthBytes = typeof code === "string" && code.startsWith("0x") ? (code.length - 2) / 2 : null;
      diagnostics.push({ address, unlocked: isUnlocked, codeLengthBytes });
      if (code === "0x") {
        owner = address;
        ownerCode = code;
        if (!isUnlocked) {
          // A deterministic local-only account avoids depending on the code
          // state of popular Anvil keys on the Sepolia fork. No private key is
          // used or stored; Anvil impersonates this code-empty address.
          await provider.send("anvil_impersonateAccount", [address]);
          await provider.send("anvil_setBalance", [address, `0x${parseEther("100").toString(16)}`]);
        }
        break;
      }
    } catch (error) {
      diagnostics.push({ address, unlocked: isUnlocked, codeLengthBytes: null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!owner) {
    throw new Error(`No code-empty parent owner available. chainId=${actualChainId}; unlockedAccounts=${JSON.stringify(unlocked)}; candidates=${JSON.stringify(diagnostics)}`);
  }
  const signer = await provider.getSigner(owner);
  const signerAddress = await signer.getAddress();
  const factory = new Contract(c.VerifiableFactory.address, [
    "function deployProxy(address implementation,uint256 salt,bytes data) returns (address)",
  ], signer);
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("Could not read the Anvil fork head");
  const parentLabel = process.env.A6_PARENT_LABEL ?? `a6${block.number}${block.timestamp}`;
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(parentLabel)) {
    throw new Error("A6_PARENT_LABEL must be 3-32 lowercase letters/digits/hyphens without edge hyphens");
  }

  const registrar = new Contract(c.ETHRegistrar.address, [
    "function makeCommitment(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,bytes32 referrer) pure returns (bytes32)",
    "function commit(bytes32 commitment)",
    "function getRegisterPrice(string label,uint64 duration,address paymentToken) view returns (uint256 base,uint256 premium)",
    "function register(string label,address owner,bytes32 secret,address subregistry,address resolver,uint64 duration,address paymentToken,bytes32 referrer) returns (uint256)",
  ], signer);
  const payment = new Contract(c.MockUSDC.address, [
    "function mint(address to,uint256 amount)",
    "function approve(address spender,uint256 amount) returns (bool)",
  ], signer);
  const [base, premium] = await registrar.getRegisterPrice(parentLabel, duration, c.MockUSDC.address);
  const secret = keccak256(toUtf8Bytes(`${parentLabel}:${block.hash}:${signerAddress}`));
  const referrer = `0x${"00".repeat(32)}`;
  const commitment = await registrar.makeCommitment(
    parentLabel, signerAddress, secret, ZeroAddress, c.PublicResolverV2.address, duration, referrer,
  );
  await sendLogged("commit parent", c.ETHRegistrar.address, signer,
    "commit(bytes32)", () => registrar.commit(commitment));
  await provider.send("evm_increaseTime", [61]);
  await provider.send("evm_mine", []);
  await sendLogged("mint mock payment", c.MockUSDC.address, signer,
    "mint(address,uint256)", () => payment.mint(signerAddress, base + premium + 1n));
  await sendLogged("approve registrar payment", c.MockUSDC.address, signer,
    "approve(address,uint256)", () => payment.approve(c.ETHRegistrar.address, base + premium + 1n));
  const parentReceipt = await sendLogged(
    "register parent", c.ETHRegistrar.address, signer,
    "register(string,address,bytes32,address,address,uint64,address,bytes32)",
    () => registrar.register(
      parentLabel, signerAddress, secret, ZeroAddress, c.PublicResolverV2.address, duration, c.MockUSDC.address, referrer,
    ),
    { label: parentLabel, parentOwner: signerAddress, parentOwnerCode: ownerCode },
  );
  const nameRegistered = parentReceipt?.logs
    .map((log: { topics: string[]; data: string }) => {
      try { return new Interface(["event NameRegistered(uint256 indexed tokenId,string label,address owner,address subregistry,address resolver,uint64 duration,address paymentToken,bytes32 indexed referrer,uint256 base,uint256 premium)"]).parseLog(log); }
      catch { return null; }
    })
    .find((parsed: { name?: string } | null) => parsed?.name === "NameRegistered");
  if (!nameRegistered) throw new Error("Parent registration receipt did not include NameRegistered");
  const parentTokenId = nameRegistered.args.tokenId as bigint;

  const registryRoles = 1n | (1n << 12n) | (1n << 20n) | (1n << 24n) | (1n << 128n) | (1n << 140n) | (1n << 148n);
  const userInit = new Interface(["function initialize((address account,uint256 roleBitmap)[] grants)"])
    .encodeFunctionData("initialize", [[{ account: signerAddress, roleBitmap: registryRoles }]]);
  const userSalt = BigInt(keccak256(toUtf8Bytes(`${parentLabel}:user-registry`)));
  const userReceipt = await sendLogged(
    "deploy UserRegistry proxy", c.VerifiableFactory.address, signer,
    "deployProxy(address,uint256,bytes)", () => factory.deployProxy(c.UserRegistryImpl.address, userSalt, userInit),
  );
  const userEvent = userReceipt?.logs
    .map((log: { topics: string[]; data: string }) => {
      try { return new Interface(["event ProxyDeployed(address indexed sender,address indexed proxyAddress,uint256 salt,address implementation)"]).parseLog(log); }
      catch { return null; }
    })
    .find((parsed: { name?: string } | null) => parsed?.name === "ProxyDeployed");
  if (!userEvent) throw new Error("UserRegistry proxy receipt missing ProxyDeployed");
  const userRegistryAddress = getAddress(userEvent.args.proxyAddress as string);

  const ethRegistry = new Contract(c.ETHRegistry.address, ["function setSubregistry(uint256 anyId,address registry)"], signer);
  await sendLogged("attach UserRegistry", c.ETHRegistry.address, signer,
    "setSubregistry(uint256,address)", () => ethRegistry.setSubregistry(parentTokenId, userRegistryAddress));

  const setAddressRole = 1n;
  const resolverInit = new Interface(["function initialize((address account,uint256 roleBitmap)[] grants,bytes[] calls)"])
    .encodeFunctionData("initialize", [[{ account: signerAddress, roleBitmap: setAddressRole | (setAddressRole << 128n) }], []]);
  const resolverSalt = BigInt(keccak256(toUtf8Bytes(`${parentLabel}:resolver`)));
  const resolverReceipt = await sendLogged(
    "deploy PermissionedResolver proxy", c.VerifiableFactory.address, signer,
    "deployProxy(address,uint256,bytes)", () => factory.deployProxy(c.PermissionedResolverImpl.address, resolverSalt, resolverInit),
  );
  const resolverEvent = resolverReceipt?.logs
    .map((log: { topics: string[]; data: string }) => {
      try { return new Interface(["event ProxyDeployed(address indexed sender,address indexed proxyAddress,uint256 salt,address implementation)"]).parseLog(log); }
      catch { return null; }
    })
    .find((parsed: { name?: string } | null) => parsed?.name === "ProxyDeployed");
  if (!resolverEvent) throw new Error("PermissionedResolver proxy receipt missing ProxyDeployed");
  const resolverAddress = getAddress(resolverEvent.args.proxyAddress as string);

  const subregistry = new Contract(userRegistryAddress, [
    "function register(string label,address owner,address registry,address resolver,uint256 roleBitmap,uint64 expiry) returns (uint256)",
  ], signer);
  const head = await provider.getBlock("latest");
  if (!head) throw new Error("Could not read latest Anvil block");
  const childExpiry = head.timestamp + 7 * 24 * 60 * 60;
  await sendLogged("register mira child", userRegistryAddress, signer,
    "register(string,address,address,address,uint256,uint64)",
    () => subregistry.register("mira", guest, ZeroAddress, resolverAddress, 0, childExpiry),
    { label: "mira", guest, expiry: childExpiry });

  const fullName = `mira.${parentLabel}.eth`;
  const resolver = new Contract(resolverAddress, resolverAbi, signer);
  await sendLogged("set guest address record", resolverAddress, signer,
    "setAddress(bytes,uint256,bytes)", () => resolver.setAddress(dnsEncode(fullName), 60, guest),
    { name: fullName, coinType: 60, expectedAddress: guest });
  console.log(`A6_FULL_NAME=${fullName}`);
  console.log(JSON.stringify({
    chainId: actualChainId.toString(),
    fullName,
    expectedAddress: guest,
    parentOwner: signerAddress,
    parentTokenId: parentTokenId.toString(),
    userRegistry: userRegistryAddress,
    permissionedResolver: resolverAddress,
    instruction: `Run: ENS_TEST_NAME=${fullName} ENS_EXPECTED_ADDRESS=${guest} npx tsx scripts/resolve-test.ts`,
  }, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Anvil ENSv2 seed setup failed: ${message.replace(/https?:\/\/\S+/g, "[RPC_URL]")}`);
  process.exitCode = 1;
});
