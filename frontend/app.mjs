import { ConnectionOnlyMetaMask } from '/connection.mjs';
import { LABEL, doorInterface, registrarInterface } from '/protocol.mjs';

const view = location.pathname === '/guest' ? 'guest' : location.pathname === '/door' ? 'door' : 'owner';
const content = document.querySelector('#content');
const announcement = document.querySelector('#announcement');
let state, account, connector, busy = false, feedback = '', tone = '', offline = false;
let request = 0;
let doorOpen = false;

const escape = value => String(value ?? '—').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const short = value => value ? `${value.slice(0, 8)}…${value.slice(-5)}` : '—';
const date = value => value ? new Date(value).toLocaleString() : '—';
const demo = () => state.mode === 'demo';
const disabled = condition => condition ? 'disabled' : '';
const lockIcon = open => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
  <rect x="11" y="22" width="26" height="19" rx="5"/>
  ${open ? '<path d="M16 22V14a8 8 0 0 1 16 0"/>' : '<path d="M16 22V14a8 8 0 0 1 16 0v8"/>'}
  <path d="M24 30v4"/></svg>`;

function wallet() {
  return `<div class="wallet">
    <div><span class="eyebrow">WALLET</span><strong title="${escape(account)}">${account ? escape(short(account)) : 'Disconnected'}</strong></div>
    <button class="secondary" data-action="connect" ${disabled(busy || offline || !!account)}>
      ${account ? 'Connected' : demo() ? `Connect demo ${view === 'owner' ? 'owner' : 'Mira'}` : 'Connect wallet'}
    </button>
  </div>`;
}

function credential() {
  return `<div class="spread"><span>Credential</span><strong class="${state.status === 'Active' ? 'accent' : ''}">${escape(state.status)}</strong></div>
    <div class="spread"><span>Expiration</span><time>${escape(date(state.expiry))}</time></div>
    ${state.status === 'Active' ? '<div class="spread"><span>Time remaining</span><strong data-countdown>—</strong></div>' : ''}`;
}

const names = { unlock: 'DoorUnlocked', denied: 'Denied attempt', issued: 'Credential issued', revoked: 'Credential revoked' };
function activity() {
  return state.activity.length ? `<ul class="activity">${state.activity.map(event =>
    `<li><span class="dot ${event.kind === 'denied' ? 'warn' : ''}"></span><div><strong>${names[event.kind]}</strong>
     <small>${demo() ? (event.kind === 'denied' ? 'Demo decision' : 'Synthetic activity') : 'Sepolia log'}${event.guest ? ' · ' + escape(short(event.guest)) : ''}</small></div>
     <time>${escape(date(event.at))}</time></li>`).join('')}</ul>` : '<p class="muted">No recent activity.</p>';
}

function qrCard() {
  return `<section class="panel qr-panel" id="qr-card"><div class="eyebrow">${demo() ? 'DEMO SCAN CARD' : 'STATIC DOOR QR'}</div>
    <h2>Entry door</h2>
    <img src="/qr.svg" width="170" height="170" alt="${demo() ? 'Demo' : 'Entry door'} guest route QR code">
    <p class="muted">Scan to open the guest page, then connect your wallet.</p>
    <a href="${escape(state.guestPath)}">Open guest page ↗</a>
    ${demo() ? '<p class="muted">Demo QR · final static QR awaits verified Sepolia deployment.</p>' :
      `<p class="mono">${escape(state.contract)}</p><button class="secondary" data-action="print">Print QR card</button>`}
    </section>`;
}

function ownerView() {
  return `<section class="hero">
    <div class="eyebrow">ACCESS CONTROL / OWNER</div><h1>Door overview</h1>
    <p class="muted">Manage access to the entry door through ENSv2 credentials.</p>
    ${wallet()}
  </section>
  <div class="grid">
    <section class="panel"><div class="eyebrow">ENTRY DOOR</div>
      <div class="door-summary"><span class="glyph" data-lock-icon>${lockIcon(doorOpen)}</span>
      <div><h2 data-door-status>${doorOpen ? 'Unlocked' : 'Locked'}</h2><small>Door display status</small></div></div>
      <div class="spread"><span>Network</span><strong>${demo() ? 'Isolated synthetic' : 'Sepolia · 11155111'}</strong></div>
      <div class="spread"><span>DoorKeys</span><code title="${escape(state.contract)}">${state.contract ? escape(short(state.contract)) : 'Awaiting T14'}</code></div>
      <div class="spread"><span>CredentialRegistrar</span><code title="${escape(state.registrar)}">${state.registrar ? escape(short(state.registrar)) : 'Undeployed'}</code></div>
      ${state.r1 ? `<div class="spread"><span>R1 / R2</span><code title="${escape(state.r1 + ' / ' + state.r2)}">${escape(short(state.r1) + ' / ' + short(state.r2))}</code></div>` : ''}
    </section>
    <section class="panel"><div class="eyebrow">ENSv2 / DELEGATION</div><h2>Mira’s access</h2>
      <ol class="hierarchy"><li><small>ROOT</small><code>${escape(state.root)}.eth</code></li>
      <li><small>LOCK</small><code>lock.${escape(state.root)}.eth</code></li>
      <li><small>GUEST</small><code>mira.lock.${escape(state.root)}.eth</code></li></ol>
      ${credential()}
      <div class="actions">
        <button data-action="issue" ${disabled(!demo() || !account || busy || offline || state.status !== 'Unissued')}>Issue 5-minute credential</button>
        <button class="secondary" data-action="revoke" ${disabled(!demo() || !account || busy || offline || state.status !== 'Active')}>Revoke</button>
      </div>
      ${demo() ? '' : '<p class="muted">Sepolia read-only · wallet writes disabled.</p>'}
      ${feedbackMarkup()}
    </section>
    <section class="panel"><div class="eyebrow">EVENT FEED</div><h2>Recent activity</h2>${activity()}
      ${demo() ? `<button class="secondary" data-action="reset" ${disabled(!account || busy || offline)}>Reset demo</button>` : ''}
    </section>
    ${qrCard()}
  </div>`;
}

function feedbackMarkup() {
  return feedback ? `<p class="feedback ${tone}">${escape(feedback)}</p>` : '';
}

function guestView() {
  return `<section class="panel guest">
    <div class="eyebrow">GUEST ACCESS / MIRA</div>
    <div class="glyph" data-lock-icon>${lockIcon(doorOpen)}</div>
    <h1>Entry door</h1><p class="mono muted">mira.lock.${escape(state.root)}.eth</p>
    <p class="guest-state" data-door-status>${doorOpen ? 'Unlocked' : 'Locked'}</p>
    ${wallet()}
    ${credential()}
    <div class="spread"><span>Wallet access</span><strong>${escape(account ?
      state.eligibility ?? 'Checking…' : 'Connect to check')}</strong></div>
    <button class="unlock" data-action="unlock" ${disabled(!account || busy || offline || !demo())}>${busy && tone === 'pending' ? 'Unlocking…' : 'Unlock'}</button>
    ${demo() ? '' : '<p class="muted">Live unlock transactions are disabled. Wallet eligibility is checked against DoorKeys.</p>'}
    ${feedbackMarkup()}
  </section>`;
}

function kiosk() {
  const latest = state.latest;
  const denial = demo() && state.activity[0]?.kind === 'denied' ? state.activity[0] : null;
  return `<section class="kiosk ${doorOpen ? 'open' : ''}" id="kiosk">
    <div class="eyebrow">ENTRY DOOR / ACCESS DISPLAY</div>
    <div class="glyph" data-lock-icon>${lockIcon(doorOpen)}</div>
    <h1 data-door-status>${doorOpen ? 'UNLOCKED' : 'LOCKED'}</h1>
    <p class="muted">${demo() ? 'Isolated demonstration' : 'Sepolia event display'}</p>
    <div class="panel event">
      <div class="eyebrow">LATEST AUTHORIZED UNLOCK</div>
      ${latest ? `<h2>${demo() ? 'Synthetic' : 'Sepolia'} DoorUnlocked</h2>
        <code title="${escape(latest.guest)}">${escape(short(latest.guest))}</code> · Request #${escape(latest.nonce)}
        <p class="muted">${escape(date(latest.at))}</p>
        ${latest.hash ? `<code class="mono">${escape(latest.hash)}</code>` : ''}` : '<p class="muted">Waiting for DoorUnlocked…</p>'}
      ${denial ? `<p class="feedback bad">Demo access denied · ${escape(date(denial.at))}</p>` : ''}
    </div>
  </section>`;
}

function tick() {
  if (!state) return;
  const latest = state.latest;
  doorOpen = !offline && !!latest && Date.now() < latest.at + state.holdMs;
  const kioskEl = document.querySelector('#kiosk');
  kioskEl?.classList.toggle('open', doorOpen);
  const status = document.querySelector('[data-door-status]');
  const text = doorOpen ? 'Unlocked' : 'Locked';
  if (status && status.textContent !== (view === 'door' ? text.toUpperCase() : text)) {
    status.textContent = view === 'door' ? text.toUpperCase() : text;
    document.querySelector('[data-lock-icon]').innerHTML = lockIcon(doorOpen);
  }
  const countdown = document.querySelector('[data-countdown]');
  if (countdown) {
    const seconds = Math.max(0, Math.ceil((state.expiry - Date.now()) / 1000));
    countdown.textContent = `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  }
}

