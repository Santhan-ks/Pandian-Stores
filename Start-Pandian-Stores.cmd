@echo off
setlocal
title Pandian Stores - Start local demo

powershell.exe -NoProfile -File "%~dp0scripts\start-demo.ps1"
set "PANDIAN_START_RESULT=%ERRORLEVEL%"

echo.
if /i not "%~1"=="--no-pause" pause
exit /b %PANDIAN_START_RESULT%
