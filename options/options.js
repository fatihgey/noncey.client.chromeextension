'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Sends a message to the background service worker with timeout + retry.
// Handles both idle-termination (SW restarted by Chrome) and post-hot-reload
// delays where the SW is mid-startup and not yet listening.
// Returns { error: 'sw_unavailable' } if all attempts fail — never throws.
async function sendMsg(msg, { attempts = 3, timeoutMs = 2500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await Promise.race([
        chrome.runtime.sendMessage(msg),
        new Promise((_, rej) => setTimeout(() => rej(new Error('sw_timeout')), timeoutMs)),
      ]);
      if (i > 0) console.log(`[noncey] sendMsg(${msg.type}): ok on attempt ${i + 1}`);
      return result;
    } catch (e) {
      console.warn(`[noncey] sendMsg(${msg.type}): attempt ${i + 1} failed — ${e.message}`);
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
  console.error(`[noncey] sendMsg(${msg.type}): all ${attempts} attempts exhausted`);
  return { error: 'sw_unavailable' };
}

function $(id)         { return document.getElementById(id); }
function show(id)      { $(id).classList.remove('hidden'); }
function hide(id)      { $(id).classList.add('hidden'); }
function setHtml(id,h) { $(id).innerHTML = h; }

let pendingPickerConfigId = null;
let allConfigs = [];
let currentDetailId = null;

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await renderAccount();
  await renderConfigs();

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    });
  });

  $('login-btn').addEventListener('click', doLogin);
  $('password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('logout-btn').addEventListener('click', doLogout);

  $('console-path').addEventListener('blur', async () => {
    const val = $('console-path').value.trim().replace(/^\/|\/$/g, '');
    await chrome.storage.sync.set({ consolePath: val });
  });

  $('sync-btn').addEventListener('click', renderConfigs);
  $('new-config-btn').addEventListener('click', openNewConfig);
  $('marketplace-btn').addEventListener('click', openMarketplace);
  $('back-btn').addEventListener('click', showListView);

  // Listen for picker results written by background.js into session storage.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes.pickerResult) return;
    const { selector, url } = changes.pickerResult.newValue;

    if (pendingPickerConfigId !== null) {
      const configId = pendingPickerConfigId;
      pendingPickerConfigId = null;
      const baseUrl = url ? url.split('?')[0] : url;
      pushConfigPrompt(configId, baseUrl, selector, 'prefix');
    }
  });
});

// ── View switching ────────────────────────────────────────────────────────────

function showListView() {
  currentDetailId = null;
  show('view-list');
  hide('view-detail');
}

function showDetailView() {
  hide('view-list');
  show('view-detail');
}

// ── Account section ───────────────────────────────────────────────────────────

