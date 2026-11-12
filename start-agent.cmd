@echo off
setlocal
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo Python environment is missing. See AGENT-README.md.
  pause
  exit /b 1
)
"%~dp0backend\.venv\Scripts\python.exe" "%~dp0packaging\run_agent.py"
if errorlevel 1 pause
