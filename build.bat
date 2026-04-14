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

setlocal

set OUT=noncey.zip

:: ── Version ────────────────────────────────────────────────────────────────────
:: for /f pipes break with the Git for Windows launcher in elevated cmd sessions;
:: write to temp files and read back with set /p instead.
set "GIT_TAG="
set "GIT_HASH="
git describe --tags --abbrev=0 > "%TEMP%\noncey_tag.tmp" 2>nul
set /p GIT_TAG= < "%TEMP%\noncey_tag.tmp"
del "%TEMP%\noncey_tag.tmp" 2>nul
git rev-parse --short HEAD > "%TEMP%\noncey_hash.tmp" 2>nul
set /p GIT_HASH= < "%TEMP%\noncey_hash.tmp"
del "%TEMP%\noncey_hash.tmp" 2>nul

if "%GIT_TAG%"=="" set "GIT_TAG=1.0.0"
if "%GIT_HASH%"=="" set "GIT_HASH=unknown"

set "FORMAL_VERSION=%GIT_TAG%"
if "%FORMAL_VERSION:~0,1%"=="v" set "FORMAL_VERSION=%FORMAL_VERSION:~1%"
set "DISPLAY_VERSION=%FORMAL_VERSION%+%GIT_HASH%"

echo Version: %DISPLAY_VERSION%

:: ── Patch manifest.json (backup → patch → restore after zip) ──────────────────
copy /Y manifest.json "%TEMP%\noncey_manifest_backup.tmp" >nul
powershell -NoProfile -Command "$q=[char]34; $v='%FORMAL_VERSION%'; $f='manifest.json'; (gc $f -Raw) -replace ($q+'version'+$q+': '+$q+'[^'+$q+']+'+$q),($q+'version'+$q+': '+$q+$v+$q) | sc $f -Encoding UTF8 -NoNewline"

:: ── Write options\_version.js (removed after zip) ─────────────────────────────
>options\_version.js echo window.NONCEY_DISPLAY_VERSION = '%DISPLAY_VERSION%';

:: ── Zip ───────────────────────────────────────────────────────────────────────
if exist "%OUT%" del "%OUT%"

powershell -NoProfile -Command ^
  "Compress-Archive -Path manifest.json, background.js, content.js, picker.js, popup, options -DestinationPath '%OUT%'"

:: ── Restore source tree ───────────────────────────────────────────────────────
copy /Y "%TEMP%\noncey_manifest_backup.tmp" manifest.json >nul
del "%TEMP%\noncey_manifest_backup.tmp"
del options\_version.js 2>nul

echo Built: %OUT%

:: ── Phase 1: versioned artifact + INI ─────────────────────────────────────
set "FILE_VERSION=%FORMAL_VERSION%-%GIT_HASH%"
set "VERSIONED_ZIP=noncey-chromeext-v%FILE_VERSION%.zip"
set "VERSIONED_INI=noncey-chromeext-v%FILE_VERSION%.ini"

copy /Y "%OUT%" "%VERSIONED_ZIP%" >nul
echo Versioned: %VERSIONED_ZIP%

powershell -NoProfile -Command "[DateTime]::Now.ToString('yyyy-MM-ddTHH:mm:sszzz')" > "%TEMP%\noncey_time.tmp"
set /p BUILD_TIME= < "%TEMP%\noncey_time.tmp"
del "%TEMP%\noncey_time.tmp" 2>nul
echo [main]> "%VERSIONED_INI%"
echo version=%FILE_VERSION%>> "%VERSIONED_INI%"
echo modified=%BUILD_TIME%>> "%VERSIONED_INI%"

:: ── Phase 2: upload ────────────────────────────────────────────────────────
set "REMOTE_HOST=root@sigma.geneso.de"
set "REMOTE_DIR=/home_web/r-programming.de/wwwroot/download"
echo Uploading %VERSIONED_ZIP% to %REMOTE_HOST%...
echo plink %REMOTE_HOST% -batch "mkdir -p %REMOTE_DIR%"
plink %REMOTE_HOST% -batch "mkdir -p %REMOTE_DIR%"
echo pscp -batch "%VERSIONED_ZIP%" "%REMOTE_HOST%:%REMOTE_DIR%/"
pscp -batch "%VERSIONED_ZIP%" "%REMOTE_HOST%:%REMOTE_DIR%/"
if %ERRORLEVEL% neq 0 ( echo ERROR: Upload of ZIP failed. & exit /b 1 )
echo pscp -batch "%VERSIONED_INI%" "%REMOTE_HOST%:%REMOTE_DIR%/"
pscp -batch "%VERSIONED_INI%" "%REMOTE_HOST%:%REMOTE_DIR%/"
if %ERRORLEVEL% neq 0 ( echo ERROR: Upload of INI failed. & exit /b 1 )
echo plink -batch %REMOTE_HOST% "cd %REMOTE_DIR% && ln -sf %VERSIONED_ZIP% noncey-chromeext.zip && ln -sf %VERSIONED_INI% noncey-chromeext.ini"
plink -batch %REMOTE_HOST% "cd %REMOTE_DIR% && ln -sf %VERSIONED_ZIP% noncey-chromeext.zip && ln -sf %VERSIONED_INI% noncey-chromeext.ini"
if %ERRORLEVEL% neq 0 ( echo ERROR: Symlink update failed. & exit /b 1 )
echo Uploaded and published as %VERSIONED_ZIP%.
