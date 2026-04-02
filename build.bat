@echo off
:: Build script — packages the extension for Chrome Web Store submission.
::
:: SUBMISSION STEPS (after running this script):
::
:: Step 1: Go to https://chrome.google.com/webstore/devconsole
::         Pay the one-time $5 developer registration fee if not already done.
::
:: Step 2: Upload noncey.zip, fill in the listing details, and set visibility
::         to "Unlisted" so the extension is only accessible via direct link
::         (not publicly searchable).
::
:: Step 3: Submit for review. Google reviews new extensions; expect 1-3 business days.
::
:: NOTE on host_permissions: the manifest uses "<all_urls>" which triggers scrutiny
:: during review. Be prepared to justify it — the extension needs to inject content
:: scripts and fill OTP fields on arbitrary user-configured URLs, which is the
:: legitimate purpose. Have a clear description ready for the review notes field.

set OUT=noncey.zip

if exist "%OUT%" del "%OUT%"

powershell -NoProfile -Command ^
  "Compress-Archive -Path manifest.json, background.js, content.js, picker.js, popup, options -DestinationPath '%OUT%'"

echo Built: %OUT%