async function renderAccount() {
  const { server, username, token, consolePath } = await chrome.storage.sync.get([
    'server', 'username', 'token', 'consolePath',
  ]);

  if (server) $('server').value = server;
  if (username) $('username').value = username;
  $('console-path').value = consolePath || '';

  if (token) {
    setHtml('auth-status', `<span class="status-ok">&#10003; Logged in as ${username || '?'}</span>`);
    hide('login-form');
    show('logout-row');
  } else {
    setHtml('auth-status',
      '<span class="status-err">Not authenticated &#8212; enter credentials below</span>');
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
  $('login-btn').textContent = 'Logging in\u2026';

  const resp = await sendMsg({ type: 'LOGIN', server, username, password });

  $('login-btn').disabled = false;
  $('login-btn').textContent = 'Log in';

  if (resp.error) { showLoginError(resp.error); return; }

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
  await sendMsg({ type: 'LOGOUT' });
  $('logout-btn').disabled = false;
  await renderAccount();
  await renderConfigs();
}

// ── Configurations table ──────────────────────────────────────────────────────

async function renderConfigs() {
  const { token } = await chrome.storage.sync.get('token');
  const container = $('config-table-container');

  if (!token) {
    container.innerHTML = '<p class="muted">Log in to load configurations.</p>';
    allConfigs = [];
    return;
  }

  container.innerHTML = '<p class="muted">Loading\u2026</p>';

  const resp = await sendMsg({ type: 'GET_CONFIGS' });

  if (resp.error === 'AUTH_EXPIRED') {
    container.innerHTML = '<p class="muted">Session expired \u2014 please log in again.</p>';
    await renderAccount();
    allConfigs = [];
    return;
  }
  if (resp.error) {
    container.innerHTML = `<p class="muted">Error loading configurations: ${escHtml(resp.error)}</p>`;
    return;
  }

  allConfigs = resp.configs;

  if (allConfigs.length === 0) {
    container.innerHTML = '<p class="muted">No active configurations found on the server.</p>';
    return;
  }

  container.innerHTML = '';
  container.appendChild(buildConfigTable(allConfigs));

  // If detail view is open, refresh it with updated data.
  if (currentDetailId !== null) {
    const updated = allConfigs.find(c => c.id === currentDetailId);
    if (updated) openDetail(updated);
  }
}

function buildConfigTable(configs) {
  const table = document.createElement('table');
  table.className = 'config-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Type</th>
      <th>Name</th>
      <th></th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const cfg of configs) {
    const isPrivate = cfg.is_owned;
    const typeLabel = isPrivate ? 'Private' : 'Public';

    let badgeHtml = '';
    if (!isPrivate) {
      // Public subscriptions: version badge
      const ver = cfg.version && cfg.version !== '-1' ? cfg.version : '';
      if (ver) badgeHtml = `<span class="badge badge-version">${escHtml(ver)}</span>`;
    } else {
      // Private (owned): prompt status badge
      badgeHtml = cfg.prompt
        ? '<span class="badge badge-ok">prompt &#10003;</span>'
        : '<span class="badge badge-warn">no prompt</span>';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="type-label type-${typeLabel.toLowerCase()}">${typeLabel}</span></td>
      <td class="name-cell">
        <span class="config-name-text">${escHtml(cfg.name)}</span>
        ${badgeHtml}
      </td>
      <td class="actions-cell">
        <button class="btn-small open-btn">Open</button>
      </td>
    `;
    tr.querySelector('.open-btn').addEventListener('click', () => openDetail(cfg));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// ── Config detail view ────────────────────────────────────────────────────────

function openDetail(cfg) {
  currentDetailId = cfg.id;
  showDetailView();

  // Top card: name, status, channels
  const status = cfg.is_owned
    ? (cfg.prompt ? 'Active' : 'Setup needed')
    : (cfg.prompt ? 'Active' : 'No prompt');

  const channelCount = cfg.channel_count != null ? cfg.channel_count : '\u2014';
  const channelLabel = typeof channelCount === 'number'
    ? `${channelCount} channel${channelCount === 1 ? '' : 's'}`
    : '\u2014 channels';

  $('detail-info-card').innerHTML = `
    <div class="detail-name">${escHtml(cfg.name)}</div>
    <div class="detail-meta">
      <span class="detail-status-label">${escHtml(status)}</span>
      <span class="detail-channels">${channelLabel}</span>
    </div>
  `;

  // Bottom card: prompt content
  const promptContent = $('detail-prompt-content');
  promptContent.innerHTML = '';
  promptContent.appendChild(buildPromptSection(cfg));
}

function buildPromptSection(cfg) {
  const hasPrompt = !!cfg.prompt;
  const p = cfg.prompt || {};
  const currentMatch = p.url_match || 'prefix';
  const div = document.createElement('div');

  if (cfg.is_owned) {
    const matchRadios = ['exact', 'prefix', 'regex'].map(m => `
      <label class="radio-label">
        <input type="radio" name="url_match_${cfg.id}" value="${m}"${m === currentMatch ? ' checked' : ''}>
        ${m === 'exact' ? 'Exact' : m === 'prefix' ? 'Begins with' : 'Regex'}
      </label>`).join('');

    div.innerHTML = `
      <div class="field">
        <label>URL</label>
        <input type="text" class="prompt-url-input"
               value="${escHtml(p.url || '')}"
               placeholder="Navigate to the OTP page and click Pick"
               spellcheck="false" autocomplete="off">
        <div class="radio-group">${matchRadios}</div>
      </div>
      <div class="field">
        <label>OTP field selector</label>
        <input type="text" class="prompt-selector-display" readonly
               value="${escHtml(p.selector || '')}"
               placeholder="(use Pick to capture)">
      </div>
      <div class="config-actions">
        <button class="btn-small pick-config-btn">Pick</button>
        <button class="btn-primary btn-small save-prompt-btn"${hasPrompt ? '' : ' disabled'}>Save URL</button>
        <span class="pick-status"></span>
      </div>
    `;

    const urlInput = div.querySelector('.prompt-url-input');
    const saveBtn  = div.querySelector('.save-prompt-btn');

    div.querySelector('.pick-config-btn').addEventListener('click', () => startConfigPicker(cfg.id));

    urlInput.addEventListener('input', () => {
      saveBtn.disabled = !urlInput.value.trim();
    });

    saveBtn.addEventListener('click', async () => {
      const url      = urlInput.value.trim();
      const selector = div.querySelector('.prompt-selector-display').value.trim();
      const urlMatch = div.querySelector(`input[name="url_match_${cfg.id}"]:checked`)?.value || 'prefix';
      if (!url || !selector) return;
      await pushConfigPrompt(cfg.id, url, selector, urlMatch);
    });

  } else if (hasPrompt) {
    div.innerHTML = `
      <div class="field">
        <label>URL</label>
        <span class="badge badge-match">${escHtml(currentMatch)}</span>
        <span class="prompt-url-text">${escHtml(p.url || '')}</span>
      </div>
      <div class="field">
        <label>OTP field selector</label>
        <input type="text" readonly value="${escHtml(p.selector || '')}" style="width:100%;">
      </div>
    `;
  } else {
    div.innerHTML = '<p class="hint">No prompt set (set by the configuration owner).</p>';
  }

  return div;
}

// ── Config action buttons ─────────────────────────────────────────────────────

async function openNewConfig() {
  const { server, consolePath } = await chrome.storage.sync.get(['server', 'consolePath']);
  if (!server) { alert('Set a server URL in Server Settings first.'); return; }
  const path = (consolePath || 'auth').replace(/^\/|\/$/g, '');
  chrome.tabs.create({ url: `${server}/${path}/wizard/new` });
}

async function openMarketplace() {
  const { server, consolePath } = await chrome.storage.sync.get(['server', 'consolePath']);
  if (!server) { alert('Set a server URL in Server Settings first.'); return; }
  const path = (consolePath || 'auth').replace(/^\/|\/$/g, '');
  chrome.tabs.create({ url: `${server}/${path}/marketplace` });
}

// ── Field picker ──────────────────────────────────────────────────────────────

async function startConfigPicker(configId) {
  const tab = await findPickerTab();
  if (!tab) return;
  pendingPickerConfigId = configId;
  await chrome.storage.session.remove('pickerResult');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['picker.js'] });
}

async function findPickerTab() {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const httpTabs = allTabs.filter(
    t => t.url?.startsWith('http') && !t.url.startsWith('chrome-extension://')
  );
  if (httpTabs.length === 0) {
    alert('Open the OTP login page in this window first, then click Pick.');
    return null;
  }
  httpTabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return httpTabs[0];
}

async function pushConfigPrompt(configId, url, selector, urlMatch = 'prefix') {
  const statusEl = $('detail-prompt-content')?.querySelector('.pick-status');
  if (statusEl) statusEl.textContent = 'Saving\u2026';

  const r = await sendMsg({
    type: 'PUSH_PROMPT', id: configId, url, url_match: urlMatch, selector,
  });

  if (r.error) {
    if (statusEl) statusEl.textContent = `Error: ${r.error}`;
  } else {
    await renderConfigs();
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
