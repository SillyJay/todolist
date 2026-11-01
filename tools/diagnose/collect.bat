@echo off
setlocal
set MIN=%~1
if "%MIN%"=="" set MIN=5
echo ============================================
echo  CampusAssistant Diagnostic Collector
echo  Duration: %MIN% minute(s)   (0 = collect only)
echo ============================================
echo.
echo Please keep CampusAssistant RUNNING while this runs.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect.ps1" -Minutes %MIN%
echo.
echo If a zip was created on your Desktop, send it to the developer.
pause