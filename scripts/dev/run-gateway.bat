@echo off
REM DMR-X always-on launcher entry point.
REM Starts the gateway; MCP+A2A and G0DM0D3 auto-boot as gateway companions.
REM Used by the Windows Task Scheduler "DMR-X-Gateway" logon/boot task.
setlocal
cd /d C:\Users\pc\Documents\projects\DMR-X
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-alwayson.ps1"
endlocal
