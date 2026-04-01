'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

function $(id)         { return document.getElementById(id); }
function show(id)      { $(id).classList.remove('hidden'); }
function hide(id)      { $(id).classList.add('hidden'); }
function setHtml(id,h) { $(id).innerHTML = h; }

// Track which provider card (local) or config card (daemon) awaits a picker result.
let pendingPickerCardId   = null;
let pendingPickerConfigId = null;

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await renderAccount();
  await renderProviders();
  await renderConfigs();

  $('login-btn').addEventListener('click', doLogin);
  $('password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('logout-btn').addEventListener('click', doLogout);
  $('add-provider-btn').addEventListener('click', addProvider);
  $('save-btn').addEventListener('click', saveProviders);
  $('refresh-configs-btn').addEventListener('click', renderConfigs);

  // Listen for picker results written by background.js into session storage.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes.pickerResult) return;
    const { selector, url } = changes.pickerResult.newValue;

    if (pendingPickerConfigId !== null) {
      // Config card picker: push prompt to daemon, then refresh config list.
      const configId = pendingPickerConfigId;
      pendingPickerConfigId = null;
      pushConfigPrompt(configId, url, selector);
    } else if (pendingPickerCardId !== null) {
      // Provider card picker: fill selector input locally.
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
  await renderConfigs();
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
  await renderConfigs();
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
      <span class="provider-tag-label">${escHtml(provider.tag || 'new provider prompt')}</span>
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
    card.querySelector('.provider-tag-label').textContent = providers[index].tag || 'new provider prompt';
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
  const tab = await findPickerTab();
  if (!tab) return;

  pendingPickerCardId = providerIndex;
  await chrome.storage.session.remove('pickerResult');

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files:  ['picker.js'],
  });
}

// ── Shared picker tab resolution ──────────────────────────────────────────────
// The options page is itself a tab, so querying "active tab" always returns
// the options page (chrome-extension:// URL). Instead, find the most recently
// accessed HTTP tab in the current window that isn't us.
async function findPickerTab() {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const httpTabs = allTabs.filter(
    t => t.url?.startsWith('http') && !t.url.startsWith('chrome-extension://')
  );

  if (httpTabs.length === 0) {
    alert('Open the OTP login page in this window first, then click Pick.');
    return null;
  }

  // Prefer the most recently accessed tab (highest lastAccessed value).
  httpTabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return httpTabs[0];
}

// ── Configurations section ────────────────────────────────────────────────────

async function renderConfigs() {
  const { token } = await chrome.storage.sync.get('token');
  const list = $('config-list');

  if (!token) {
    list.innerHTML = '<p class="muted" id="configs-placeholder">Log in to load configurations.</p>';
    hide('refresh-configs-btn');
    return;
  }

  show('refresh-configs-btn');
  list.innerHTML = '<p class="muted" id="configs-placeholder">Loading…</p>';

  const resp = await chrome.runtime.sendMessage({ type: 'GET_CONFIGS' });

  if (resp.error === 'AUTH_EXPIRED') {
    list.innerHTML = '<p class="muted">Session expired — please log in again.</p>';
    hide('refresh-configs-btn');
    await renderAccount();
    return;
  }
  if (resp.error) {
    list.innerHTML = `<p class="muted">Error loading configurations: ${escHtml(resp.error)}</p>`;
    return;
  }

  list.innerHTML = '';

  if (resp.configs.length === 0) {
    list.innerHTML = '<p class="muted">No active configurations found on the server.</p>';
    return;
  }

  const needingPrompt = resp.configs.filter(c => !c.prompt);
  if (needingPrompt.length > 0) {
    const banner = document.createElement('div');
    banner.className = 'prompt-banner';
    const n = needingPrompt.length;
    banner.textContent =
      `${n} configuration${n > 1 ? 's need' : ' needs'} a prompt — ` +
      `navigate to the OTP page and click Pick to enable auto-fill.`;
    list.appendChild(banner);
  }

  for (const cfg of resp.configs) {
    const card = buildConfigCard(cfg);
    if (!cfg.prompt) card.classList.add('config-card-needs-prompt');
    list.appendChild(card);
  }
}

function buildConfigCard(cfg) {
  const hasPrompt = !!cfg.prompt;
  const versionLabel = cfg.version === '-1' ? 'private' : cfg.version;

  const card = document.createElement('div');
  card.className = 'config-card';
  card.dataset.configId = cfg.id;

  const badgeHtml = hasPrompt
    ? '<span class="badge badge-ok">prompt ✓</span>'
    : '<span class="badge badge-warn">no prompt</span>';

  const promptInfoHtml = hasPrompt
    ? `<div class="prompt-info">
         <span class="prompt-url" title="${escHtml(cfg.prompt.url)}">${escHtml(cfg.prompt.url)}</span>
         <code class="prompt-selector">${escHtml(cfg.prompt.selector)}</code>
       </div>`
    : '<p class="hint">No prompt set. Navigate to the OTP input page, then click Pick.</p>';

  const pickBtnHtml = cfg.is_owned
    ? '<button class="btn-small pick-config-btn">Pick</button>'
    : '';

  card.innerHTML = `
    <div class="config-header">
      <span class="config-name-label">${escHtml(cfg.name)}</span>
      <span class="config-version">${escHtml(versionLabel)}</span>
      ${badgeHtml}
    </div>
    <div class="prompt-section">
      ${promptInfoHtml}
      <div class="config-actions">
        ${pickBtnHtml}
        <span class="pick-status"></span>
      </div>
    </div>
  `;

  if (cfg.is_owned) {
    card.querySelector('.pick-config-btn').addEventListener('click', () =>
      startConfigPicker(cfg.id)
    );
  }

  return card;
}

async function startConfigPicker(configId) {
  const tab = await findPickerTab();
  if (!tab) return;

  pendingPickerConfigId = configId;
  await chrome.storage.session.remove('pickerResult');

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files:  ['picker.js'],
  });
}

async function pushConfigPrompt(configId, url, selector) {
  const card = document.querySelector(`.config-card[data-config-id="${configId}"]`);
  if (card) {
    const statusEl = card.querySelector('.pick-status');
    if (statusEl) statusEl.textContent = 'Saving…';
  }

  const r = await chrome.runtime.sendMessage({
    type: 'PUSH_PROMPT', id: configId, url, selector,
  });

  if (r.error) {
    if (card) {
      const statusEl = card.querySelector('.pick-status');
      if (statusEl) statusEl.textContent = `Error: ${r.error}`;
    }
  } else {
    await renderConfigs();
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
