@echo off
REM DMR-X always-on launcher entry point.
REM Delegates to the robust bash launcher (scripts/dev/run-alwayson.sh) which
REM runs the gateway (:47113) and MCP server (:3100) in crash-restart loops.
REM Started by the Windows Task Scheduler "DMR-X-Gateway" logon task.
setlocal
cd /d C:\Users\pc\Documents\projects\DMR-X
if exist "%USERPROFILE%\.bun\bin\bun.exe" (set "BUN=%USERPROFILE%\.bun\bin\bun.exe")
if not defined BUN (set "BUN=bun")
"%BUN%" scripts/dev/run-alwayson.sh
endlocal
