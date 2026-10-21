@echo off
REM Campus Assistant - dev launcher
REM Avoids PowerShell 7 narrow-window crash and ELECTRON_RUN_AS_NODE interference.

set ELECTRON_RUN_AS_NODE=
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=

cd /d "%~dp0app"
echo Starting Campus Assistant (dev)...
call npm run dev
pause
