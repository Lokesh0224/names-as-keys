import { AbiCoder, id, keccak256, sha256, toBeHex, zeroPadValue } from 'ethers';
import { factoryPrediction } from '../deployment_candidate/prediction.mjs';

export const need = (condition, message) => { if (!condition) throw new Error(message); };
export const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const zero = '0x' + '00'.repeat(20);

export async function candidateStep(ctx, step, header, privateArgs, entries) {
  const { plan, inputs, observation, runtimeHashes, logicSha256, proofs } = ctx.bundle;
  const { addresses: a, interfaces: i, abis, owner } = ctx;
  const block = header.number;
  const label = inputs.root.slice(0, -4);
  const args = privateArgs ?? [...step.candidateArguments];
  const now = BigInt(header.timestamp);
  const root = entries.T04?.bindings;
  const lock = entries.T08?.bindings;
  const checks = [];
  const event = (name, signature, args) => ({ address: a[name], abi: abis[name], signature: i[name].getEvent(signature).format('sighash'), arguments: args });
  const expect = (name, sig, args, values) => ({ id: name + '.' + sig, kind: 'call', to: a[name],
    data: i[name].encodeFunctionData(sig, args), expected: i[name].encodeFunctionResult(sig, values) });
  const code = (name, expectedHash) => ({ id: name + '.runtime', kind: 'code', to: a[name], expectedHash });
  const raw = (name, sig, args, tag = block) => ctx.read('eth_call', [{ to: a[name], data: i[name].encodeFunctionData(sig, args) }, tag]);
  const read = async (name, sig, args = []) => i[name].decodeFunctionResult(sig, await raw(name, sig, args));
  async function requireCheck(check) {
    const actual = check.kind === 'code' ? keccak256(await ctx.read('eth_getCode', [check.to, block])) :
      await ctx.read('eth_call', [{ to: check.to, data: check.data }, block]);
    need(same(actual, check.expected ?? check.expectedHash), 'Prerequisite changed: ' + check.id);
    checks.push(check.id);
  }
  const requireValue = (name, sig, args, values) => requireCheck(expect(name, sig, args, values));
  const state = async (name, text) => (await read(name, 'getState', [id(text)]))[0];
  const empty = name => requireCheck(code(name, keccak256('0x')));
  const active = (name, text, binding) => expect(name, 'getOwner', [id(text)], [binding.owner]);
  const status = (name, text, binding) => expect(name, 'getState', [id(text)], [[2, binding.expiry, binding.owner, binding.tokenId, binding.resource]]);
  const registered = (name, text, binding) => [status(name, text, binding), active(name, text, binding)];
  const roles = (name, resource, account, bitmap) => expect(name, 'roles', [resource, account], [bitmap]);
  const rootGrant = BigInt(plan.initializationRoleBitmap);
  const lockGrant = BigInt(plan.transactions[7].candidateArguments[4]);
  const registrarGrant = BigInt(plan.transactions[12].candidateArguments[0]);
  const registrationGrant = BigInt(ctx.bundle.registrationRoles);
  const price = BigInt(observation.priceUnits);
  let tokenReview = { token: a.MockUSDC, units: '0', amount: '0.0', decimals: inputs.spending.decimals };
  let minimumRemaining, revealDeadline;
  let receipt;
  const staticResult = (events, post, current = post, bindings) => async () => ({ events, post, current, bindings });
  const stage = Number(step.id.slice(1));

  // Check only contracts and state that must exist before this step.
  await empty('Owner');
  await requireCheck(code('ETHRegistrar', runtimeHashes.ETHRegistrar));
  await requireCheck(code('ETHRegistry', runtimeHashes.ETHRegistry));
  await requireCheck(code('RootRegistry', runtimeHashes.RootRegistry));
  await requireValue('RootRegistry', 'getSubregistry', ['eth'], [a.ETHRegistry]);
  await requireValue('ETHRegistrar', 'ETH_REGISTRY', [], [a.ETHRegistry]);
  if (stage <= 4) {
    await requireCheck(code('MockUSDC', runtimeHashes.MockUSDC));
    await requireCheck(code('StandardRentPriceOracle', runtimeHashes.StandardRentPriceOracle));
    await requireValue('ETHRegistrar', 'rentPriceOracle', [], [a.StandardRentPriceOracle]);
    await requireValue('ETHRegistrar', 'isAvailable', [label], [true]);
    const [base, premium] = await read('ETHRegistrar', 'getRegisterPrice', [label, inputs.expiry.rootDurationSeconds, a.MockUSDC]);
    need(base + premium === price && price <= BigInt(inputs.spending.maxRentUnits), 'Rent quote changed. Refresh candidate.');
    const balance = (await read('MockUSDC', 'balanceOf', [owner]))[0];
    const allowance = (await read('MockUSDC', 'allowance', [owner, a.ETHRegistrar]))[0];
    checks.push('MockUSDC.balanceOf', 'MockUSDC.allowance', 'ETHRegistrar.getRegisterPrice');
    tokenReview = { ...tokenReview, balanceUnits: balance.toString(), allowanceUnits: allowance.toString(), quoteUnits: price.toString() };
    if (stage === 1) {
      need(price > balance && BigInt(args[1]) === price - balance, 'Mint no longer matches exact deficit');
      tokenReview = { ...tokenReview, units: String(args[1]), amount: ctx.formatAmount(args[1]) };
      receipt = staticResult([event('MockUSDC','Transfer',[zero,owner,args[1]])],
        [expect('MockUSDC','balanceOf',[owner],[price])], []);
    }
    if (stage === 2) {
      need(balance >= price && allowance !== price && BigInt(args[1]) === price, 'Approval no longer matches exact quote or balance');
      tokenReview = { ...tokenReview, units: price.toString(), amount: ctx.formatAmount(price), spender: a.ETHRegistrar };
      receipt = staticResult([event('MockUSDC','Approval',[owner,a.ETHRegistrar,price])],
        [expect('MockUSDC','allowance',[owner,a.ETHRegistrar],[price])], []);
    }
    if (stage >= 3) need(balance >= price && allowance === price, 'Rent funding or exact allowance missing');
    if (stage === 3) {
      await requireValue('ETHRegistrar','commitmentAt',[args[0]],[0]);
      receipt = async h => ({ events: [event('ETHRegistrar','CommitmentMade',args)],
        post: [expect('ETHRegistrar','commitmentAt',args,[h.timestamp])], current: [], bindings: { commitmentTimestamp: h.timestamp } });
    }
    if (stage === 4) {
      const commitment = ctx.commitmentForReview(args);
      const committedAt = BigInt(entries.T03.bindings.commitmentTimestamp);
      await requireValue('ETHRegistrar','commitmentAt',[commitment],[committedAt]);
      const min = (await read('ETHRegistrar','MIN_COMMITMENT_AGE'))[0];
      const max = (await read('ETHRegistrar','MAX_COMMITMENT_AGE'))[0];
      revealDeadline = committedAt + max;
      need(now >= committedAt + min && now < revealDeadline, 'Outside commitment reveal window');
      const beneficiary = (await read('ETHRegistrar','BENEFICIARY'))[0];
      receipt = await registration('ETHRegistry', label, owner, a.ETHRegistrar, registrationGrant,
        h => BigInt(h.timestamp) + BigInt(inputs.expiry.rootDurationSeconds),
        b => [event('ETHRegistrar','NameRegistered',[b.tokenId,label,owner, ...args.slice(3),base,premium])],
        [event('MockUSDC','Transfer',[owner,beneficiary,price])],
        [expect('ETHRegistrar','commitmentAt',[commitment],[0])]);
    }
  }
  if (stage >= 5) {
    for (const check of registered('ETHRegistry',label,root)) await requireCheck(check);
    await requireCheck(roles('ETHRegistry',root.resource,owner,registrationGrant));
  }
  if (stage >= 5 && stage <= 15) {
    await requireCheck(code('VerifiableFactory', runtimeHashes.VerifiableFactory));
    await requireCheck(code('UserRegistryImpl', runtimeHashes.UserRegistryImpl));
    const logic = (await read('VerifiableFactory','proxyLogic'))[0];
    const runtime = await ctx.read('eth_getCode',[logic,block]);
    need(sha256(runtime) === logicSha256, 'Factory logic runtime drift');
    await requireValue('UserRegistryImpl','LABEL_STORE',[],[a.LabelStore]);
    for (const [name, createStage] of [['R1',5],['R2',9]]) {
      if (stage < createStage) continue;
      const prediction = factoryPrediction(a.VerifiableFactory,logic,owner,inputs.salts[name]);
      need(same(prediction.address,a[name]), 'Factory prediction drift');
      if (stage === createStage) {
        await empty(name);
        await requireValue('VerifiableFactory','predictProxyAddress',[owner,inputs.salts[name]],[a[name]]);
        const renderer = (await read('UserRegistryImpl','URI_RENDERER'))[0];
        receipt = staticResult([
          event(name,'Upgraded',[a.UserRegistryImpl]),event(name,'RegistryCreated',[]),
          event(name,'EACRolesChanged',[0,owner,0,rootGrant]),event(name,'URIUpdated',['',renderer,zero]),
          event(name,'Initialized',[1]),event('VerifiableFactory','ProxyDeployed',[owner,a[name],inputs.salts[name],a.UserRegistryImpl]),
        ], [code(name,keccak256(prediction.runtime)),expect('VerifiableFactory','verifyContract',[a[name]],[a.UserRegistryImpl]),
          roles(name,0,owner,rootGrant),expect(name,'roleCount',[0],[rootGrant])],
          [code(name,keccak256(prediction.runtime)),expect('VerifiableFactory','verifyContract',[a[name]],[a.UserRegistryImpl]),roles(name,0,owner,rootGrant)], { address: a[name] });
      } else {
        await requireCheck(code(name,keccak256(prediction.runtime)));
        await requireValue('VerifiableFactory','verifyContract',[a[name]],[a.UserRegistryImpl]);
        await requireCheck(roles(name,0,owner,rootGrant));
      }
    }
  }
  if (stage === 6) {
    args[0] = root.tokenId;
    await requireValue('ETHRegistry','getSubregistry',[label],[zero]);
    receipt = staticResult([event('ETHRegistry','SubregistryUpdated',[args[0],a.R1,owner])],
      [expect('ETHRegistry','getSubregistry',[label],[a.R1])]);
  }
  if (stage === 7) receipt = staticResult([event('R1','ParentUpdated',[a.ETHRegistry,label,owner])],
    [expect('R1','getParent',[],[a.ETHRegistry,label])]);
  if (stage === 8) {
    const expiry = now + BigInt(inputs.expiry.lockDurationSeconds);
    need(expiry <= BigInt(root.expiry) && expiry < 2n ** 64n, 'Lock expiry outside ancestor bounds');
    args[5] = expiry;
    receipt = await registration('R1','lock',owner,owner,lockGrant,() => expiry);
  }
  if (stage >= 9) {
    for (const check of registered('R1','lock',lock)) await requireCheck(check);
    await requireCheck(roles('R1',lock.resource,owner,lockGrant));
  }
  if (stage === 10) {
    args[0] = lock.tokenId;
    await requireValue('R1','getSubregistry',['lock'],[zero]);
    receipt = staticResult([event('R1','SubregistryUpdated',[args[0],a.R2,owner])],
      [expect('R1','getSubregistry',['lock'],[a.R2])]);
  }
  if (stage === 11) receipt = staticResult([event('R2','ParentUpdated',[a.R1,'lock',owner])],
    [expect('R2','getParent',[],[a.R1,'lock'])]);
  if (stage === 12 || stage === 14) {
    const name = step.abi;
    await empty(name);
    const values = { owner, administrator: owner, parentRegistry: a.R1, guestRegistry: a.R2,
      rootTokenId: root.tokenId, lockTokenId: lock.tokenId, rootLabelHash: id(label), deploymentEpoch: inputs.deploymentEpoch,
      doorId: keccak256(AbiCoder.defaultAbiCoder().encode(
        ['uint256','address','bytes32','bytes32','address','address','uint256','uint256','uint256'],
        [11155111,a.DoorKeys,id(label),id('lock'),a.R1,a.R2,root.tokenId,lock.tokenId,inputs.deploymentEpoch])) };
    const proof = proofs[name];
    let runtime = proof.runtimeTemplate;
    for (const field of proof.immutableReferences) {
      const value = values[field.name];
      need(value !== undefined, 'Unknown runtime immutable');
      const word = zeroPadValue(typeof value === 'string' && value.startsWith('0x') ? value : toBeHex(value),32).slice(2).toLowerCase();
      for (const { start, length } of field.slots) {
        need(length === 32, 'Unsupported immutable width');
        runtime = runtime.slice(0,start*2) + word + runtime.slice((start+length)*2);
      }
    }
    receipt = staticResult([], [code(name,keccak256('0x'+runtime)),expect(name,'rootLabel',[],[label])],
      undefined,{ address: a[name] });
  }
  if (stage === 13) {
    await requireValue('R2','roleCount',[0],[rootGrant]);
    await requireCheck(roles('R2',0,a.CredentialRegistrar,0));
    receipt = staticResult([event('R2','EACRolesChanged',[0,a.CredentialRegistrar,0,registrarGrant])],
      [roles('R2',0,a.CredentialRegistrar,registrarGrant),expect('R2','roleCount',[0],[rootGrant+registrarGrant])]);
  }
  if (stage === 15) {
    await empty('Mira');
    await requireValue('R2','isEmancipated',[],[false]);
    for (const account of [inputs.mira,a.DoorKeys]) await requireCheck(roles('R2',0,account,0));
    const expiry = now + BigInt(inputs.expiry.guestDurationSeconds);
    minimumRemaining = BigInt(inputs.expiry.guestMinimumRemainingSeconds);
    need(expiry <= BigInt(lock.expiry) && expiry < 2n ** 64n && expiry - now >= minimumRemaining, 'Guest expiry outside approved bounds');
    args[2] = expiry;
    receipt = await registration('R2','mira',inputs.mira,a.CredentialRegistrar,0n,() => expiry,
      b => [event('CredentialRegistrar','CredentialIssued',[id('mira'),b.tokenId,inputs.mira,expiry])]);
  }
  need(receipt && args.every(value => value != null), 'Unresolved packet bindings');
  return { args, tokenReview, checks, receipt, minimumRemaining, revealDeadline };

  async function registration(name, text, account, sender, bitmap, expiryAt, trailing = () => [], leading = [], extra = []) {
    await requireCheck(code('LabelStore',runtimeHashes.LabelStore));
    const before = await state(name,text);
    need(before.status === 0n && before.expiry === 0n && same(before.latestOwner,zero), 'Registration requires pristine available state');
    const absent = (await read('LabelStore','getLabel',[id(text)]))[0] === '';
    return async h => {
      const expiry = expiryAt(h);
      if (minimumRemaining) need(expiry - BigInt(h.timestamp) >= minimumRemaining, 'Mined guest margin too short');
      // For an expired entry the reviewed registry reports eacVersionId + 1.
      // Registration of a pristine entry activates it without a version bump.
      const b = { tokenId: before.tokenId.toString(), resource: (before.resource - 1n).toString(), owner: account, expiry: expiry.toString() };
      const logs = [...leading];
      if (absent) logs.push(event('LabelStore','Label',[id(text),text]));
      logs.push(event(name,'LabelRegistered',[b.tokenId,id(text),text,account,expiry,sender]),
        event(name,'TransferSingle',[sender,zero,account,b.tokenId,1]),event(name,'TokenResource',[b.tokenId,b.resource]));
      if (bitmap) logs.push(event(name,'EACRolesChanged',[b.resource,account,0,bitmap]));
      const current = [...registered(name,text,b),roles(name,b.resource,account,bitmap)];
      if (!bitmap) current.push(expect(name,'roleCount',[b.resource],[0]));
      return { events: [...logs,...trailing(b)], post: [...current,...extra], current, bindings: b };
    };
  }
}
