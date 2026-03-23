'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

function $(id)         { return document.getElementById(id); }
function show(id)      { $(id).classList.remove('hidden'); }
function hide(id)      { $(id).classList.add('hidden'); }
function setHtml(id,h) { $(id).innerHTML = h; }

// Track which provider card is awaiting a picker result.
let pendingPickerCardId = null;

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await renderAccount();
  await renderProviders();

  $('login-btn').addEventListener('click', doLogin);
  $('password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('logout-btn').addEventListener('click', doLogout);
  $('add-provider-btn').addEventListener('click', addProvider);
  $('save-btn').addEventListener('click', saveProviders);

  // Listen for picker results written by background.js into session storage.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes.pickerResult) return;
    const { selector } = changes.pickerResult.newValue;
    if (pendingPickerCardId !== null) {
      const card = document.querySelector(
        `.provider-card[data-id="${pendingPickerCardId}"]`
      );
      if (card) card.querySelector('.selector-input').value = selector;
      pendingPickerCardId = null;
      markDirty();
    }
  });
});

// ── Account section ───────────────────────────────────────────────────────────

async function renderAccount() {
  const { server, username, token } = await chrome.storage.sync.get([
    'server', 'username', 'token',
  ]);

  if (server) $('server').value = server;
  if (username) $('username').value = username;

  if (token) {
    setHtml('auth-status', `<span class="status-ok">✓ Logged in as ${username || '?'}</span>`);
    hide('login-form');
    show('logout-row');
  } else {
    setHtml('auth-status',
      '<span class="status-err">Not authenticated — enter credentials below</span>');
    show('login-form');
    hide('logout-row');
  }
}

async function doLogin() {
  const server   = $('server').value.trim().replace(/\/$/, '');
  const username = $('username').value.trim();
  const password = $('password').value;

  hide('login-error');

  if (!server)   return showLoginError('Server URL is required.');
  if (!username) return showLoginError('Username is required.');
  if (!password) return showLoginError('Password is required.');

  $('login-btn').disabled = true;
  $('login-btn').textContent = 'Logging in…';

  const resp = await chrome.runtime.sendMessage({ type: 'LOGIN', server, username, password });

  $('login-btn').disabled = false;
  $('login-btn').textContent = 'Log in';

  if (resp.error) {
    showLoginError(resp.error);
    return;
  }

  $('password').value = '';
  await renderAccount();
}

function showLoginError(msg) {
  const el = $('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function doLogout() {
  $('logout-btn').disabled = true;
  await chrome.runtime.sendMessage({ type: 'LOGOUT' });
  $('logout-btn').disabled = false;
  await renderAccount();
}

// ── Providers section ─────────────────────────────────────────────────────────

// In-memory working copy; saved to storage only on "Save changes".
let providers = [];

async function renderProviders() {
  const { providers: stored = [] } = await chrome.storage.sync.get('providers');
  providers = stored.map(p => ({ ...p }));
  rebuildProviderList();
}

function rebuildProviderList() {
  const list = $('provider-list');
  list.innerHTML = '';
  providers.forEach((p, i) => list.appendChild(buildCard(p, i)));
  // Hide save bar until there are unsaved changes.
  hide('save-bar');
  $('save-status').textContent = '';
}

function buildCard(provider, index) {
  const card = document.createElement('div');
  card.className    = 'provider-card';
  card.dataset.id   = index;
  card.dataset.index = index;

  card.innerHTML = `
    <div class="provider-header">
      <span class="provider-tag-label">${escHtml(provider.tag || 'new provider')}</span>
      <button class="btn-small btn-danger remove-btn">Remove</button>
    </div>

    <div class="field">
      <label>Tag</label>
      <input class="tag-input" type="text"
             value="${escHtml(provider.tag || '')}"
             placeholder="e.g. github"
             spellcheck="false" autocomplete="off">
      <p class="hint">Must match the provider tag configured in the noncey admin UI.</p>
    </div>

    <div class="field">
      <label>URL pattern</label>
      <input class="url-input" type="text"
             value="${escHtml(provider.url_pattern || '')}"
             placeholder="e.g. github.com"
             spellcheck="false" autocomplete="off">
      <p class="hint">
        The extension activates on any URL containing this string.
        Use a more specific path (e.g. <code>github.com/sessions/two-factor</code>)
        to limit matching.
      </p>
    </div>

    <div class="field">
      <label>OTP field selector</label>
      <div class="selector-row">
        <input class="selector-input" type="text"
               value="${escHtml(provider.selector || '')}"
               placeholder="e.g. #otp-input"
               spellcheck="false" autocomplete="off">
        <button class="btn-small pick-btn">Pick</button>
      </div>
      <p class="hint">
        CSS selector for the OTP input field. Click <em>Pick</em> to select it
        visually on the current tab.
      </p>
    </div>
  `;

  // Wire up events
  card.querySelector('.remove-btn').addEventListener('click', () => removeProvider(index));

  card.querySelector('.tag-input').addEventListener('input', e => {
    providers[index].tag = e.target.value.trim();
    card.querySelector('.provider-tag-label').textContent = providers[index].tag || 'new provider';
    markDirty();
  });

  card.querySelector('.url-input').addEventListener('input', e => {
    providers[index].url_pattern = e.target.value.trim();
    markDirty();
  });

  card.querySelector('.selector-input').addEventListener('input', e => {
    providers[index].selector = e.target.value.trim();
    markDirty();
  });

  card.querySelector('.pick-btn').addEventListener('click', () => startPicker(index));

  return card;
}

function addProvider() {
  providers.push({ tag: '', url_pattern: '', selector: '' });
  $('provider-list').appendChild(buildCard(providers.at(-1), providers.length - 1));
  markDirty();
}

function removeProvider(index) {
  providers.splice(index, 1);
  rebuildProviderList();
  markDirty();
}

function markDirty() {
  show('save-bar');
  $('save-status').textContent = '';
}

async function saveProviders() {
  // Sync inputs back into the providers array (in case of rapid edits).
  document.querySelectorAll('.provider-card').forEach(card => {
    const i = parseInt(card.dataset.index, 10);
    if (providers[i]) {
      providers[i].tag         = card.querySelector('.tag-input').value.trim();
      providers[i].url_pattern = card.querySelector('.url-input').value.trim();
      providers[i].selector    = card.querySelector('.selector-input').value.trim();
    }
  });

  await chrome.storage.sync.set({ providers });
  $('save-status').textContent = '✓ Saved';
  setTimeout(() => { $('save-status').textContent = ''; hide('save-bar'); }, 2000);
}

// ── Field picker ──────────────────────────────────────────────────────────────

async function startPicker(providerIndex) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Exclude non-injectable pages (chrome://, extension pages, etc.)
  if (!tab.url?.startsWith('http')) {
    alert('Navigate to the login page first, then click Pick.');
    return;
  }

  pendingPickerCardId = providerIndex;

  // Clear any stale result from a previous picker session.
  await chrome.storage.session.remove('pickerResult');

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files:  ['../picker.js'],
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
