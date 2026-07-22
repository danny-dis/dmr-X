#!/usr/bin/env bash
# DMR-X always-on launcher (bash).
# Starts the gateway (:47113) in a crash-restart loop. MCP+A2A (:3100) and
# G0DM0D3 (:7860) are started by the gateway itself via startCompanionServices()
# after listen (see apps/gateway/src/lib/sidecar-boot.ts).
# On Windows prefer scripts/dev/run-alwayson.ps1 (run-gateway.bat).
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

LOCK="$ROOT/.dmrx-alwayson.pid"
if netstat -ano 2>/dev/null | grep -E ":47113 " | grep -q LISTEN; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Gateway already listening on :47113 — another supervisor owns it. Exiting to avoid conflict."
  exit 0
fi
for port in 47113; do
  for p in $(netstat -ano 2>/dev/null | grep -E ":$port " | grep LISTEN | awk '{print $5}' | sort -u); do
    [ "$p" != "0" ] && taskkill /PID "$p" /F >/dev/null 2>&1 || true
  done
done
sleep 1
echo "$$" > "$LOCK"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export DMRX_LOCAL_MODE="${DMRX_LOCAL_MODE:-true}"
export DMRX_GATEWAY_URL="${DMRX_GATEWAY_URL:-http://localhost:47113}"
export DMRX_GODMODE_AUTOSTART="${DMRX_GODMODE_AUTOSTART:-true}"
export DMRX_MCP_AUTOSTART="${DMRX_MCP_AUTOSTART:-true}"

if [ -f "$ROOT/scripts/dev/patch-g0dm0d3.sh" ]; then
  bash "$ROOT/scripts/dev/patch-g0dm0d3.sh" || echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: patch-g0dm0d3.sh failed (non-fatal)" >&2
fi

BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] DMR-X always-on launcher started (gateway; MCP+A2A+godmode via companion boot)"
while true; do
  if netstat -ano 2>/dev/null | grep -E ":47113 " | grep -q LISTEN; then
    sleep 3
    continue
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting DMR-X gateway on :47113..."
  ( cd "$ROOT/apps/gateway" && "$BUN" --env-file=../../.env run start ) >> "$ROOT/gateway.log" 2>&1
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Gateway exited ($?). Restarting in 3s..."
  sleep 3
done
