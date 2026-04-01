// noncey — background service worker
// All API calls are centralised here to avoid content-script CORS restrictions.
// Icon drawing uses OffscreenCanvas (available in MV3 service workers).

'use strict';

// ── Icon ──────────────────────────────────────────────────────────────────────

const ICON_COLOR_ACTIVE = '#00897b';  // teal — provider matched, authenticated
const ICON_COLOR_IDLE   = '#9e9e9e';  // gray — no match or not authenticated

function drawIcon(size, color) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx    = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size / 2 - 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(size * 0.55)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy + 1);
  return ctx.getImageData(0, 0, size, size);
}

function setIcon(active) {
  const color = active ? ICON_COLOR_ACTIVE : ICON_COLOR_IDLE;
  chrome.action.setIcon({
    imageData: {
      16: drawIcon(16, color),
      48: drawIcon(48, color),
    },
  });
}

// Set idle icon on startup
setIcon(false);

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
        body: JSON.stringify({ username, password }),
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
      setIcon(false);
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
      setIcon(msg.active);
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
        url: msg.url, selector: msg.selector,
      });
      return { ok: true };
    }

    case 'REPORT_TEST': {
      await apiFetch('POST', `/api/configs/${msg.id}/client-test`);
      return { ok: true };
    }

    case 'PICKER_RESULT': {
      await chrome.storage.session.set({
        pickerResult: { selector: msg.selector, url: msg.url, ts: Date.now() },
      });
      return { ok: true };
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
