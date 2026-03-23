// noncey — content script
// Injected into every page. Checks if the URL matches a configured provider;
// if so, starts polling the noncey API and auto-fills OTP fields on arrival.
// Also handles manual fill requests from the popup.

'use strict';

(async function main() {
  const storage = await chrome.storage.sync.get(['providers', 'token', 'autoFill']);
  const providers = storage.providers || [];
  if (!storage.token || providers.length === 0) return;

  const url      = window.location.href;
  const provider = providers.find(p => p.url_pattern && url.includes(p.url_pattern));
  if (!provider) return;

  // Tell the service worker to show the active (coloured) icon for this tab.
  chrome.runtime.sendMessage({ type: 'SET_ICON', active: true }).catch(() => {});

  // Track autoFill preference reactively so the popup toggle takes effect immediately.
  let autoFill = storage.autoFill !== false;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && 'autoFill' in changes) {
      autoFill = changes.autoFill.newValue !== false;
    }
  });

  const seenIds = new Set();

  async function poll() {
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'GET_NONCES' });
    } catch {
      // Service worker was killed mid-flight — it will restart on next message.
      return;
    }

    if (resp.error === 'AUTH_EXPIRED') {
      clearInterval(timer);
      chrome.runtime.sendMessage({ type: 'SET_ICON', active: false }).catch(() => {});
      return;
    }
    if (resp.error) return;

    for (const nonce of resp.nonces) {
      // Filter to nonces belonging to this provider.
      if (nonce.provider_tag !== provider.tag) continue;
      if (seenIds.has(nonce.id)) continue;

      seenIds.add(nonce.id);

      if (autoFill && provider.selector) {
        const field = document.querySelector(provider.selector);
        if (field && isVisible(field)) {
          fillField(field, nonce.nonce_value);
          // Remove from server so it is not re-filled on the next poll.
          chrome.runtime.sendMessage({ type: 'DELETE_NONCE', id: nonce.id }).catch(() => {});
        }
      }
    }
  }

  // Immediate first poll then every 2 s.
  poll();
  const timer = setInterval(poll, 2000);

  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    chrome.runtime.sendMessage({ type: 'SET_ICON', active: false }).catch(() => {});
  });
})();

// ── Helpers ───────────────────────────────────────────────────────────────────

function isVisible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 &&
         window.getComputedStyle(el).visibility !== 'hidden' &&
         window.getComputedStyle(el).display    !== 'none';
}

function fillField(el, value) {
  el.focus();
  // Native input value setter — needed for React-controlled inputs.
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  if (nativeSetter) nativeSetter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ── Manual fill from popup ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'FILL_FIELD') return;
  const el = document.querySelector(msg.selector);
  if (el) {
    fillField(el, msg.value);
    sendResponse({ ok: true });
  } else {
    sendResponse({ error: 'Field not found. Check the selector in options.' });
  }
});
