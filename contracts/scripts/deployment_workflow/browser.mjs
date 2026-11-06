import { Interface, formatUnits } from 'ethers';
import { ReadOnlyWallet, digest } from './workflow.mjs';
import { fixture } from './test/fixture.mjs';
const element = id => document.getElementById(id);
const show = (id, value) => { element(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
let data, abis, demo, lastReview;
function render() {
  const step = data.transactions.find(s => s.id === element('step').value);
  const iface = new Interface(abis[step.abi]);
  const fragment = step.signature.startsWith('constructor(') ? iface.deploy : iface.getFunction(step.signature);
  const candidate = step.snapshotCandidate;
  const decoded = candidate ? iface.parseTransaction({ data: candidate.transaction.data }).args.toArray().map(x => typeof x === 'bigint' ? x.toString() : x) : null;
  show('review', { argumentTypes: fragment.inputs.map(x => x.format('sighash')), snapshotDecodedArguments: decoded, id: step.id, selectedAccount: data.owner, chainId: data.chainId, destination: step.target ?? '[CREATE address unresolved]',
    signature: step.signature, decodedArgumentBindings: step.arguments, inputStatus: 'UNRESOLVED / NOT_APPROVED',
    tokenAmountAndAllowance: candidate ? { token: 'MockUSDC', units: String(candidate.arguments[1]), amount: formatUnits(candidate.arguments[1],6), allowanceSnapshotUnits: '0', snapshotBlock: data.observationBlock, recipientOrSpender: candidate.arguments[0], classification: 'SNAPSHOT_ONLY_NOT_AN_APPROVED_SPEND' } : 'See exact step preconditions; unresolved future bindings',
    ethValueWei: '0', gasLimit: null, maxFeePerGasWei: null, maxPriorityFeePerGasWei: null,
    proposedLimits: { fees: data.workflowProposals.fees, spending: data.workflowProposals.spending, confirmations: data.workflowProposals.confirmations }, missingInputs: step.remainingBindings, expectedEvents: step.expectedEvents, execution: 'DISABLED' });
}
function reset() { demo?.workflow.close(); demo = fixture(); lastReview = null; show('demo', 'Test-only provider idle.'); show('journal', 'No persisted test requests.'); for (const id of ['ack','submit','receipt']) element(id).disabled = true; }
async function action(fn) { try { await fn(); } catch { show('demo', 'Blocked or rejected. No live wallet request was made. Re-prepare/reconcile the test-only packet.'); } show('journal', demo.persisted() ?? {}); }
element('prepare').onclick = () => action(async () => { lastReview = await demo.workflow.prepare('T01', demo.packets[0]); show('demo', lastReview); element('ack').disabled = false; });
element('ack').onclick = () => action(async () => { demo.workflow.acknowledge('T01', digest(lastReview)); element('submit').disabled = false; element('ack').disabled = true; });
element('submit').onclick = () => action(async () => { element('submit').disabled = true; await demo.workflow.submitTestOnly('T01'); element('receipt').disabled = false; });
element('receipt').onclick = () => action(async () => { demo.provider.mine(demo.packets[0]); await demo.workflow.reconcile('T01'); show('demo', demo.workflow.state('T01')); element('receipt').disabled = true; });
element('reset').onclick = reset;
element('inspect').onclick = async () => {
  try {
    if (!window.ethereum) { show('wallet', 'No EIP-1193 provider available. No connection request made.'); return; }
    const adapter = new ReadOnlyWallet(window.ethereum);
    const chain = await adapter.request({ method: 'eth_chainId' });
    const accounts = await adapter.request({ method: 'eth_accounts' });
    show('wallet', { selectedAccount: accounts[0] ?? 'No previously exposed account', chainId: String(BigInt(chain)), matchesSelectedOwner: accounts[0]?.toLowerCase() === data.owner.toLowerCase(), matchesSepolia: BigInt(chain) === 11155111n, execution: 'DISABLED' });
    for (const event of ['chainChanged','accountsChanged','disconnect']) adapter.on(event, () => show('wallet', 'Wallet context changed; previous identity observation invalid. Inspect again. Execution remains disabled.'));
  } catch { show('wallet', 'Read-only identity inspection failed; execution remains disabled.'); }
};
async function load() {
  data = await (await fetch('./review-plan.json')).json();
  abis = await (await fetch('./verified-abis.json')).json();
  const gates = await (await fetch('./gate-status.json')).json();
  show('identity', { owner: data.owner, mira: data.mira, chainId: data.chainId, checkpoint: data.approvedCheckpoint, stage: 'NO_GO', signingControl: 'NOT_VERIFIED', observationBlock: data.observationBlock });
  for (const gate of gates.gates) { const line = document.createElement('div'); line.className = 'gate'; line.textContent = `${gate.id} · ${gate.status} · ${gate.gate}`; element('gates').append(line); }
  for (const step of data.transactions) { const option = document.createElement('option'); option.value = step.id; option.textContent = `${step.id} — ${step.label}`; element('step').append(option); }
  element('step').onchange = render; render(); reset();
}
load().catch(() => show('identity', 'Plan load failed; execution disabled.'));
