# noncey — Chrome Extension

Browser-side component of noncey. Polls the noncey daemon for OTP nonces and fills OTP fields automatically.

---

## 1. Usage

### Configuration

Configuration is split between the Server UI (noncey.tld/auth/) and the extension. The Server UI handles channel setup; the extension handles the fill prompt.

**On the Server UI:**

1. Navigate to `https://noncey.tld/auth/` and log in
2. Click **+ New Configuration** and follow the wizard:
   - Forward a test OTP email to your noncey address to seed the Channel setup
   - Confirm or adjust the sender/subject match rules and OTP extraction settings
3. The wizard ends when the Channel is configured; the Prompt still needs to be set

**In the extension:**

4. Navigate to the OTP login page for the service you just configured
5. Click the noncey toolbar icon — the configuration appears in the popup
6. Click **Pick** next to the configuration, then click the OTP input field on the page
7. The extension captures `{url, selector}` and sends it to the server automatically
8. Return to the Server UI and activate the configuration

### Use During Login

1. Navigate to the OTP login page — the noncey icon turns **teal** when a matching configuration is active
2. Trigger the OTP send from the service (e.g. click "Send code" or "Log in")
3. The email arrives at the daemon, the OTP is extracted, and it appears in the noncey popup within seconds
4. Click the nonce row to fill the OTP field automatically
5. With **autofill** enabled (the pill in the popup header), filling happens without a click

---

## 2. Installation as Developer

### Windows

Run the included installer from a Command Prompt opened in the root of the cloned repository:

```
install.bat
```

The script self-elevates to Administrator if needed, then copies the extension files to
`C:\Program Files\noncey\client\`.

### Loading in Chrome

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select `C:\Program Files\noncey\client\` (or this directory directly if not using the installer)

The noncey icon appears in the toolbar. After pulling updates, re-run `install.bat` and click the **↺** reload button next to noncey in `chrome://extensions`.

---

## 3. Installation as User

For end-user installation without a development environment:

1. Run `build.bat` (Windows) or `build.sh` (Linux/macOS) from the root of the repository.
   The script packages the extension files into a distributable form.
2. Load the resulting package via `chrome://extensions` → **Load unpacked** as described above.

When the extension is published to the Chrome Web Store, it can be installed directly
from the store page — no build step required.

---

## License

MIT — see [LICENSE](LICENSE).
