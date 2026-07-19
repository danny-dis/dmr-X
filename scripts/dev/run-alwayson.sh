#!/usr/bin/env bash
# DMR-X always-on launcher (bash). Runs the gateway (:47113) and the MCP
# server (:3100) each in a crash-restart loop. Intended to be started by the
# Windows Task Scheduler "DMR-X-Gateway" logon task (via run-gateway.bat) and
# also directly for manual/debug use. Auto-restart on crash is built in.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

# ── Single-instance guard ──────────────────────────────────────────────────
# Kill any previous alwayson loop (and whatever holds our ports) BEFORE we
# spawn children. Without this, every restart/launch leaves an orphaned loop
# that fights the new one for :47113/:3100 and SIGTERMs the gateway (flapping).
LOCK="$ROOT/.dmrx-alwayson.pid"
# Never run two supervisors. If a gateway is already listening on :47113,
# another supervisor owns it — yield instead of starting a competing loop
# (two loops clearing each other's ports is what caused the crash/restart flap).
if netstat -ano 2>/dev/null | grep -E ":47113 " | grep -q LISTEN; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Gateway already listening on :47113 — another supervisor owns it. Exiting to avoid conflict."
  exit 0
fi
# Defensive: clear any stale process still bound to our ports (e.g. a dead
# loop's orphaned child), then take ownership.
for port in 47113 3100; do
  for p in $(netstat -ano 2>/dev/null | grep -E ":$port " | grep LISTEN | awk '{print $5}' | sort -u); do
    [ "$p" != "0" ] && taskkill /PID "$p" /F >/dev/null 2>&1 || true
  done
done
sleep 1
echo "$$" > "$LOCK"

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

# Ensure the vendored G0DM0D3 proxy has the DMR-X relay patches applied.
# The .dmrx-data/ dir is gitignored, so a fresh clone ships the upstream
# (unpatched) proxy. This is idempotent — safe to run every boot.
if [ -f "$ROOT/scripts/dev/patch-g0dm0d3.sh" ]; then
  bash "$ROOT/scripts/dev/patch-g0dm0d3.sh" || echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: patch-g0dm0d3.sh failed (non-fatal)" >&2
fi

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
    # Don't spawn a competing gateway if one is already up (e.g. a sibling
    # supervisor brought it back during a crash window). Just wait.
    if netstat -ano 2>/dev/null | grep -E ":47113 " | grep -q LISTEN; then
      sleep 3
      continue
    fi
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
