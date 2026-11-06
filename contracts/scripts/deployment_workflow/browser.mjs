import { CandidateReview } from './candidate.mjs';
import { privateEstimator } from './private_transport.mjs';

const element = id => document.getElementById(id);
const show = (id, value) => {
  element(id).textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

// Read native event fields so a direct handler call cannot supply its own values.
const eventPrototype = Event.prototype;
const eventType = Object.getOwnPropertyDescriptor(eventPrototype, 'type').get;
const eventCurrentTarget = Object.getOwnPropertyDescriptor(eventPrototype, 'currentTarget').get;
const eventIsTrusted = (Object.getOwnPropertyDescriptor(new Event('click'), 'isTrusted') ??
  Object.getOwnPropertyDescriptor(eventPrototype, 'isTrusted')).get;

function isConfirmationClick(event, button) {
  try {
    return eventType.call(event) === 'click' && eventCurrentTarget.call(event) === button &&
      eventIsTrusted.call(event) === true;
  } catch {
    return false;
  }
}

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
  function resetConfirmation() {
    element('t01-confirmation').hidden = true;
    element('t01-confirmed').checked = false;
    element('t01-validate').disabled = true;
  }
  const candidate = new CandidateReview({ provider: window.ethereum, bundle, storage: localStorage, privateEstimate: privateEstimator(window.location), update: () => {
    displayed = undefined;
    resetConfirmation();
    show('review', 'Wallet context changed. Prepare a new review.');
    show('journal', candidate.journal());
  } });
  function selected() {
    displayed = undefined;
    resetConfirmation();
    const step = plan.transactions.find(s => s.id === element('step').value);
    show('review', { step: step.id, reviewedArguments: step.arguments, deferred: step.remainingBindings, execution: 'DISABLED' });
  }
  async function action(fn) {
    element('prepare').disabled = true;
    element('receipt').disabled = true;
    element('t01-validate').disabled = true;
    try { await fn(); }
    catch (error) {
      // Provider errors can include raw input. Candidate errors are reported only as a generic block.
      show('status', error instanceof Error && !('code' in error) && !/0x[\da-f]{64}/i.test(error.message)
        ? error.message : 'Review blocked by provider or prerequisite checks.');
    } finally {
      element('prepare').disabled = false;
      element('receipt').disabled = false;
      element('t01-validate').disabled = displayed?.step !== 'T01' || !element('t01-confirmed').checked;
      show('journal', candidate.journal());
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
      element('t01-confirmation').hidden = step !== 'T01';
      const canSubmit = candidate.canSubmitT01(review);
      element('t01-validate').textContent = canSubmit ? 'Request T01 in MetaMask' : 'Revalidate T01 confirmation';
      show('status', canSubmit ? 'Exact T01 authorization matched. Confirm the envelope before requesting MetaMask.' :
        'Unsigned review prepared. Execution disabled.');
    }
  });
  element('t01-confirmed').onchange = () => {
    element('t01-validate').disabled = displayed?.step !== 'T01' || !element('t01-confirmed').checked;
  };
  element('t01-validate').onclick = event => action(async () => {
    const confirmation = element('t01-confirmed').checked;
    element('t01-confirmed').checked = false;
    const review = displayed;
    if (candidate.canSubmitT01(review)) {
      if (!isConfirmationClick(event, element('t01-validate'))) throw new Error('Use the T01 confirmation button directly');
      const hash = await candidate.submitT01(review, confirmation);
      element('hash').value = hash;
      displayed = undefined;
      resetConfirmation();
      show('status', 'T01 pending. Verify the returned hash in Receipt review.');
      return;
    }
    const result = await candidate.validateT01Confirmation(review, confirmation);
    if (displayed === review) {
      show('status', 'T01 confirmation revalidated. Separate execution authorization required. Execution disabled.');
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
  show('journal', candidate.journal());
  selected();
  element('prepare').disabled = false;
  element('receipt').disabled = false;
}

load().catch(() => show('status', 'Candidate load blocked. Execution disabled.'));
