@echo off
rem Runs the built app from this checkout (npm run build first).
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