function render() {
  if (!state) {
    content.innerHTML = '<p class="feedback bad">Door data is unavailable. Retrying…</p>';
    return;
  }
  const focused = document.activeElement?.dataset.action;
  const badge = document.querySelector('#mode');
  badge.textContent = demo() ? 'DEMO MODE' : 'SEPOLIA · READ ONLY';
  badge.classList.toggle('demo', demo());
  const guestLink = document.querySelector('#guest-link');
  guestLink.href = state.guestPath;
  guestLink.hidden = false;
  document.querySelector('#' + view + '-link').setAttribute('aria-current', 'page');
  document.body.dataset.view = view;
  content.setAttribute('aria-busy', 'false');
  content.innerHTML = (offline ? '<p class="feedback bad">Connection lost. Showing last known data.</p>' : '') +
    (view === 'owner' ? ownerView() : view === 'guest' ? guestView() : kiosk());
  if (focused) content.querySelector(`[data-action="${focused}"]`)?.focus({ preventScroll: true });
  tick();
}

async function refresh() {
  const serial = ++request;
  try {
    const query = view === 'guest' && account ? '?account=' + encodeURIComponent(account) : '';
    const response = await fetch('/api/state' + query);
    if (!response.ok) throw new Error('Could not read door state.');
    const next = await response.json();
    if (serial !== request) return;
    const changed = offline || JSON.stringify(state) !== JSON.stringify(next);
    offline = false;
    state = next;
    if (changed) render();
  } catch {
    if (serial !== request) return;
    if (!offline) { offline = true; render(); }
  }
}

