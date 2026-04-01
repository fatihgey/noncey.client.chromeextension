# noncey.client.chromeextension — CLAUDE.md

## What this is

The browser-side component of noncey. A Chrome extension (Manifest V3, vanilla JS,
no build step) that polls the noncey daemon REST API for OTP nonces and fills OTP
fields in the browser automatically or on demand.

Sibling repos:
- `C:\Claude\noncey\` — umbrella: tests, docs
- `C:\Claude\noncey.daemon\` — server daemon (REST API source of truth)

GitHub remote: https://github.com/fatihgey/noncey.client.chromeextension.git

REST API reference: `ARCHITECTURE.md §3` in `noncey.daemon`.

---

## Key files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest — permissions, service worker, content script |
| `background.js` | Service worker — JWT auth, polling loop, state, fill dispatch |
| `content.js` | Injected into every page — receives fill commands from background |
| `picker.js` | Visual picker mode — user clicks an OTP field, selector recorded |
| `popup/popup.html/js/css` | Toolbar popup — nonce list, fill button, status |
| `options/options.html/js/css` | Settings page — server URL, credentials, providers, URL rules |

---

## Storage

- `chrome.storage.sync` — server FQDN, username, JWT token, provider configs,
  URL-to-provider mappings, CSS selectors, `expires_at`
- `chrome.storage.local` — active config selection (`activeConfigName`)

---

## Polling behaviour

- Polls `GET /api/nonces` every 1–3 s when the active tab URL matches a configured
  provider URL rule.
- Toolbar icon: gray = no matching URL loaded; teal = active provider matched.
- Popup dropdown shows nonces as: `NNNN..   3m 20s` (truncated value + age).

---

## Auth flow

1. User enters server URL + credentials in options page.
2. Extension POSTs to `/api/auth/login`, stores JWT + `expires_at` in
   `chrome.storage.sync`.
3. All subsequent requests use `Authorization: Bearer <token>`.
4. Token is long-lived (30-day server-side session). Extension checks `expires_at`
   and re-prompts login if expired.

---

## No build step

Plain JS files — edit and reload directly in Chrome (`chrome://extensions` → ↺).
Do not introduce a bundler or framework without discussion.

---

## Configuration model (implemented)

Prompts are stored at the daemon (not locally). The extension:
- Fetches configs + prompts via `GET /api/configs` (background `GET_CONFIGS`)
- Captures OTP field via visual picker (`picker.js` → `PICKER_RESULT`)
- Pushes prompt to daemon via `POST /api/configs/<id>/prompt` (background `PUSH_PROMPT`)
- Reports successful fills via `POST /api/configs/<id>/client-test` (background `REPORT_TEST`)

Fill lookup: `onNonceClick` uses `configMeta` (from `GET /api/configs`) to find the
prompt for the nonce's `configuration_name`. Falls back to clipboard copy if no prompt.

Config card picker: `pendingPickerConfigId` in options.js tracks which config card
is awaiting a picker result (separate from `pendingPickerCardId` for provider cards).

---

## Commit & push policy

After every change: commit and push to GitHub.
