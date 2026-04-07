@echo off
setlocal

:: =============================================================================
::  noncey Chrome Extension -- Windows installer
::  Run from the root of the noncey.client.chromeextension git clone.
::  Copies extension files to %DEST% and prints Chrome loading instructions.
:: =============================================================================

set "DEST=C:\Program Files\noncey\client"

:: Self-elevate to Administrator if not already elevated.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: Ensure we are in the script directory regardless of where cmd was opened.
cd /d "%~dp0"

echo.
echo  noncey Chrome Extension Installer
echo  ====================================
echo.
echo  Destination : %DEST%
echo  Source      : %CD%
echo.

:: Create destination directory.
if not exist "%DEST%\" (
    mkdir "%DEST%"
    if errorlevel 1 (
        echo  ERROR: Could not create %DEST%
        pause & exit /b 1
    )
)

:: Copy top-level extension files.
set ERRORS=0
for %%F in (manifest.json background.js content.js picker.js) do (
    if exist "%%F" (
        copy /Y "%%F" "%DEST%\" >nul
        echo  Copied   %%F
    ) else (
        echo  WARNING  %%F not found -- skipping
        set ERRORS=1
    )
)

:: Copy popup\, options\, and icons\ subdirectories.
for %%D in (popup options icons) do (
    if exist "%%D\" (
        robocopy "%%D" "%DEST%\%%D" /E /NFL /NDL /NJH /NJS >nul
        echo  Copied   %%D\
    ) else (
        echo  WARNING  %%D\ not found -- skipping
        set ERRORS=1
    )
)

:: ── Version injection ─────────────────────────────────────────────────────────
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

powershell -Command "$q=[char]34; $v='%FORMAL_VERSION%'; $f='%DEST%\manifest.json'; (gc $f -Raw) -replace ($q+'version'+$q+': '+$q+'[^'+$q+']+'+$q),($q+'version'+$q+': '+$q+$v+$q) | sc $f -Encoding UTF8 -NoNewline"
echo  Version  %DISPLAY_VERSION%

>"%DEST%\options\_version.js" echo window.NONCEY_DISPLAY_VERSION = '%DISPLAY_VERSION%';
echo  Wrote    options\_version.js

echo.
if "%ERRORS%"=="1" (
    echo  Installation completed with warnings -- see above.
) else (
    echo  Installation complete.
)
echo.
echo  Next steps
echo  ----------
echo  1. Open Chrome and navigate to chrome://extensions
echo  2. Enable "Developer mode"  (toggle, top-right)
echo  3. Click "Load unpacked"
echo  4. Select the folder:  %DEST%
echo.
echo  Updating
echo  --------
echo  After pulling changes, re-run this script, then click the reload
echo  button (circular arrow) next to noncey in chrome://extensions.
echo.
pause