function report(message, style) {
  feedback = message;
  tone = style;
  announcement.textContent = message;
  render();
}

async function connect(event) {
  const expected = view === 'owner' ? state.owner : state.guest;
  if (demo()) {
    account = expected;
    return report('Demo wallet connected.', 'good');
  }
  if (!window.ethereum) return report('Open this page in a browser with an injected wallet.', 'bad');
  connector?.close();
  connector = new ConnectionOnlyMetaMask(window.ethereum, expected, result => {
    if (result.status === 'INVALIDATED') {
      account = undefined;
      report('Wallet or network changed. Reconnect to continue.', 'bad');
      void refresh();
    }
  });
  const result = await connector.connectFromClick(event);
  if (result.status === 'VERIFIED') {
    account = result.selectedAccount;
    report('Wallet connected on Sepolia.', 'good');
  } else {
    const messages = { WRONG_ACCOUNT: 'Select the configured wallet.', WRONG_NETWORK: 'Switch the wallet to Sepolia.', REJECTED: 'Connection declined.' };
    report(messages[result.status] ?? 'Wallet connection could not be verified.', 'bad');
  }
}

async function simulate(action) {
  let target = 'registrar';
  let data;
  if (action === 'issue') data = registrarInterface.encodeFunctionData('issue', [LABEL, state.guest, Math.floor(Date.now() / 1000) + 300]);
  if (action === 'revoke') data = registrarInterface.encodeFunctionData('revoke', [LABEL, state.token]);
  if (action === 'unlock') {
    target = 'door';
    data = doorInterface.encodeFunctionData('unlock', [LABEL]);
  }
  report(action === 'unlock' ? 'Unlock request pending…' : 'Demo action pending…', 'pending');
  const response = await fetch(action === 'reset' ? '/api/reset' : '/api/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, target, data }),
  });
  const result = await response.json();
  report(result.message ?? result.error, response.ok ? 'good' : 'bad');
}

content.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled || busy) return;
  const { action } = button.dataset;
  if (action === 'print') return window.print();
  busy = true;
  if (action === 'connect') report('Connecting wallet…', 'pending');
  try {
    if (action === 'connect') await connect(event);
    else if (demo() && account) await simulate(action);
  } catch {
    report('Request failed. Check the door state before trying again.', 'bad');
  } finally {
    await refresh();
    busy = false;
    render();
  }
});

let polling = false;
async function poll() {
  if (polling || busy) return;
  polling = true;
  try { await refresh(); } finally { polling = false; }
}
void poll();
setInterval(poll, 1200);
setInterval(tick, 250);
