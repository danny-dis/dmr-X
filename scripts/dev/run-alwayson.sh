#!/usr/bin/env bash
# DMR-X always-on launcher (bash). Runs the gateway (:47113) and the MCP
# server (:3100) each in a crash-restart loop. Intended to be started by the
# Windows Task Scheduler "DMR-X-Gateway" logon task (via run-gateway.bat) and
# also directly for manual/debug use. Auto-restart on crash is built in.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

# Load .env so provider API keys (api_key_ref) resolve for both processes.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Ensure the gateway-proxy + free-provider spread env is present.
export DMRX_LOCAL_MODE="${DMRX_LOCAL_MODE:-true}"
export DMRX_FREE_PROVIDERS="${DMRX_FREE_PROVIDERS:-openrouter-free,codestral-free,google,mistral,deepseek,tencent,nvidia-nim,routeway,ovhcloud}"
export DMRX_GATEWAY_URL="${DMRX_GATEWAY_URL:-http://localhost:47113}"

BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"

# MCP server runs the built dist (rebuild with: bunx tsc -b in services/mcp-server)
start_mcp() {
  while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting DMR-X MCP server on :3100 (http)..."
    DMRX_MCP_TRANSPORT=http DMRX_MCP_PORT=3100 DMRX_MCP_HOST=127.0.0.1 \
      DMRX_DATA_DIR="$ROOT/.dmrx-data-mcp" \
      "$BUN" services/mcp-server/dist/index.js >> "$ROOT/mcp-server.log" 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] MCP exited ($?). Restarting in 3s..."
    sleep 3
  done
}

# Gateway
start_gateway() {
  while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting DMR-X gateway on :47113..."
    # Run via `bun run start` from apps/gateway so .env loads through --env-file
    # (provider keys resolve) and the G0DM0D3 child spawns the same way as a
    # manual `bun run start` (its auto-boot relies on Bun's spawn + warmed
    # bunx cache). Running main.ts directly here worked inconsistently for the
    # child process, so we mirror the documented start command.
    ( cd "$ROOT/apps/gateway" && "$BUN" --env-file=../../.env run start ) >> "$ROOT/gateway.log" 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Gateway exited ($?). Restarting in 3s..."
    sleep 3
  done
}

echo "[$(date '+%Y-%m-%d %H:%M:%S')] DMR-X always-on launcher started (gateway + mcp)"
start_mcp &
start_gateway &
wait
