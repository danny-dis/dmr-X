@echo off
REM DMR-X Gateway always-on launcher.
REM Runs the gateway in a crash-restart loop. Intended to be started by the
REM Windows Task Scheduler "DMR-X-Gateway" logon task so it survives reboots.
REM
REM Loads .env into THIS process so the gateway can resolve provider API keys
REM via api_key_ref (server.ts precedence: env var > provider_keys > legacy).
REM Without this, process.env.MISTRAL_API_KEY etc. are undefined and the gateway
REM falls back to stale keys stored in data.db -> 401 "All providers failed".
setlocal EnableDelayedExpansion
cd /d C:\Users\pc\Documents\projects\DMR-X

for /f "usebackq tokens=1* delims==" %%A in (`findstr /r /v "^#" ".env"`) do (
  set "k=%%A"
  if defined k (
    set "v=%%B"
    if /i "!k:~0,7!"=="export " set "k=!k:~7!"
    set "!k!=!v!"
  )
)

REM Boot the MCP ("MECP") server alongside DMR-X so the dmrx_* tool surface
REM (dmrx_context_*, dmrx_batch, dmrx_workflow, aggregated upstream tools) is
REM available without a separate manual start. Runs detached in its own
REM crash-restart loop. Set DMRX_SKIP_MCP=1 to boot the gateway alone.
if not defined DMRX_SKIP_MCP (
  echo [%date% %time%] Launching DMR-X MCP server (background)... >> "C:\Users\pc\Documents\projects\DMR-X\gateway.log"
  start "" /min "DMR-X MCP Server" "C:\Users\pc\Documents\projects\DMR-X\scripts\dev\run-mcp-server.bat"
)

:loop
echo [%date% %time%] Starting DMR-X gateway on port 47113... >> "C:\Users\pc\Documents\projects\DMR-X\gateway.log"
"C:\Users\pc\.bun\bin\bun.exe" apps/gateway/src/main.ts >> "C:\Users\pc\Documents\projects\DMR-X\gateway.log" 2>&1
echo [%date% %time%] Gateway exited with code %errorlevel%. Restarting in 3s... >> "C:\Users\pc\Documents\projects\DMR-X\gateway.log"
timeout /t 3 /nobreak >nul
goto loop
