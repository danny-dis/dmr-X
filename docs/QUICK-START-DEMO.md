# DMR-X one-command demo

Spin up the full **self-hosted AI platform** — gateway + MCP tool aggregation +
a sample agent — with a single command. No API keys required to see it work
against free-tier providers (set `DMRX_FREE_TIER_STRATEGY=prioritize` below).

## What this shows

- **Gateway** (:3000) serving OpenAI / Anthropic / Gemini formats from one port.
- **MCP aggregation**: the bundled `dmrx-mcp` server proxies an external stdio
  MCP server (here, a filesystem server) into the `<serverId>__<tool>` namespace.
- **Agent platform**: a sample agent (`examples/agents/hello-researcher`) is
  installed via `dmrx agent install` so you can drive it over the API.

## Run

```bash
docker compose -f docker-compose.demo.yml up -d
# wait ~10s for the gateway to boot
curl http://localhost:3000/v1/models | head

# install the sample agent
dmrx agent install file examples/agents/hello-researcher/agent.md \
  --base-url http://localhost:3000/v1

# list aggregated MCP tools (note the filesystem__ namespace)
dmrx-mcp status   # or call the dmrx_status tool via any MCP client
```

## Configure

Copy `.env.example` and set at least one provider key, or rely on free-tier
providers + a local Ollama. Then restart the gateway container.

> The MCP server in this demo points at a sample filesystem server. To aggregate
> your own tools, edit `dmrx-mcp.config.json` (the `aggregation.servers` array) —
> changes hot-reload without a restart. See `docs/MCP.md`.

## Free-tier routing

Add to the gateway environment to prefer $0 providers:

```
DMRX_FREE_TIER_STRATEGY=prioritize
```
