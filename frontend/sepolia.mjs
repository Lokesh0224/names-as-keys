import { Contract, JsonRpcProvider, getAddress, id, isHexString, keccak256 } from 'ethers';
import registryABI from '../docs/prep/stage3e/abis/UserRegistryImpl.json' with { type: 'json' };
import { CHAIN, ROOT, LABEL, doorABI, registrarABI, guestPath, describeUnlock } from './protocol.mjs';

export async function createSepolia(env) {
  const rpc = new JsonRpcProvider(env.NAK_SEPOLIA_RPC_URL);
  const contract = getAddress(env.NAK_DOOR_KEYS_ADDRESS);
  const registrarAddress = getAddress(env.NAK_CREDENTIAL_REGISTRAR_ADDRESS);
  const guest = getAddress(env.NAK_MIRA_ADDRESS);
  const owner = getAddress(env.NAK_OWNER_ADDRESS);
  if (owner === guest || !isHexString(env.NAK_T14_TX_HASH, 32) || !isHexString(env.NAK_DOOR_RUNTIME_HASH, 32)) {
    throw new Error('Sepolia requires distinct wallet addresses, the reviewed DoorKeys runtime hash and T14 receipt hash.');
  }
  if ((await rpc.getNetwork()).chainId !== BigInt(CHAIN)) throw new Error('RPC must be Sepolia.');
  const door = new Contract(contract, doorABI, rpc);
  const registrar = new Contract(registrarAddress, registrarABI, rpc);
  const [receipt, code, registrarCode, root, doorId, administrator, r1, r2, epoch, registrarOwner,
    registrarRoot, registrarR1, registrarR2, rootToken, lockToken, registrarRootToken, registrarLockToken] = await Promise.all([
    rpc.getTransactionReceipt(env.NAK_T14_TX_HASH), rpc.getCode(contract), rpc.getCode(registrarAddress),
    door.rootLabel(), door.doorId(), door.administrator(), door.parentRegistry(), door.guestRegistry(),
    door.deploymentEpoch(), registrar.owner(), registrar.rootLabel(), registrar.parentRegistry(), registrar.guestRegistry(),
    door.rootTokenId(), door.lockTokenId(), registrar.rootTokenId(), registrar.lockTokenId(),
  ]);
  if (receipt?.status !== 1 || receipt.contractAddress !== contract || receipt.from !== owner ||
      code === '0x' || keccak256(code) !== env.NAK_DOOR_RUNTIME_HASH.toLowerCase() || registrarCode === '0x' ||
      root !== ROOT || administrator !== owner || epoch !== 1n || registrarOwner !== owner ||
      registrarRoot !== root || registrarR1 !== r1 || registrarR2 !== r2 ||
      rootToken !== registrarRootToken || lockToken !== registrarLockToken) {
    throw new Error('The configured addresses do not match the reviewed T14 deployment context.');
  }
  const registry = new Contract(r2, registryABI, rpc);
  const filter = door.filters.DoorUnlocked(doorId);
  const path = guestPath(doorId, contract);
  let lastLog;

  async function state(account) {
    const head = await rpc.getBlock('latest');
    const fromBlock = Math.max(receipt.blockNumber, head.number - 1999);
    const [credential, logs, nonce] = await Promise.all([
      registry.getState(BigInt(id(LABEL)), { blockTag: head.number }),
      door.queryFilter(filter, fromBlock, head.number),
      door.requestNonce({ blockTag: head.number }),
    ]);
    const activity = await Promise.all(logs.slice(-12).reverse().map(async log =>
      describeUnlock(log.args, (await log.getBlock()).timestamp * 1000, log.transactionHash)));
    let newest = logs.at(-1);
    if (!newest && nonce !== 0n) {
      if (lastLog?.args.requestNonce === nonce &&
          (await rpc.getBlock(lastLog.blockNumber))?.hash === lastLog.blockHash) {
        newest = lastLog;
      }
      for (let end = fromBlock - 1; !newest && end >= receipt.blockNumber; end -= 2000) {
        const older = await door.queryFilter(filter, Math.max(receipt.blockNumber, end - 1999), end);
        newest = older.at(-1);
      }
    }
    if ((newest?.args.requestNonce ?? 0n) !== nonce) throw new Error('Door event and request nonce disagree.');
    lastLog = newest;
    const latest = activity[0] ?? (newest
      ? describeUnlock(newest.args, (await newest.getBlock()).timestamp * 1000, newest.transactionHash)
      : null);
    let eligibility;
    if (account) {
      try {
        await door.unlock.staticCall(LABEL, { from: getAddress(account), blockTag: head.number });
        eligibility = 'Eligible';
      } catch (error) {
        if (error.code !== 'CALL_EXCEPTION') throw error;
        eligibility = 'Denied by DoorKeys';
      }
    }
    const expiry = Number(credential.expiry) * 1000;
    const status = Number(credential.status) === 2 ? 'Active'
      : expiry && expiry <= head.timestamp * 1000 ? 'Expired' : 'Inactive';
    return {
      mode: 'sepolia', root, contract, registrar: registrarAddress, r1, r2, doorId, owner, guest,
      guestPath: path, status, expiry, token: String(credential.tokenId), eligibility, activity, latest,
    };
  }
  return { state, path };
}
