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
let knownConfigs   = [];      // unique config names seen in last nonce response
let configMeta     = [];      // [{id, name, version, prompt, is_owned, ...}] from GET /api/configs

// ── URL matching ──────────────────────────────────────────────────────────────

function urlMatchesPrompt(url, prompt) {
  if (!prompt?.url) return false;
  switch (prompt.url_match) {
    case 'exact': return url === prompt.url;
    case 'regex': try { return new RegExp(prompt.url).test(url); } catch { return false; }
    default:      return url.startsWith(prompt.url);  // 'prefix' / fallback
  }
}

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

  const toggleBtn = $('autofill-toggle');
  toggleBtn.classList.toggle('on', storage.autoFill !== false);
  toggleBtn.addEventListener('click', async () => {
    const next = !toggleBtn.classList.contains('on');
    toggleBtn.classList.toggle('on', next);
    await chrome.storage.sync.set({ autoFill: next });
  });

  const [tab]     = await chrome.tabs.query({ active: true, currentWindow: true });
  const url       = tab?.url || '';
  const providers = storage.providers || [];

  // Fetch configs before the URL gate so config prompt URLs can also activate
  // the popup (not just local provider patterns).
  const [local, configsResp] = await Promise.all([
    chrome.storage.local.get('activeConfigName'),
    chrome.runtime.sendMessage({ type: 'GET_CONFIGS' }).catch(() => ({})),
  ]);

  activeConfigName = local.activeConfigName ?? null;
  if (!configsResp.error && configsResp.configs) {
    configMeta = configsResp.configs;
  }

  const providerMatched = providers.find(p => p.url_pattern && url.includes(p.url_pattern));
  const configMatched   = configMeta.some(c => c.prompt && urlMatchesPrompt(url, c.prompt));

  if (!providerMatched && !configMatched) {
    show('view-no-match');
    return;
  }

  show('view-nonces');
  renderConfigBar();

  $('config-change-btn').addEventListener('click', toggleConfigSelector);

  // Prompt notice — shown once at boot if any config has no local prompt stored.
  await checkPromptNotice();

  await fetchAndRender();
  pollTimer = setInterval(fetchAndRender, 2000);
})();

window.addEventListener('unload', () => clearInterval(pollTimer));

// ── Config bar ────────────────────────────────────────────────────────────────

function configDisplayName(name) {
  if (!name) return 'All configurations';
  const meta = configMeta.find(c => c.name === name);
  return meta ? `${name} · ${meta.version}` : name;
}

function renderConfigBar() {
  $('config-label').textContent = configDisplayName(activeConfigName);
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

  // Prefer configMeta (has version); fall back to names from nonce data.
  const options = configMeta.length > 0
    ? configMeta.map(c => ({ name: c.name, label: `${c.name} · ${c.version}` }))
    : knownConfigs.map(name => ({ name, label: name }));

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.className = 'config-option' + (activeConfigName === opt.name ? ' active' : '');
    btn.textContent = opt.label;
    btn.addEventListener('click', () => selectConfig(opt.name));
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

// ── Prompt notice ─────────────────────────────────────────────────────────────

async function checkPromptNotice() {
  if (configMeta.length === 0) return;

  const needsPrompt = configMeta.some(c => !c.prompt);

  if (needsPrompt) {
    show('prompt-notice');
    $('prompt-notice-btn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });
  }
}

// ── Fetch + render ────────────────────────────────────────────────────────────

async function fetchAndRender() {
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: 'GET_NONCES' });
  } catch {
    return;
  }

  if (resp.error === 'AUTH_EXPIRED') {
    clearInterval(pollTimer);
    hide('view-nonces');
    show('view-auth-required');
    return;
  }
  if (resp.error || !resp.nonces) return;

  // Update known configs from nonce data (fallback for config selector).
  const seen = [...new Set(
    resp.nonces.map(n => n.configuration_name).filter(Boolean)
  )].sort();
  if (JSON.stringify(seen) !== JSON.stringify(knownConfigs)) {
    knownConfigs = seen;
  }

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
  // Look up the prompt (selector) from server config metadata, keyed by configuration_name.
  const meta = configMeta.find(c => c.name === nonce.configuration_name);
  const selector = meta?.prompt?.selector ?? null;

  if (!selector) {
    await navigator.clipboard.writeText(nonce.nonce_value).catch(() => {});
    return;
  }

  // Re-use provider variable name for the fill message shape.
  const provider = { selector };

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
