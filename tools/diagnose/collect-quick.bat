@echo off
setlocal
echo CampusAssistant quick diagnostics (no monitoring)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect.ps1" -Minutes 0
pause