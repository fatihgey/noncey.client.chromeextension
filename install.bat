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

:: Copy popup\ and options\ subdirectories.
for %%D in (popup options) do (
    if exist "%%D\" (
        robocopy "%%D" "%DEST%\%%D" /E /NFL /NDL /NJH /NJS >nul
        echo  Copied   %%D\
    ) else (
        echo  WARNING  %%D\ not found -- skipping
        set ERRORS=1
    )
)

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
