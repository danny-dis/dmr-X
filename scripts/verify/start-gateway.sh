#!/usr/bin/env bash
set -a
# Load persisted encryption key + admin key
EK_FILE="/tmp/dmrx-ek.txt"
if [ -f "$EK_FILE" ]; then EK=$(cat "$EK_FILE"); fi
export DMRX_LOCAL_MODE=true
export DMRX_ADMIN_API_KEY="${DMRX_ADMIN_API_KEY:-$(openssl rand -hex 32)}"
export DMRX_ENCRYPTION_KEY="$EK"
export PORT=3000
export DMRX_DATA_DIR="C:/dmrx-data"
# Large timeout so heavy GitHub imports (hundreds of .md files) complete
# over a single HTTP request instead of being killed at the default 60s.
export DMRX_REQUEST_TIMEOUT=600000
export DMRX_KEEPALIVE_TIMEOUT=600000
cd "C:\Users\pc\Documents\projects\DMR-X"
exec bun run --cwd apps/gateway start
