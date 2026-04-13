// noncey — content script
// Injected into every page. Checks if the URL matches a configured provider
// (old-style, from chrome.storage.sync.providers) OR a config prompt URL
// (new-style, from GET /api/configs). If matched, polls the noncey API and
// auto-fills OTP fields on arrival.
// Also handles manual fill requests from the popup.

'use strict';

// ── URL matching (mirrors popup.js logic) ─────────────────────────────────────

function urlMatchesPrompt(url, prompt) {
  if (!prompt?.url) return false;
  switch (prompt.url_match) {
    case 'exact': return url === prompt.url;
    case 'regex': try { return new RegExp(prompt.url).test(url); } catch { return false; }
    default:      return url.startsWith(prompt.url);  // 'prefix' / fallback
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async function main() {
  const storage = await chrome.storage.sync.get(['providers', 'token', 'autoFill']);
  if (!storage.token) return;

  const url       = window.location.href;
  const providers = storage.providers || [];

  // Old-style: match by url_pattern substring
  const providerMatch = providers.find(p => p.url_pattern && url.includes(p.url_pattern));

  // New-style: fetch configs from background and match by prompt URL
  let configMeta   = [];
  let configMatch  = null;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_CONFIGS' });
    if (!resp.error && resp.configs) {
      configMeta  = resp.configs;
      configMatch = configMeta.find(c => c.prompt && urlMatchesPrompt(url, c.prompt));
    }
  } catch {
    // Service worker was sleeping and could not respond — it will wake on the
    // next poll cycle and the match will be re-evaluated there.
  }

  if (!providerMatch && !configMatch) return;

  // Tell the service worker to show the active (coloured) icon for this tab.
  chrome.runtime.sendMessage({ type: 'SET_ICON', active: true }).catch(() => {});

  // Track autoFill and activeConfigName reactively.
  let autoFill = storage.autoFill !== false;
  const localInit = await chrome.storage.local.get('activeConfigName');
  let activeConfigName = localInit.activeConfigName ?? null;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && 'autoFill' in changes) {
      autoFill = changes.autoFill.newValue !== false;
    }
    if (area === 'local' && 'activeConfigName' in changes) {
      activeConfigName = changes.activeConfigName.newValue ?? null;
    }
  });

  const seenIds = new Set();

  // Return the CSS selector to use for a given nonce, or null if none.
  function getSelectorForNonce(nonce) {
    // New-style: look up by configuration_name in configMeta
    const meta = configMeta.find(c => c.name === nonce.configuration_name);
    if (meta?.prompt?.selector) return meta.prompt.selector;
    // Old-style fallback: use the matched provider's selector
    if (providerMatch?.selector) return providerMatch.selector;
    return null;
  }

  // Return the fill strategy for a given nonce ('per_slot' | 'paste' | 'simple').
  function getFillStrategyForNonce(nonce) {
    const meta = configMeta.find(c => c.name === nonce.configuration_name);
    return meta?.prompt?.fill_strategy || 'simple';
  }

  // Return true if this nonce is relevant to the current page match.
  function isRelevant(nonce) {
    if (configMatch && nonce.configuration_name === configMatch.name) return true;
    if (providerMatch && nonce.provider_tag === providerMatch.tag) return true;
    return false;
  }

  async function poll() {
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'GET_NONCES' });
    } catch {
      // Service worker was killed mid-flight — will restart on next message.
      return;
    }

    if (resp.error === 'AUTH_EXPIRED') {
      clearInterval(timer);
      chrome.runtime.sendMessage({ type: 'SET_ICON', active: false }).catch(() => {});
      return;
    }
    if (resp.error) return;

    for (const nonce of resp.nonces) {
      if (!isRelevant(nonce)) continue;
      // Respect active config selection (null = show all).
      if (activeConfigName !== null && nonce.configuration_name !== activeConfigName) continue;
      if (seenIds.has(nonce.id)) continue;

      seenIds.add(nonce.id);

      if (autoFill) {
        const selector = getSelectorForNonce(nonce);
        const strategy = getFillStrategyForNonce(nonce);
        if (selector) {
          const field = document.querySelector(selector);
          if (field && isVisible(field)) {
            fillField(field, nonce.nonce_value, strategy);
            // Remove from server so it is not re-filled on the next poll.
            chrome.runtime.sendMessage({ type: 'DELETE_NONCE', id: nonce.id }).catch(() => {});
          }
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

// Fill a single input with a value, using the React-compatible native setter
// and a proper InputEvent (with data property) so frameworks can read the typed char.
function _fillSingle(el, value) {
  el.focus();
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  if (nativeSetter) nativeSetter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new InputEvent('input',  { data: value, inputType: 'insertText', bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillField(el, value, strategy = 'simple') {
  if (strategy === 'per_slot') {
    // Option A — Per-Slot Siblings Detection.
    // Detect all visible input[autocomplete="one-time-code"] elements on the page.
    // If there are N slots and the nonce is N digits long, fill slot i with value[i]
    // — completely bypassing auto-advance events.
    const otcSlots = Array.from(
      document.querySelectorAll('input[autocomplete="one-time-code"]')
    ).filter(isVisible);
    if (otcSlots.length > 1 && value.length === otcSlots.length) {
      otcSlots.forEach((slot, i) => _fillSingle(slot, value[i]));
      return;
    }
    // Assertion failed (page layout changed or no OTC slots found) — fall through.

  } else if (strategy === 'paste') {
    // Option B — Paste Simulation.
    // Dispatch a paste ClipboardEvent on the first field carrying the full OTP in
    // clipboardData. OTC components that implement paste distribution handle it natively.
    const dt = new DataTransfer();
    dt.setData('text/plain', value);
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    }));
    return;
  }

  // Option C — Simple Input (default and per_slot fallback).
  // Set the field value via the native input setter and dispatch an InputEvent
  // with the data property set — compatible with React-controlled single-field inputs.
  _fillSingle(el, value);
}

// ── Manual fill from popup ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'FILL_FIELD') return;
  const el = document.querySelector(msg.selector);
  if (el) {
    fillField(el, msg.value, msg.fill_strategy || 'simple');
    sendResponse({ ok: true });
  } else {
    sendResponse({ error: 'Field not found. Check the selector in options.' });
  }
});
