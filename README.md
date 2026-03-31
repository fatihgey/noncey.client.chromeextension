# noncey — Chrome Extension

Browser-side component of noncey. Polls the noncey daemon for OTP nonces and fills OTP fields automatically.

## Loading the extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select this directory (`noncey.client.chromeextension/`)

The noncey icon appears in the toolbar. Reload it here after any code change (↺ button).

## First-time setup

1. Click the noncey toolbar icon → **Open Settings** (or navigate to `chrome://extensions` → noncey → **Details** → **Extension options**)
2. Enter your **Server URL** — e.g. `https://nonces.yourdomain.com`
3. Enter your **Username** and **Password**, then click **Log in**
   - The password is used once to obtain a JWT session token and is never stored
4. Under **Providers**, click **+ Add provider** and fill in:
   - **Tag** — must match the provider tag in the noncey admin UI
   - **URL pattern** — the extension activates on any tab URL containing this string (e.g. `github.com/sessions/two-factor`)
   - **OTP field selector** — CSS selector for the OTP input, or click **Pick** to select it visually on the target tab
5. Click **Save changes**

## Using the extension

- Navigate to a page whose URL matches a configured provider — the icon turns **teal**
- Click the icon to open the popup; incoming nonces appear as clickable rows
- Click a nonce to fill the OTP field automatically (or copy to clipboard if no selector is configured)
- The **auto** pill in the header toggles automatic fill on/off

## Configuration prompts (optional)

Under **Configurations** in Settings, you can store a fill prompt per server configuration. A prompt is a CSS selector or fill instructions used when auto-filling. Once saved, the daemon is notified (`prompt_assigned` flag) so other users browsing the marketplace can see a prompt is available.

## Reloading after changes

After editing any JS/HTML/CSS file, go to `chrome://extensions` and click the **↺** reload button next to noncey. No build step is needed.
