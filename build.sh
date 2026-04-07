#!/usr/bin/env bash
# Build script — packages the extension for Chrome Web Store submission.
#
# SUBMISSION STEPS (after running this script):
#
# Step 1: Go to https://chrome.google.com/webstore/devconsole
#         Pay the one-time $5 developer registration fee if not already done.
#
# Step 2: Upload noncey.zip, fill in the listing details, and set visibility
#         to "Unlisted" so the extension is only accessible via direct link
#         (not publicly searchable).
#
# Step 3: Submit for review. Google reviews new extensions; expect 1-3 business days.
#
# NOTE on host_permissions: the manifest uses "<all_urls>" which triggers scrutiny
# during review. Be prepared to justify it — the extension needs to inject content
# scripts and fill OTP fields on arbitrary user-configured URLs, which is the
# legitimate purpose. Have a clear description ready for the review notes field.

set -e

OUT="noncey.zip"

# ── Version ────────────────────────────────────────────────────────────────────
GIT_TAG=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "1.0.0")
GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
FORMAL_VERSION="${GIT_TAG}"
DISPLAY_VERSION="${FORMAL_VERSION}+${GIT_HASH}"

echo "Version: ${DISPLAY_VERSION}"

# ── Patch manifest.json (backup → patch → restore after zip) ──────────────────
cp manifest.json /tmp/noncey_manifest_backup.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${FORMAL_VERSION}\"/" manifest.json

# ── Write options/_version.js (removed after zip) ─────────────────────────────
echo "window.NONCEY_DISPLAY_VERSION = '${DISPLAY_VERSION}';" > options/_version.js

# ── Zip ───────────────────────────────────────────────────────────────────────
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background.js \
  content.js \
  picker.js \
  popup/ \
  options/

# ── Restore source tree ───────────────────────────────────────────────────────
cp /tmp/noncey_manifest_backup.json manifest.json
rm -f /tmp/noncey_manifest_backup.json options/_version.js

echo "Built: $OUT"
