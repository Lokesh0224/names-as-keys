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
  show('steps', plan.transactions.map(step => step.id + ' · ' + step.label).join('\n'));
  if (!window.ethereum?.isMetaMask) {
    show('status', 'MetaMask provider unavailable.');
    return;
  }
  let displayed;
  function dashboard() {
    const journal = candidate.journal();
    const ready = plan.transactions.find(step => step.conditionallyIncluded && journal.entries[step.id]?.status !== 'CONFIRMED');
    show('steps', plan.transactions.map(step => {
      const entry = journal.entries[step.id];
      return [step.id, step.label, !step.conditionallyIncluded ? 'EXCLUDED' : entry?.status ??
        (step === ready ? 'READY FOR CHECKS' : 'BLOCKED'), step === ready ? '← next' : '',
        entry?.bindings?.address ?? ''].filter(Boolean).join(' · ');
    }).join('\n'));
    show('journal', journal);
  }
  function confirmationLabel() {
    if (!displayed) return;
    element('t01-validate').textContent = (candidate.canSubmit(displayed) ? 'Request ' + displayed.step + ' in MetaMask' :
      'Revalidate ' + displayed.step + ' confirmation');
  }
  function resetConfirmation() {
    element('t01-confirmation').hidden = true;
    element('t01-confirmed').checked = false;
    element('t01-validate').disabled = true;
  }
  const candidate = new CandidateReview({ provider: window.ethereum, bundle, storage: localStorage, privateEstimate: privateEstimator(window.location), update: kind => {
    if (kind === 'REQUESTING') {
      show('status', 'Waiting for the owner to respond in MetaMask…');
      dashboard();
      return;
    }
    displayed = undefined;
    resetConfirmation();
    show('review', 'Wallet context changed. Prepare a new review.');
    dashboard();
  } });
  function selected() {
    displayed = undefined;
    resetConfirmation();
    const step = plan.transactions.find(s => s.id === element('step').value);
    element('hash').value = candidate.journal().entries[step.id]?.receiptHash ?? '';
    show('review', { step: step.id, reviewedArguments: step.arguments, deferred: step.remainingBindings,
      prerequisiteReceipts: plan.transactions.slice(0, plan.transactions.indexOf(step))
        .filter(prior => prior.conditionallyIncluded).map(prior => prior.id), execution: 'DISABLED' });
  }
  async function action(fn) {
    element('step').disabled = true;
    element('prepare').disabled = true;
    element('receipt').disabled = true;
    element('t01-validate').disabled = true;
    try { await fn(); }
    catch (error) {
      // Provider errors can include raw input. Candidate errors are reported only as a generic block.
      show('status', error instanceof Error && !('code' in error) && !/0x[\da-f]{64}/i.test(error.message)
        ? error.message : 'Review blocked by provider or prerequisite checks.');
    } finally {
      element('step').disabled = false;
      element('prepare').disabled = false;
      element('receipt').disabled = false;
      element('t01-validate').disabled = !displayed || !element('t01-confirmed').checked;
      const current = candidate.journal().entries[displayed?.step];
      if (current && current.status !== 'PREPARED') {
        element('hash').value = current.receiptHash ?? '';
        displayed = undefined;
        resetConfirmation();
      } else confirmationLabel();
      dashboard();
    }
  }
  element('step').onchange = selected;
  element('prepare').onclick = () => action(async () => {
    displayed = undefined;
    resetConfirmation();
    const step = element('step').value;
    show('review', 'Checking current prerequisites…');
    const review = await candidate.prepare(step);
    if (step === element('step').value) {
      displayed = review;
      show('review', displayed);
      element('t01-confirmation').hidden = false;
      await candidate.refreshAuthorization();
      confirmationLabel();
      show('status', step === 'T04' ? 'T04 unsigned review only. Wallet execution is blocked pending reveal privacy verification.' :
        candidate.canSubmit(displayed) ? 'Exact ' + step + ' authorization matched. Confirm the envelope before requesting MetaMask.' :
        'Unsigned review prepared. Execution disabled.');
    }
  });
  element('t01-confirmed').onchange = () => {
    element('t01-validate').disabled = !displayed || !element('t01-confirmed').checked;
  };
  element('t01-validate').onclick = event => action(async () => {
    const confirmation = element('t01-confirmed').checked;
    element('t01-confirmed').checked = false;
    const review = displayed;
    if (candidate.canSubmit(review)) {
      const hash = await candidate.submitStep(review, confirmation, event);
      element('hash').value = hash;
      displayed = undefined;
      resetConfirmation();
      show('status', review.step + ' pending. Verify the returned hash in Receipt review.');
      return;
    }
    const result = await candidate.validateConfirmation(review, confirmation);
    await candidate.refreshAuthorization();
    confirmationLabel();
    if (displayed === review) {
      show('status', review.step === 'T04' ? 'T04 confirmation revalidated. Wallet execution remains blocked.' :
        candidate.canSubmit(review)
        ? 'Exact authorization matched. Confirm again to request this step in MetaMask.'
        : review.step + ' confirmation revalidated. Separate execution authorization required. Execution disabled.');
      show('review', { ...review, confirmation: result });
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
  dashboard();
  selected();
  element('prepare').disabled = false;
  element('receipt').disabled = false;
}

load().catch(() => show('status', 'Candidate load blocked. Execution disabled.'));
