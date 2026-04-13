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

let pollTimer        = null;
let activeConfigName = null;  // null = show all; string = filter to that config
let knownConfigs     = [];    // unique config names seen in last nonce response
let configMeta       = [];    // [{id, name, version, prompt, is_owned, ...}] from GET /api/configs
let autoFillSeen     = new Set(); // nonce IDs already attempted by auto-fill this session
let lastNonceIds     = new Set(); // IDs from most recent successful fetch (for manual refresh diff)

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
    'token', 'username', 'providers', 'autoFill', 'server', 'consolePath',
  ]);

  if (!storage.token) {
    show('view-auth-required');
    return;
  }

  if (storage.server) {
    const consolePath = (storage.consolePath || 'auth').replace(/^\/|\/$/g, '');
    const link = $('account-settings-link');
    link.href = storage.server.replace(/\/$/, '') + '/' + consolePath + '/';
    show('account-footer');
  }

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
    sendMsg({ type: 'GET_CONFIGS' }),
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
  $('refresh-btn').addEventListener('click', () => fetchAndRender(true));

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

async function fetchAndRender(manual = false) {
  const resp = await sendMsg({ type: 'GET_NONCES' });

  if (resp.error === 'AUTH_EXPIRED') {
    clearInterval(pollTimer);
    hide('view-nonces');
    show('view-auth-required');
    return;
  }
  if (resp.error || !resp.nonces) return;

  if (manual) {
    const currentIds = new Set(resp.nonces.map(n => n.id));
    const newCount   = [...currentIds].filter(id => !lastNonceIds.has(id)).length;
    console.log(`[noncey] manual refresh: ${newCount} new nonce(s) picked up (total: ${resp.nonces.length})`);
    lastNonceIds = currentIds;
  } else {
    lastNonceIds = new Set(resp.nonces.map(n => n.id));
  }

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

  // Auto-fill: if the pill is on, fire on the first nonce not yet attempted.
  if ($('autofill-toggle').classList.contains('on')) {
    const candidate = nonces.find(n => !autoFillSeen.has(n.id));
    if (candidate) {
      autoFillSeen.add(candidate.id);
      onNonceClick(candidate);
    }
  }
}

// ── Fill action ───────────────────────────────────────────────────────────────

async function onNonceClick(nonce) {
  // Look up the prompt from server config metadata, keyed by configuration_name.
  const meta         = configMeta.find(c => c.name === nonce.configuration_name);
  const selector     = meta?.prompt?.selector     ?? null;
  const fillStrategy = meta?.prompt?.fill_strategy ?? 'simple';

  if (!selector) {
    await navigator.clipboard.writeText(nonce.nonce_value).catch(() => {});
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type:          'FILL_FIELD',
      value:         nonce.nonce_value,
      selector:      selector,
      fill_strategy: fillStrategy,
    });
    if (resp?.ok) {
      sendMsg({ type: 'DELETE_NONCE', id: nonce.id });
      if (meta?.id != null) {
        sendMsg({ type: 'REPORT_TEST', id: meta.id });
      }
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
