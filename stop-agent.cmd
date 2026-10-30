@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0packaging\stop-agent.ps1"
if errorlevel 1 pause
