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
set "GIT_TAG="
set "GIT_HASH="
for /f "tokens=*" %%i in ('git describe --tags --abbrev=0 2^>nul') do set "GIT_TAG=%%i"
for /f "tokens=*" %%i in ('git rev-parse --short HEAD 2^>nul') do set "GIT_HASH=%%i"

if "%GIT_TAG%"=="" set "GIT_TAG=1.0.0"
if "%GIT_HASH%"=="" set "GIT_HASH=unknown"

set "FORMAL_VERSION=%GIT_TAG%"
if "%FORMAL_VERSION:~0,1%"=="v" set "FORMAL_VERSION=%FORMAL_VERSION:~1%"

set "DISPLAY_VERSION=%FORMAL_VERSION%+%GIT_HASH%"

powershell -Command "(Get-Content '%DEST%\manifest.json' -Raw) -replace '\"version\": \"[^\"]+\"', '\"version\": \"%FORMAL_VERSION%\"' | Set-Content '%DEST%\manifest.json' -Encoding UTF8 -NoNewline"
echo  Version  %DISPLAY_VERSION%

powershell -Command "Set-Content -Path '%DEST%\_version.js' -Value \"window.NONCEY_DISPLAY_VERSION = '%DISPLAY_VERSION%';\" -Encoding UTF8"
echo  Wrote    _version.js

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
