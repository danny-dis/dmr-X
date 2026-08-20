#!/usr/bin/env bash
# Launch dmrx-mcp for live verification (isolated DB, gateway proxy for chat tools).
#
# Port comes from .env (DMRX_MCP_PORT) unless overridden:
#   MCP_PORT=47114 bash scripts/start-mcp-verify.sh
set -u
export PATH="$PATH:/c/Users/pc/.bun/bin"
cd /c/Users/pc/Documents/projects/DMR-X || exit 1

set -a; source .env; set +a

# Resolve the port: explicit override > .env > default 47114.
PORT="${MCP_PORT:-${DMRX_MCP_PORT:-47114}}"
echo "== target MCP port: $PORT =="

# Kill whatever currently OWNS the port (skill pitfall: a stale pre-fix process
# keeps the port and the new one silently fails to bind -> you test old code).
for wpid in $(netstat -ano 2>/dev/null | grep -E "TCP.*:${PORT} .*LISTENING" | awk '{print $NF}' | sort -u); do
  echo "killing port-${PORT} owner winpid $wpid"
  MSYS_NO_PATHCONV=1 taskkill -F -PID "$wpid" 2>&1 | tail -1
done
# Also kill any other bun mcp-server processes by their winpid (ps col 4).
for wpid in $(ps aux | grep -E "mcp-server" | grep -v grep | awk '{print $4}'); do
  echo "killing stale mcp winpid $wpid"; MSYS_NO_PATHCONV=1 taskkill -F -PID "$wpid" 2>&1 | tail -1
done
sleep 3
if netstat -ano 2>/dev/null | grep -qE "TCP.*:${PORT} .*LISTENING"; then
  echo "FATAL: port ${PORT} still held — refusing to start (you would test stale code)"; exit 1
fi

export DMRX_LOCAL_MODE=true
export DMRX_MCP_TRANSPORT=http
export DMRX_MCP_PORT="$PORT"
export DMRX_MCP_HOST=127.0.0.1
export DMRX_MCP_API_KEY="${DMRX_MCP_API_KEY:-test-mcp-key}"
export DMRX_GATEWAY_URL="${DMRX_GATEWAY_URL:-http://127.0.0.1:47113}"
export DMRX_DATA_DIR="$(pwd)/.dmrx-data-mcp"
mkdir -p "$DMRX_DATA_DIR"

nohup bun services/mcp-server/dist/index.js > "$LOCALAPPDATA/Temp/dmrx_mcp.log" 2>&1 &
echo "started pid $!"

# Wait for the port to actually come up rather than sleeping blindly.
# NOTE: check the HTTP status explicitly — a bare `curl -o /dev/null` can return
# a nonzero exit on a healthy server (e.g. write-out quirks), which silently
# turned a successful boot into a FATAL below.
for i in $(seq 1 30); do
  sleep 2
  code=$(curl -s -m3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/health" 2>/dev/null)
  if [ "$code" = "200" ]; then
    echo "== healthy after ${i} polls =="
    curl -s -m5 "http://127.0.0.1:${PORT}/health"; echo
    echo "== port owner =="
    netstat -ano 2>/dev/null | grep -E "TCP.*:${PORT} .*LISTENING"
    exit 0
  fi
done
echo "FATAL: ${PORT} never came up — tail of log:"
tail -20 "$LOCALAPPDATA/Temp/dmrx_mcp.log"
exit 1
