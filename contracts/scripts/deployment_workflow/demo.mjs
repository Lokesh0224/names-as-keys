import { digest } from './workflow.mjs';
import { fixture } from './test/fixture.mjs';
const element = id => document.getElementById(id);
const show = (id, value) => { element(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
let demo, lastReview;
function reset() { demo?.workflow.close(); demo = fixture(); lastReview = null; show('demo', 'Test-only provider idle.'); show('journal', 'No persisted test requests.'); for (const id of ['ack','submit','receipt']) element(id).disabled = true; }
async function action(fn) { try { await fn(); } catch { show('demo', 'Blocked or rejected. No live wallet request was made. Re-prepare/reconcile the test-only packet.'); } show('journal', demo.persisted() ?? {}); }
element('prepare').onclick = () => action(async () => { lastReview = await demo.workflow.prepare('T01', demo.packets[0]); show('demo', lastReview); element('ack').disabled = false; });
element('ack').onclick = () => action(async () => { demo.workflow.acknowledge('T01', digest(lastReview)); element('submit').disabled = false; element('ack').disabled = true; });
element('submit').onclick = () => action(async () => { element('submit').disabled = true; await demo.workflow.submitTestOnly('T01'); element('receipt').disabled = false; });
element('receipt').onclick = () => action(async () => { demo.provider.mine(demo.packets[0]); await demo.workflow.reconcile('T01'); show('demo', demo.workflow.state('T01')); element('receipt').disabled = true; });
element('reset').onclick = reset;

reset();
