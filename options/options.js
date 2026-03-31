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
    await renderAccount(); // re-sync account section so it no longer shows "Logged in"
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

  // Batch-read all prompt keys at once.
  const keys = resp.configs.map(c => `prompt:${c.name}:${c.version}`);
  const storedPrompts = await chrome.storage.sync.get(keys);

  // Detect configs that need a prompt (no local prompt and not yet flagged on server).
  const needingPrompt = resp.configs.filter(c => {
    const key = `prompt:${c.name}:${c.version}`;
    return !c.prompt_assigned && !storedPrompts[key];
  });

  if (needingPrompt.length > 0) {
    const banner = document.createElement('div');
    banner.className = 'prompt-banner';
    const n = needingPrompt.length;
    banner.textContent =
      `${n} configuration${n > 1 ? 's' : ''} ${n > 1 ? 'need' : 'needs'} a prompt — ` +
      `fill in the field${n > 1 ? 's' : ''} below to enable auto-fill.`;
    list.appendChild(banner);
  }

  for (const cfg of resp.configs) {
    const key    = `prompt:${cfg.name}:${cfg.version}`;
    const prompt = storedPrompts[key] || '';
    const card   = buildConfigCard(cfg, prompt);
    if (!cfg.prompt_assigned && !prompt) card.classList.add('config-card-needs-prompt');
    list.appendChild(card);
  }
}

function buildConfigCard(cfg, prompt) {
  // Badge: server says prompt_assigned, or we have a local prompt stored.
  const hasPrompt = cfg.prompt_assigned || prompt.length > 0;

  const key  = `prompt:${cfg.name}:${cfg.version}`;
  const card = document.createElement('div');
  card.className = 'config-card';

  const badgeHtml = hasPrompt
    ? '<span class="badge badge-ok">prompt ✓</span>'
    : '<span class="badge badge-warn">no prompt</span>';

  card.innerHTML = `
    <div class="config-header">
      <span class="config-name-label">${escHtml(cfg.name)}</span>
      <span class="config-version">${escHtml(cfg.version)}</span>
      ${badgeHtml}
    </div>
    <div class="field">
      <label>Prompt</label>
      <textarea class="prompt-input" rows="3"
        placeholder="CSS selector or fill instructions (leave blank for manual fill)"
        spellcheck="false">${escHtml(prompt)}</textarea>
      <p class="hint">
        Stored locally. A prompt tells the extension how to fill the OTP field for
        this configuration (e.g. <code>#otp-field</code>).
      </p>
    </div>
    <div class="config-actions">
      <button class="btn-primary btn-small save-prompt-btn">Save prompt</button>
      <span class="save-prompt-status"></span>
    </div>
  `;

  card.querySelector('.save-prompt-btn').addEventListener('click', async () => {
    const val      = card.querySelector('.prompt-input').value.trim();
    const statusEl = card.querySelector('.save-prompt-status');
    const badgeEl  = card.querySelector('.badge');

    await chrome.storage.sync.set({ [key]: val });

    // Notify daemon if a non-empty prompt was just stored and flag not yet set.
    if (val && !cfg.prompt_assigned) {
      const r = await chrome.runtime.sendMessage({ type: 'SET_PROMPT_ASSIGNED', id: cfg.id });
      if (!r.error) cfg.prompt_assigned = true;
    }

    // Update badge and card highlight in place.
    const nowHasPrompt = cfg.prompt_assigned || val.length > 0;
    badgeEl.className   = 'badge ' + (nowHasPrompt ? 'badge-ok' : 'badge-warn');
    badgeEl.textContent = nowHasPrompt ? 'prompt ✓' : 'no prompt';
    if (nowHasPrompt) card.classList.remove('config-card-needs-prompt');

    statusEl.textContent = '✓ Saved';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });

  return card;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
