@echo off
:: OpenWhispr + Javas Plugin - Build Setup
:: No admin needed. Just double-click.

echo.
echo  OpenWhispr Build Setup
echo  ======================
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0setup-build.ps1"

echo.
pause
