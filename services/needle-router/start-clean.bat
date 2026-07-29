@echo off
setlocal
cd /d "%~dp0"

:: Unset Hermes contamination from this process
set "PYTHONPATH="
set "PYTHONHOME="

:: Use the exact venv python
"C:\Users\pc\Documents\projects\DMR-X\services\needle-router\.venv\Scripts\python.exe" "C:\Users\pc\Documents\projects\DMR-X\services\needle-router\server.py"
pause
