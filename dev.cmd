@echo off
REM Campus Assistant - dev launcher
REM Avoids PowerShell 7 narrow-window crash and ELECTRON_RUN_AS_NODE interference.

set ELECTRON_RUN_AS_NODE=
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=

cd /d "%~dp0app"
if errorlevel 1 (
  echo [ERROR] app directory not found
  pause
  exit /b 1
)

echo ============================================
echo  Campus Assistant - dev mode
echo  dir: %CD%
echo ============================================
echo.

call npm run dev
echo.
echo ============================================
echo  dev process exited with code %ERRORLEVEL%
echo  main process log: %APPDATA%\CampusAssistant\main.log
echo ============================================
pause
