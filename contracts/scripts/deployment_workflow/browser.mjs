import { CandidateReview } from './candidate.mjs';
import { privateEstimator } from './private_transport.mjs';

const element = id => document.getElementById(id);
const show = (id, value) => {
  element(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

async function load() {
  const response = await fetch('./candidate-bundle.json');
  if (!response.ok) throw new Error('Candidate bundle unavailable');
  const bundle = await response.json();
  const { plan } = bundle;
  show('identity', { owner: plan.owner, mira: plan.mira, chainId: plan.chainId, execution: 'DISABLED',
    snapshot: plan.snapshot, stage: 'NO_GO' });
  for (const step of plan.transactions) {
    const option = document.createElement('option');
    option.value = step.id;
    option.textContent = step.id + ' — ' + step.label + (step.conditionallyIncluded ? '' : ' (excluded)');
    element('step').append(option);
  }
  if (!window.ethereum?.isMetaMask) {
    show('status', 'MetaMask provider unavailable.');
    return;
  }
  let displayed;
  const candidate = new CandidateReview({ provider: window.ethereum, bundle, storage: localStorage, privateEstimate: privateEstimator(window.location), update: () => {
    displayed = undefined;
    show('review', 'Wallet context changed. Prepare a new review.');
    show('journal', candidate.journal());
  } });
  function selected() {
    displayed = undefined;
    const step = plan.transactions.find(s => s.id === element('step').value);
    show('review', { step: step.id, reviewedArguments: step.arguments, deferred: step.remainingBindings, execution: 'DISABLED' });
  }
  async function action(fn) {
    element('prepare').disabled = true;
    element('receipt').disabled = true;
    try { await fn(); }
    catch (error) {
      // Provider errors can include raw input. Candidate errors are reported only as a generic block.
      show('status', error instanceof Error && !('code' in error) && !/0x[\da-f]{64}/i.test(error.message)
        ? error.message : 'Review blocked by provider or prerequisite checks.');
    } finally {
      element('prepare').disabled = false;
      element('receipt').disabled = false;
      show('journal', candidate.journal());
    }
  }
  element('step').onchange = selected;
  element('prepare').onclick = () => action(async () => {
    displayed = undefined;
    const step = element('step').value;
    show('review', 'Checking current prerequisites…');
    const review = await candidate.prepare(step);
    if (step === element('step').value) {
      displayed = review;
      show('review', displayed);
      show('status', 'Unsigned review prepared. Execution disabled.');
    }
  });
  element('receipt').onclick = () => action(async () => {
    const step = element('step').value;
    const hash = element('hash').value.trim() || candidate.journal().entries[step]?.receiptHash;
    await candidate.reconcile(step, hash);
    show('status', 'Receipt and current state verified.');
  });
  window.addEventListener('pagehide', () => candidate.close(), { once: true });
  show('status', 'Uses existing account access only. Select the approved owner and Sepolia in MetaMask.');
  show('journal', candidate.journal());
  selected();
  element('prepare').disabled = false;
  element('receipt').disabled = false;
}

load().catch(() => show('status', 'Candidate load blocked. Execution disabled.'));
