'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

function show(id)   { document.getElementById(id).classList.remove('hidden'); }
function hide(id)   { document.getElementById(id).classList.add('hidden'); }
function $(id)      { return document.getElementById(id); }

function formatAge(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s < 10 ? '0' + s : s}s`;
}

function truncate(str, max = 14) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ── State ─────────────────────────────────────────────────────────────────────

let pollTimer      = null;
let activeConfigName = null;  // null = show all; string = filter to that config
let knownConfigs   = [];       // unique config names seen in last nonce response

// ── Boot ──────────────────────────────────────────────────────────────────────

(async function boot() {
  const storage = await chrome.storage.sync.get([
    'token', 'username', 'providers', 'autoFill',
  ]);

  if (!storage.token) {
    show('view-auth-required');
    return;
  }

  $('user-label').textContent = storage.username || 'noncey';

  // Auto-fill toggle — persisted in chrome.storage.sync, default on.
  const toggleBtn = $('autofill-toggle');
  toggleBtn.classList.toggle('on', storage.autoFill !== false);
  toggleBtn.addEventListener('click', async () => {
    const next = !toggleBtn.classList.contains('on');
    toggleBtn.classList.toggle('on', next);
    await chrome.storage.sync.set({ autoFill: next });
  });

  // Determine if current tab URL matches a configured provider.
  const [tab]    = await chrome.tabs.query({ active: true, currentWindow: true });
  const url      = tab?.url || '';
  const providers = storage.providers || [];
  const matched  = providers.find(p => p.url_pattern && url.includes(p.url_pattern));

  if (!matched) {
    show('view-no-match');
    return;
  }

  // Load active config selection from local storage.
  const local = await chrome.storage.local.get('activeConfigName');
  activeConfigName = local.activeConfigName ?? null;

  show('view-nonces');
  renderConfigBar();

  $('config-change-btn').addEventListener('click', toggleConfigSelector);

  // Poll while the popup is open.
  await fetchAndRender();
  pollTimer = setInterval(fetchAndRender, 2000);
})();

// Clean up timer when popup closes.
window.addEventListener('unload', () => clearInterval(pollTimer));

// ── Config bar ────────────────────────────────────────────────────────────────

function renderConfigBar() {
  $('config-label').textContent = activeConfigName ?? 'All configurations';
}

function toggleConfigSelector() {
  const sel = $('config-selector');
  if (!sel.classList.contains('hidden')) {
    hide('config-selector');
    return;
  }

  sel.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'config-option' + (activeConfigName === null ? ' active' : '');
  allBtn.textContent = 'All configurations';
  allBtn.addEventListener('click', () => selectConfig(null));
  sel.appendChild(allBtn);

  for (const name of knownConfigs) {
    const btn = document.createElement('button');
    btn.className = 'config-option' + (activeConfigName === name ? ' active' : '');
    btn.textContent = name;
    btn.addEventListener('click', () => selectConfig(name));
    sel.appendChild(btn);
  }

  show('config-selector');
}

async function selectConfig(name) {
  activeConfigName = name;
  await chrome.storage.local.set({ activeConfigName: name });
  hide('config-selector');
  renderConfigBar();
  await fetchAndRender();
}

// ── Fetch + render ────────────────────────────────────────────────────────────

async function fetchAndRender() {
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: 'GET_NONCES' });
  } catch {
    return; // service worker restart — will succeed on next tick
  }

  if (resp.error === 'AUTH_EXPIRED') {
    clearInterval(pollTimer);
    hide('view-nonces');
    show('view-auth-required');
    return;
  }
  if (resp.error || !resp.nonces) return;

  // Update known configs from nonce data (deduplicated, sorted).
  const seen = [...new Set(
    resp.nonces.map(n => n.configuration_name).filter(Boolean)
  )].sort();
  if (JSON.stringify(seen) !== JSON.stringify(knownConfigs)) {
    knownConfigs = seen;
  }

  // Filter nonces by active config (or show all).
  let nonces = resp.nonces;
  if (activeConfigName !== null) {
    nonces = nonces.filter(n => n.configuration_name === activeConfigName);
  }

  const list = $('nonce-list');
  list.innerHTML = '';

  if (nonces.length === 0) {
    show('no-nonces');
    return;
  }
  hide('no-nonces');

  for (const nonce of nonces) {
    const li = document.createElement('li');
    li.title = `Click to fill  •  full value: ${nonce.nonce_value}`;

    const valSpan = document.createElement('span');
    valSpan.className   = 'nonce-value';
    valSpan.textContent = truncate(nonce.nonce_value);

    const tagSpan = document.createElement('span');
    tagSpan.className   = 'nonce-tag';
    tagSpan.textContent = nonce.provider_tag;

    const ageSpan = document.createElement('span');
    ageSpan.className   = 'nonce-age';
    ageSpan.textContent = formatAge(nonce.age_seconds);

    li.append(valSpan, tagSpan, ageSpan);
    li.addEventListener('click', () => onNonceClick(nonce));
    list.appendChild(li);
  }
}

// ── Fill action ───────────────────────────────────────────────────────────────

async function onNonceClick(nonce) {
  // Look up the matching provider by tag to get its CSS selector.
  const { providers = [] } = await chrome.storage.sync.get('providers');
  const provider = providers.find(p => p.tag === nonce.provider_tag);

  if (!provider?.selector) {
    await navigator.clipboard.writeText(nonce.nonce_value).catch(() => {});
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type:     'FILL_FIELD',
      value:    nonce.nonce_value,
      selector: provider.selector,
    });
    if (resp?.ok) {
      chrome.runtime.sendMessage({ type: 'DELETE_NONCE', id: nonce.id }).catch(() => {});
      window.close();
    } else if (resp?.error) {
      console.warn('noncey fill error:', resp.error);
    }
  } catch {
    await navigator.clipboard.writeText(nonce.nonce_value).catch(() => {});
  }
}

// ── Settings button ───────────────────────────────────────────────────────────

$('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

$('go-options')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
