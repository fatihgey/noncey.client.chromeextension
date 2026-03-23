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

let activeProvider = null;  // matched provider for the current tab
let pollTimer      = null;

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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url   = tab?.url || '';
  const providers = storage.providers || [];
  activeProvider  = providers.find(p => p.url_pattern && url.includes(p.url_pattern));

  if (!activeProvider) {
    show('view-no-match');
    return;
  }

  show('view-nonces');
  $('provider-label').textContent = activeProvider.tag;

  // Poll while the popup is open.
  await fetchAndRender();
  pollTimer = setInterval(fetchAndRender, 2000);
})();

// Clean up timer when popup closes (the popup context is destroyed, but
// setInterval is cleared immediately to avoid any last-tick work).
window.addEventListener('unload', () => clearInterval(pollTimer));

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

  // Show only nonces for the active provider.
  const nonces = resp.nonces.filter(n => n.provider_tag === activeProvider.tag);

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

    const ageSpan = document.createElement('span');
    ageSpan.className   = 'nonce-age';
    ageSpan.textContent = formatAge(nonce.age_seconds);

    li.append(valSpan, ageSpan);
    li.addEventListener('click', () => onNonceClick(nonce));
    list.appendChild(li);
  }
}

// ── Fill action ───────────────────────────────────────────────────────────────

async function onNonceClick(nonce) {
  if (!activeProvider.selector) {
    // No selector configured — just copy to clipboard.
    await navigator.clipboard.writeText(nonce.nonce_value).catch(() => {});
    return;
  }

  // Send fill request to the content script in the active tab.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type:     'FILL_FIELD',
      value:    nonce.nonce_value,
      selector: activeProvider.selector,
    });
    if (resp?.ok) {
      // Remove from server after successful fill.
      chrome.runtime.sendMessage({ type: 'DELETE_NONCE', id: nonce.id }).catch(() => {});
      window.close();
    } else if (resp?.error) {
      console.warn('noncey fill error:', resp.error);
    }
  } catch {
    // Content script not present (e.g. chrome:// page) — fall back to clipboard.
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
