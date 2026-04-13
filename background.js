// noncey — background service worker
// All API calls are centralised here to avoid content-script CORS restrictions.

'use strict';

// ── Icon ──────────────────────────────────────────────────────────────────────

// Uses PNG paths instead of canvas-drawn imageData so the manifest default_icon
// and the dynamically-set icon are always the same asset.
// Fire-and-forget: chrome.action.setIcon can hang during extension reload;
// .catch() suppresses the rejection so the SW does not crash.
function setIcon() {
  chrome.action.setIcon({
    path: {
      '16':  'icons/icon16.png',
      '32':  'icons/icon32.png',
      '48':  'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
  }).catch(e => console.warn('[noncey] setIcon skipped:', e.message));
}

// No setIcon call at startup: the manifest default_icon handles the initial
// visual state. Calling chrome.action.setIcon() here creates a pending Promise
// that is abandoned when the user reloads the extension, which Chrome counts
// as an abnormal SW termination and throttles after 3-4 occurrences.
console.log('[noncey] service worker starting');
console.log('[noncey] service worker ready');

// ── API ───────────────────────────────────────────────────────────────────────

async function apiFetch(method, path, body = null) {
  const { server, token } = await chrome.storage.sync.get(['server', 'token']);
  if (!server) throw new Error('SERVER_NOT_CONFIGURED');
  if (!token)  throw new Error('AUTH_REQUIRED');

  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}` },
  };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${server}${path}`, opts);

  if (res.status === 401) {
    await chrome.storage.sync.remove(['token', 'token_expires_at']);
    throw new Error('AUTH_EXPIRED');
  }

  return res;
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));
  return true; // keep channel open for async response
});

async function handleMessage(msg, sender) {
  switch (msg.type) {

    case 'LOGIN': {
      const { server, username, password } = msg;
      const res = await fetch(`${server}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, client_type: 'chrome' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Login failed');
      }
      const data = await res.json();
      await chrome.storage.sync.set({
        server,
        username,
        token: data.token,
        token_expires_at: data.expires_at,
      });
      return { ok: true };
    }

    case 'LOGOUT': {
      try { await apiFetch('POST', '/api/auth/logout'); } catch {}
      await chrome.storage.sync.remove(['token', 'token_expires_at']);
      setIcon();
      return { ok: true };
    }

    case 'GET_NONCES': {
      const res  = await apiFetch('GET', '/api/nonces');
      const data = await res.json();
      return { nonces: data };
    }

    case 'DELETE_NONCE': {
      await apiFetch('DELETE', `/api/nonces/${msg.id}`);
      return { ok: true };
    }

    case 'SET_ICON': {
      setIcon();
      return { ok: true };
    }

    // Options page injects picker.js into the active tab, then listens for
    // PICKER_RESULT via chrome.storage.session.onChanged.
    case 'GET_CONFIGS': {
      const res  = await apiFetch('GET', '/api/configs');
      const data = await res.json();
      return { configs: data };
    }

    case 'PUSH_PROMPT': {
      await apiFetch('POST', `/api/configs/${msg.id}/prompt`, {
        url: msg.url, url_match: msg.url_match, selector: msg.selector,
        fill_strategy: msg.fill_strategy,
      });
      return { ok: true };
    }

    case 'REPORT_TEST': {
      await apiFetch('POST', `/api/configs/${msg.id}/client-test`);
      return { ok: true };
    }

    case 'PICKER_RESULT': {
      await chrome.storage.session.set({
        pickerResult: { selector: msg.selector, url: msg.url, fill_strategy: msg.fill_strategy, ts: Date.now() },
      });
      return { ok: true };
    }

    case 'PING':
      return { pong: true };

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
