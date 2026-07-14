#!/usr/bin/env bash
# Launcher for DMR-X MCP server.
# Loads .env (provider API keys) but gives the MCP server its OWN plaintext
# DB directory so it can auto-register providers without contending with the
# gateway's encrypted DB file lock (Windows exclusive lock on data.db.enc).
set -a
if [ -f .env ]; then
  sed -E 's/^[[:space:]]*export[[:space:]]+//' .env > /tmp/dmrx_env_clean.env
  source /tmp/dmrx_env_clean.env
fi
set +a

# Gateway endpoint (our gateway runs on 47113, not the default 3000)
export DMRX_GATEWAY_URL="http://127.0.0.1:47113"

# MCP server gets its OWN DB directory so it can auto-register + decrypt
# provider keys without contending with the gateway's encrypted data.db.enc
# (Windows exclusive lock). We KEEP the encryption key so the seeded API keys
# (stored encrypted by autoRegisterProviders) can be decrypted at runtime.
export DMRX_DATA_DIR="${DMRX_DATA_DIR:-$HOME/.dmr-x-mcp-data}"

export DMRX_MCP_TRANSPORT="${DMRX_MCP_TRANSPORT:-sse}"
export DMRX_MCP_PORT="${DMRX_MCP_PORT:-3100}"
export DMRX_MCP_HOST="${DMRX_MCP_HOST:-127.0.0.1}"
export DMRX_MCP_API_KEY="${DMRX_MCP_API_KEY:-test-mcp-key}"
# Allow auto-registration of providers from catalog + .env on first boot.
export DMRX_AUTO_REGISTER="${DMRX_AUTO_REGISTER:-true}"

mkdir -p "$DMRX_DATA_DIR"
cd "/c/Users/pc/Documents/projects/DMR-X/services/mcp-server"
exec bun dist/index.js
