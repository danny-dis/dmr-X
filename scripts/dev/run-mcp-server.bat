@echo off
REM DMR-X MCP ("MECP") server always-on launcher.
REM Runs the MCP server in a crash-restart loop so it boots alongside DMR-X
REM and stays up. Started by run-gateway.bat (background) and/or its own
REM Task Scheduler task.
REM
REM Transport: streamable HTTP on 127.0.0.1:3100 (no auth token for LOCAL_MODE
REM dev). Exposes /mcp, /health, /tools.
REM
REM .env is loaded so adapter API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, ...)
REM resolve for the MCP server's own router/tool backend.
setlocal EnableDelayedExpansion
cd /d C:\Users\pc\Documents\projects\DMR-X

for /f "usebackq tokens=1* delims== " %%A in (`findstr /r /v "^#" ".env"`) do (
  set "k=%%A"
  if defined k (
    set "v=%%B"
    if /i "!k:~0,7!"=="export " set "k=!k:~7!"
    set "!k!=!v!"
  )
)

:loop
echo [%date% %time%] Starting DMR-X MCP server on port 3100 (http)... >> "C:\Users\pc\Documents\projects\DMR-X\mcp-server.log"
set "DMRX_MCP_TRANSPORT=http"
set "DMRX_MCP_PORT=3100"
set "DMRX_MCP_HOST=127.0.0.1"
REM Expose subagents as dmrx_agent_* MCP tools + enable the A2A agent door.
if not defined DMRX_MCP_AGENT_API_KEY set "DMRX_MCP_AGENT_API_KEY=%DMRX_ADMIN_API_KEY%"
if not defined DMRX_MCP_AGENT_API_KEY set "DMRX_MCP_AGENT_API_KEY=dmrx-local"
set "DMRX_A2A_ENABLED=true"
set "DMRX_A2A_AGENT_URL=http://127.0.0.1:3100"
"C:\Users\pc\.bun\bin\bun.exe" services/mcp-server/dist/index.js >> "C:\Users\pc\Documents\projects\DMR-X\mcp-server.log" 2>&1
echo [%date% %time%] MCP server exited with code %errorlevel%. Restarting in 3s... >> "C:\Users\pc\Documents\projects\DMR-X\mcp-server.log"
timeout /t 3 /nobreak >nul
goto loop
