@echo off
setlocal enabledelayedexpansion
set OUT=%~dp0diagnose-report.txt
cd /d "%~dp0app"

echo ===== Campus Assistant diagnose ===== > "%OUT%"
echo [1] time >> "%OUT%"
date /t >> "%OUT%"
time /t >> "%OUT%"

echo. >> "%OUT%"
echo [2] ELECTRON_RUN_AS_NODE=[%ELECTRON_RUN_AS_NODE%] >> "%OUT%"

echo. >> "%OUT%"
echo [3] electron version file: >> "%OUT%"
type node_modules\electron\dist\version >> "%OUT%" 2>&1
echo [3b] electron.exe info: >> "%OUT%"
dir node_modules\electron\dist\electron.exe >> "%OUT%" 2>&1

echo. >> "%OUT%"
echo [4] run: electron.exe --version >> "%OUT%"
node_modules\electron\dist\electron.exe --version >> "%OUT%" 2>&1
echo [4b] exit code = %ERRORLEVEL% >> "%OUT%"

echo. >> "%OUT%"
echo [5] run: electron.exe . --enable-logging --v=1 (10s timeout) >> "%OUT%"
set ELECTRON_RUN_AS_NODE=
node_modules\electron\dist\electron.exe . --enable-logging --v=1 >> "%OUT%" 2>&1
echo [5b] exit code = %ERRORLEVEL% >> "%OUT%"

echo. >> "%OUT%"
echo [6] main.log (if any): >> "%OUT%"
type "%APPDATA%\CampusAssistant\main.log" >> "%OUT%" 2>&1

echo. >> "%OUT%"
echo [7] electron debug.log (if any): >> "%OUT%"
type "%APPDATA%\CampusAssistant\electron_debug.log" >> "%OUT%" 2>&1

echo. >> "%OUT%"
echo [8] done >> "%OUT%"

echo.
echo Report written to: %OUT%
type "%OUT%"
pause
