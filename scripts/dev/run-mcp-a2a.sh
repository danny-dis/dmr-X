#!/usr/bin/env bash
# One-shot MCP server launcher with A2A + subagent-tools enabled.
# Loads .env (for DMRX_ADMIN_API_KEY etc), sets the needed MCP flags, and
# runs the built dist. Crash-restart loop so it stays up like run-mcp-server.bat.
# Run under Bun (the project's runtime). node:sqlite is lazy-loaded only when
# a dbPath is configured, so Bun (which lacks node:sqlite) runs in-memory fine.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
source .env 2>/dev/null || true

export DMRX_MCP_AGENT_API_KEY="${DMRX_ADMIN_API_KEY:-dmrx-local}"
export DMRX_A2A_ENABLED=true
export DMRX_A2A_AGENT_URL="http://127.0.0.1:3100"
export DMRX_MCP_TRANSPORT=http
export DMRX_MCP_PORT=3100
export DMRX_MCP_HOST=127.0.0.1
export DMRX_GATEWAY_URL="http://127.0.0.1:47113"

BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting DMR-X MCP server (:3100, A2A on)..."
  "$BUN" services/mcp-server/dist/index.js >> "$ROOT/mcp-server.log" 2>&1
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] MCP exited ($?). Restarting in 3s..."
  sleep 3
done
