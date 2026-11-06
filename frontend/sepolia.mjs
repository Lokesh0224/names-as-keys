import { Contract, JsonRpcProvider, ZeroAddress, getAddress, id, isHexString, keccak256 } from 'ethers';
import registryABI from '../docs/prep/stage3e/abis/UserRegistryImpl.json' with { type: 'json' };
import { CHAIN, ROOT, LABEL, doorABI, registrarABI, guestPath, describeUnlock } from './protocol.mjs';

export function credentialStatus(credential, owner, timestamp) {
  const initialToken = BigInt(id(LABEL)) & ~0xffffffffn;
  if (Number(credential.status) === 2 && owner !== ZeroAddress && credential.expiry > timestamp) return 'Active';
  if (credential.expiry > 0n && credential.expiry <= timestamp) {
    if (credential.latestOwner !== ZeroAddress) return 'Expired';
    return credential.tokenId !== initialToken ? 'Revoked' : 'Inactive';
  }
  return Number(credential.status) === 0 && credential.expiry === 0n && credential.latestOwner === ZeroAddress &&
    credential.tokenId === initialToken && credential.resource === initialToken + 1n ? 'Unissued' : 'Inactive';
}

export const confirmedThrough = head => head - 1; // Two confirmations, including the event block.

export function assertConfirmedDoorEvent(log, nonce, canonicalHash) {
  if ((log?.args.requestNonce ?? 0n) !== nonce || (log && log.blockHash !== canonicalHash)) {
    throw new Error('Confirmed door event does not match canonical chain state.');
  }
}

export async function createSepolia(env) {
  const rpc = new JsonRpcProvider(env.NAK_SEPOLIA_RPC_URL);
  const contract = getAddress(env.NAK_DOOR_KEYS_ADDRESS);
  const registrarAddress = getAddress(env.NAK_CREDENTIAL_REGISTRAR_ADDRESS);
  const guest = getAddress(env.NAK_MIRA_ADDRESS);
  const owner = getAddress(env.NAK_OWNER_ADDRESS);
  if (owner === guest || !isHexString(env.NAK_T14_TX_HASH, 32) || !isHexString(env.NAK_DOOR_RUNTIME_HASH, 32) || !isHexString(env.NAK_REGISTRAR_RUNTIME_HASH, 32)) {
    throw new Error('Sepolia requires distinct wallet addresses, the reviewed runtime hashes and T14 receipt hash.');
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
      keccak256(registrarCode) !== env.NAK_REGISTRAR_RUNTIME_HASH.toLowerCase() ||
      root !== ROOT || administrator !== owner || epoch !== 1n || registrarOwner !== owner ||
      registrarRoot !== root || registrarR1 !== r1 || registrarR2 !== r2 ||
      rootToken !== registrarRootToken || lockToken !== registrarLockToken) {
    throw new Error('The configured addresses do not match the reviewed T14 deployment context.');
  }
  if ((await rpc.getBlock(receipt.blockNumber))?.hash !== receipt.blockHash ||
      confirmedThrough(await rpc.getBlockNumber()) < receipt.blockNumber) {
    throw new Error('Wait for the canonical T14 receipt to have two confirmations.');
  }
  const registry = new Contract(r2, registryABI, rpc);
  const filter = door.filters.DoorUnlocked(doorId);
  const path = guestPath(doorId, contract);
  if (env.NAK_GUEST_URL !== new URL(path, env.NAK_PUBLIC_ORIGIN).href) {
    throw new Error('Confirm the exact guest URL in NAK_GUEST_URL.');
  }
  const labelId = BigInt(id(LABEL));
  let lastLog, lastPresentation;

  async function prepare(action, account) {
    const sender = getAddress(account);
    if (action === 'unlock') {
      if (sender !== guest) throw new Error('Connect the configured guest wallet.');
      await door.unlock.staticCall(LABEL, { from: sender });
      return { to: contract, data: door.interface.encodeFunctionData('unlock', [LABEL]) };
    }
    if (sender !== owner) throw new Error('Connect the configured owner wallet.');
    const head = await rpc.getBlock('latest');
    if (action === 'issue') {
      const args = [LABEL, guest, head.timestamp + 300];
      await registrar.issue.staticCall(...args, { from: sender, blockTag: head.number });
      return { to: registrarAddress, data: registrar.interface.encodeFunctionData('issue', args) };
    }
    if (action === 'revoke') {
      const record = await registry.getState(labelId, { blockTag: head.number });
      const args = [LABEL, record.tokenId];
      await registrar.revoke.staticCall(...args, { from: sender, blockTag: head.number });
      return { to: registrarAddress, data: registrar.interface.encodeFunctionData('revoke', args) };
    }
    throw new Error('Unknown wallet action.');
  }

  async function state(account) {
    const head = await rpc.getBlock('latest');
    const through = confirmedThrough(head.number);
    const fromBlock = Math.max(receipt.blockNumber, through - 1999);
    const [credential, credentialOwner, logs, nonce] = await Promise.all([
      registry.getState(labelId, { blockTag: head.number }),
      registry.getOwner(labelId, { blockTag: head.number }),
      through >= fromBlock ? door.queryFilter(filter, fromBlock, through) : [],
      through >= receipt.blockNumber ? door.requestNonce({ blockTag: through }) : 0n,
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
    assertConfirmedDoorEvent(newest, nonce, newest && (await rpc.getBlock(newest.blockNumber))?.hash);
    let openAt = lastPresentation;
    if (newest && (!lastLog || newest.transactionHash !== lastLog.transactionHash || newest.blockHash !== lastLog.blockHash ||
        newest.index !== lastLog.index)) {
      const confirming = await rpc.getBlock(newest.blockNumber + 1);
      openAt = lastLog ? Date.now() : Math.min(Date.now(), confirming.timestamp * 1000);
    }
    lastLog = newest;
    lastPresentation = newest ? openAt : undefined;
    const latest = activity[0] ?? (newest
      ? describeUnlock(newest.args, (await newest.getBlock()).timestamp * 1000, newest.transactionHash)
      : null);
    let eligibility;
    const evaluatedAccount = account ?? (credentialOwner !== ZeroAddress ? credentialOwner : undefined);
    if (evaluatedAccount) {
      try {
        await door.unlock.staticCall(LABEL, { from: getAddress(evaluatedAccount), blockTag: head.number });
        eligibility = 'Eligible';
      } catch (error) {
        if (error.code !== 'CALL_EXCEPTION') throw error;
        eligibility = 'Denied by DoorKeys';
      }
    }
    const expiry = Number(credential.expiry) * 1000;
    const status = credentialStatus(credential, credentialOwner, BigInt(head.timestamp));
    return {
      mode: 'sepolia', root, contract, registrar: registrarAddress, r1, r2, doorId, owner, guest,
      guestPath: path, status, expiry, credentialOwner, token: String(credential.tokenId), eligibility, activity,
      latest: latest && { ...latest, openAt: lastPresentation },
    };
  }
  return { state, path, prepare };
}
