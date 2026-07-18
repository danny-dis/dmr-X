# DMR-X Quick Start — Single API Key for All Capabilities

One API key provides access to **all providers, all modalities, all wire formats,
and every DMR-X service**: routing, AaaS agents, MCP tools, Godmode, and the
admin surface.

## 0. Install

### From Source

```bash
# Clone
git clone https://github.com/dmr-x/dmr-x.git
cd dmr-x

# Dependencies
bun install

# Provider keys (REQUIRED for actual generation)
cp .env.example .env
# Edit .env and set at least one upstream provider key, e.g. OPENAI_API_KEY,
# ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, etc.
# To run $0-only without billing, see the free-tier section in Routing.
```

### Binary

```bash
# Linux / macOS
curl -sL https://github.com/dmr-x/dmr-x/releases/latest/download/dmrx-linux-x64.tar.gz | tar xz
./dmrx

# Windows
# Download dmrx-windows-x64.zip from Releases, extract, run dmrx.exe
```

### Docker / Docker Compose Demo

```bash
docker compose up -d
# Gateway is at http://localhost:3000
# UI at http://localhost:3000

# Demo stack (free-tier providers + sample agent + MCP aggregation)
docker compose -f docker-compose.demo.yml up -d
# Gateway :3000
# UI :3000
# dmrx-mcp SSE endpoint :3100
```

## 1. Run Gateway and UI

```bash
# Dev gateway only (Fastify :3000)
bun run dev:gateway

# Dev UI only (Vite :4200, proxies /v1/* to :3000)
bun run dev:ui

# Production
bun run build
bun run start

# Windows single executable
# apps/gateway package.json: bun run build:exe
bun --cwd apps/gateway run build:exe
```

Verify health:

```bash
# Models list / health
curl http://localhost:3000/v1/models | head

# Free-tier providers report
curl -s http://localhost:3000/v1/models | python - <<'PY'
import sys, json
for m in json.load(sys.stdin).get('data', []):
    if ':free' in m.get('id', ''):
        print(m['id'])
PY
```

## 2. Create Tenant and API Key

```bash
# 1. Create tenant
curl -s -X POST http://localhost:3000/v1/admin/tenants \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{"name": "acme-corp"}'
# → returns { id, name, ... } — save tenant id

# 2. Create tenant-scoped API key
curl -s -X POST http://localhost:3000/v1/admin/api-keys \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": "<tenant-id>", "name": "Production", "scopes": ["chat","images","audio","mcp"]}'
# → returns { key, ... } — key is shown only once

# 3. Use the tenant key for everything below.
#    In local dev mode (DMRX_LOCAL_MODE=true) admin routes are open without an
#    admin key; a single tenant key still gates tenant-scoped generation.
```

> **Admin UI notes:** The React/Vite admin dashboard at `http://localhost:3000` lets
> you manage providers, models, tenants, keys, policies, quotas, requests,
> benchmarking, and usage without curl. Reach it directly after
> `bun run dev:gateway` or `docker compose up -d`.

## 3. Routing Quick Examples

DMR-X dynamically selects the best provider or matches a meta-model alias.

### Meta-model aliases

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ***" \
  -d '{"model": "auto-coding", "messages": [{"role":"user","content":"Write sorting in TS"}]}'

curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ***" \
  -d '{"model": "auto-smart", "messages": [{"role":"user","content":"What is entropy?"}]}'
```

### Free-tier routing strategies

| Strategy | Behavior |
|----------|----------|
| `none` | Ignore free-tier status; select by cost/latency/quality |
| `prioritize` | Prefer free-tier providers when available |
| `load_balance` | Distribute load across free-tier providers |
| `fallback` | Use free-tier first, fall back to paid if unavailable |

Env var:

```bash
export DMRX_FREE_TIER_STRATEGY=prioritize
```

Per-request override:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ***" \
  -H "X-Free-Tier-Strategy: prioritize" \
  -d '{"model":"auto-fast","messages":[{"role":"user","content":"Hey"}]}'
```

### Provider preference / blacklist / local-first / privacy

```bash
# Use providers in order; exclude providers; prefer local Ollama
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ***" \
  -H "X-Provider-Preference: ollama,deepseek,xai" \
  -H "X-Provider-Blacklist: openai,anthropic" \
  -H "X-Local-First: true" \
  -H "X-Require-Privacy: true" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'
```

## 4. Agent-as-a-Service (AaaS) Quickstart

This section assumes the gateway is running at `http://localhost:3000/v1`.

### 4.1 Install an agent

Markdown file:

```bash
dmrx agent install file ./agent.md \
  --base-url http://localhost:3000/v1 \
  --admin-key ***
```

GitHub repo:

```bash
dmrx agent install github https://github.com/acme/agents \
  --base-url http://localhost:3000/v1 \
  --admin-key ***
```

ZIP / marketplace:

```bash
curl -X POST http://localhost:3000/v1/agents/import \
  -H "Authorization: Bearer ***" \
  -F "file=@agent.zip"

# or marketplace
curl -X POST http://localhost:3000/v1/marketplace/<id>/install \
  -H "Authorization: Bearer ***"

# list installed agents
curl http://localhost:3000/v1/agents \
  -H "Authorization: Bearer ***"

curl http://localhost:3000/v1/agents/<agent-id> \
  -H "Authorization: Bearer ***"
```

Sample agent template location: `examples/agents/hello-researcher/agent.md`.

### 4.2 Agent chat

```bash
curl -X POST http://localhost:3000/v1/agent-chat \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"<agent-id>","messages":[{"role":"user","content":"Summarize today's top AI news"}]}'
```

### 4.3 Resume a conversation

Reuse a `conversation_id` from a prior agent chat.

```bash
curl -X POST http://localhost:3000/v1/agent-chat \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id":"<agent-id>",
    "conversation_id":"<prior-conversation-id>",
    "messages":[{"role":"user","content":"Follow up with a deeper dive"}]
  }'
```

For plain chat resumes, resend prior `messages` plus the new turn:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ***" \
  -d '{
    "model":"auto-smart",
    "messages":[
      {"role":"user","content":"First message"},
      {"role":"assistant","content":"Prior reply"},
      {"role":"user","content":"What about pricing?"}
    ],
    "conversation_id":"<prior-conversation-id>"
  }'
```

### 4.4 Inspect executions and evaluations

```bash
# Executions list
curl http://localhost:3000/v1/admin/executions \
  -H "Authorization: Bearer ***"

# Single execution
curl http://localhost:3000/v1/admin/executions/<execution-id> \
  -H "Authorization: Bearer ***"

# Evaluations list
curl http://localhost:3000/v1/admin/evaluations \
  -H "Authorization: Bearer ***"

# Single evaluation
curl http://localhost:3000/v1/admin/evaluations/<evaluation-id> \
  -H "Authorization: Bearer ***"
```

## 5. MCP Quickstart

DMR-X exposes its routing as MCP tools and can aggregate external MCP servers.

### 5.1 Run the MCP server

```bash
# Install and build MCP service
bun --cwd services/mcp-server install
bun --cwd services/mcp-server run build
bun --cwd services/mcp-server run start
```

### 5.2 Choose transport

```bash
# stdio (Claude Code / Cursor / local tools)
env DMRX_MCP_TRANSPORT=stdio \
    DMRX_MCP_API_KEY=dmrx-mcp-*** \
    bun --cwd services/mcp-server run start

# SSE (web apps)
env DMRX_MCP_TRANSPORT=sse \
    DMRX_MCP_PORT=3100 \
    DMRX_MCP_API_KEY=dmrx-mcp-*** \
    bun --cwd services/mcp-server run start

# HTTP
env DMRX_MCP_TRANSPORT=http \
    DMRX_MCP_PORT=3100 \
    bun --cwd services/mcp-server run start
```

SSE client example:

```js
const transport = new SSEClientTransport(
  new URL("http://localhost:3100/sse"),
  {
    requestInit: {
      headers: { Authorization: "Bearer your-mcp-key" },
    },
  }
);
const client = new Client({ name: "my-client", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
const result = await client.callTool({
  name: "dmrx_chat",
  arguments: { messages: [{ role: "user", content: "Hello!" }], model: "auto-coding" }
});
```

### 5.3 Claude Desktop config

```json
{
  "mcpServers": {
    "dmr-x": {
      "command": "bun",
      "args": ["run", "/abs/path/to/dmr-x/services/mcp-server/src/index.ts"],
      "env": {
        "DMRX_MCP_TRANSPORT": "stdio",
        "DMRX_MCP_API_KEY": "your-mcp-key"
      }
    }
  }
}
```

HTTP alternative:

```json
{
  "mcpServers": {
    "dmr-x": {
      "url": "http://localhost:3100",
      "headers": { "Authorization": "Bearer your-mcp-key" }
    }
  }
}
```

### 5.4 Aggregate external MCP servers

Environment config:

```bash
DMRX_MCP_CLIENT_SERVERS='[
  {
    "id": "github",
    "name": "GitHub",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_***"}
  },
  {
    "id": "filesystem",
    "name": "Filesystem",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/workspace"]
  }
]'
```

Or via `dmrx-mcp.config.json` for live hot-reload:

```json
{
  "transport": "sse",
  "port": 3100,
  "aggregation": {
    "servers": [
      {
        "id": "github",
        "name": "GitHub",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_***"}
      }
    ]
  }
}
```

Namespaced access pattern once connected: `github__create_issue`, `filesystem__read_file`.

Verify aggregation health:

```bash
curl http://localhost:3100/ \
  -H "Authorization: Bearer your-mcp-key" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"dmrx_status","arguments":{}}}'
# look for: aggregator.enabled, externalServerCount, externalToolCount
```

## 6. Godmode Quick Example

Godmode wraps **G0DM0D3** capabilities: AutoTune/Parseltongue/STM pipeline,
ULTRAPLINIAN multi-model racing, and CONSORTIUM hive-mind synthesis.

Configure:

```bash
# .env or a Godmode-specific config
DMRX_GODMODE_BASE_URL=https://openrouter.ai  # or G0DM0D3 relay
DMRX_GODMODE_API_KEY=your-godmode-key
DMRX_GODMODE_OPENROUTER_API_KEY=sk-or-***   # for built-in G0DM0D3 proxy
```

### Standard Godmode chat

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ***" \
  -d '{
    "model": "nousresearch/hermes-3-llama-3.1-70b",
    "messages": [{"role":"user","content":"Explain quantum tunneling in 2 sentences"}]
  }'
```

### ULTRAPLINIAN multi-model racing

```bash
curl -X POST http://localhost:3000/v1/ultraplinian/completions \
  -H "Authorization: Bearer ***" \
  -d '{
    "messages": [{"role":"user","content":"Write a haiku about routers"}],
    "tier": "fast"
  }'
```

### CONSORTIUM hive-mind synthesis

```bash
curl -X POST http://localhost:3000/v1/consortium/completions \
  -H "Authorization: Bearer ***" \
  -d '{
    "messages": [{"role":"user","content":"Compare JS and Go for web services"}],
    "tier": "smart"
  }'
```

### AutoTune analyze prompt parameters

```bash
curl -X POST http://localhost:3000/v1/autotune/analyze \
  -H "Authorization: Bearer ***" \
  -d '{
    "messages": [{"role":"user","content":"Analyze my prompts"}],
    "model": "auto-smart"
  }'
```

### Parseltongue encode / decode

```bash
curl -X POST http://localhost:3000/v1/parseltongue/encode \
  -H "Authorization: Bearer ***" \
  -d '{"text": "secret plan"}'
```

### STM semantic transformation

```bash
curl -X POST http://localhost:3000/v1/transform \
  -H "Authorization: Bearer ***" \
  -d '{
    "text": "Explain this like I am five",
    "task": "simplify"
  }'
```

### Godmode health and feedback stats

```bash
curl http://localhost:3000/v1/health

curl http://localhost:3000/v1/feedback/stats \
  -H "Authorization: Bearer ***"
```

## 7. Admin Dashboard and API Notes

Admin routes are guarded by `DMRX_ADMIN_API_KEY` in production. In local mode
(`DMRX_LOCAL_MODE=true`), admin routes are open.

### Providers

```bash
# Health snapshot
curl -s http://localhost:3000/v1/admin/providers | \
  jq '.[] | {name, is_healthy, last_health_check}'

# Mark unhealthy provider inactive instead of deleting
curl -X PATCH http://localhost:3000/v1/admin/providers/<provider-id> \
  -H "Authorization: Bearer ***" \
  -d '{"is_active": false}'
# bandit reroutes traffic automatically

# Rotate provider API key
curl -X POST http://localhost:3000/v1/admin/providers/<provider-id>/rotate \
  -H "X-Admin-Key: $DMRX_ADMIN_API_KEY" \
  -d '{"newKey": "sk-..."}'

# Reactivate after recovery
curl -X POST http://localhost:3000/v1/admin/providers/<provider-id>/reactivate \
  -H "X-Admin-Key: $DMRX_ADMIN_API_KEY"
```

### Models

```bash
# Update model metadata
curl -X PATCH http://localhost:3000/v1/admin/models/<model-id> \
  -H "Authorization: Bearer ***" \
  -d '{"tags": ["stable","vision"]}'
```

### Tenants and keys

```bash
# Suspend tenant
curl -X POST http://localhost:3000/v1/admin/tenants/<id>/suspend \
  -H "Authorization: Bearer ***"
```

### Usage, requests, and benchmarking

```bash
# Usage by tenant / window
curl -s "http://localhost:3000/v1/admin/usage?groupBy=tenant&window=1h" | jq

# Recent requests
curl -s "http://localhost:3000/v1/admin/requests?window=10m&orderBy=cost&limit=10" | jq

# Run benchmark
curl -X POST http://localhost:3000/v1/admin/benchmarks/run \
  -H "Authorization: Bearer ***" \
  -d '{"modelId":"auto-fast"}'
```

### Admin API Reference

| Resource | Endpoints |
|----------|-----------|
| Tenants | `POST/GET/PUT/DELETE /v1/admin/tenants` |
| API Keys | `POST/GET/PUT/DELETE /v1/admin/api-keys` |
| Policies | `POST/GET/PUT/DELETE /v1/admin/policies` |
| Quotas | `POST/GET/PUT /v1/admin/quota-allocations` |
| Providers | `GET/PATCH/POST /v1/admin/providers/*` |
| Models | `PATCH /v1/admin/models/*` |
| Requests | `GET /v1/admin/requests` |
| Usage | `GET /v1/admin/usage` |
| Executions | `GET /v1/admin/executions` |
| Evaluations | `GET /v1/admin/evaluations` |
| Benchmarks | `POST /v1/admin/benchmarks/*` |

## 8. Make Requests

```bash
# OpenAI format
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ***" \
  -d '{"model":"auto-smart","messages":[{"role":"user","content":"Hello"}]}'

# Anthropic format
curl -X POST http://localhost:3000/v1/messages \
  -H "Authorization: Bearer ***" \
  -d '{"model":"auto-smart","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'

# Google Gemini format
curl -X POST http://localhost:3000/v1/gemini/generateContent \
  -H "Authorization: Bearer ***" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Hello"}]}]}'

# Image generation
curl -X POST http://localhost:3000/v1/images/generations \
  -H "Authorization: Bearer ***" \
  -d '{"model":"dall-e-3","prompt":"A futuristic city"}'

# Video generation
curl -X POST http://localhost:3000/v1/video/generations \
  -H "Authorization: Bearer ***" \
  -d '{"model":"runway-gen3","prompt":"A drone flying over mountains","duration":5}'

# Audio TTS
curl -X POST http://localhost:3000/v1/audio/speech \
  -H "Authorization: Bearer ***" \
  -d '{"model":"tts-1","input":"Hello, world!","voice":"alloy"}'

# Audio STT
curl -X POST http://localhost:3000/v1/audio/transcriptions \
  -H "Authorization: Bearer ***" \
  -F "file=@audio.mp3" -F "model=whisper-1"

# Embeddings
curl -X POST http://localhost:3000/v1/embeddings \
  -H "Authorization: Bearer ***" \
  -d '{"model":"text-embedding-3-small","input":"The quick brown fox"}'
```

## 9. SDK Examples

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="dmr-sk-abcdef123456789"
)

response = client.chat.completions.create(
    model="auto-coding",
    messages=[{"role":"user","content":"Return JSON {ok:true}"}],
    response_format={"type":"json_object"}
)
print(response.choices[0].message.content)
```

### Python (Anthropic SDK)

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://localhost:3000/v1",
    api_key="dmr-sk-abcdef123456789"
)

response = client.messages.create(
    model="auto-smart",
    max_tokens=1024,
    messages=[{"role":"user","content":"Explain DMR-X routing"}]
)
print(response.content[0].text)
```

### JavaScript / TypeScript

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3000/v1",
  apiKey: "dmr-sk-abcdef123456789"
});

const response = await client.chat.completions.create({
  model: "auto-coding",
  messages: [{ role: "user", content: "Write a React fetch hook" }]
});

console.log(response.choices[0].message.content);
```

## 10. Per-Tenant Controls

### Policies

```bash
curl -X POST http://localhost:3000/v1/admin/policies \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "...",
    "name": "No OpenAI",
    "type": "provider_allow",
    "target": ["anthropic","ollama","replicate"],
    "action": "allow"
  }'
```

### Quotas

```bash
curl -X POST http://localhost:3000/v1/admin/quota-allocations \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "...",
    "max_cost": 100,
    "period": "monthly"
  }'
```

## What You Get

| Capability | Supported |
|------------|-----------|
| **Wire formats** | OpenAI, Anthropic, Google Gemini |
| **LLMs** | OpenAI, Anthropic, Google, Ollama, OpenRouter, Groq, DeepSeek, Together, Fireworks, + more |
| **Images** | DALL-E, Stability, Replicate, ComfyUI, Fal, Pollinations, + more |
| **Video** | Runway, FAL, Veo, + more |
| **Audio** | TTS (ElevenLabs, OpenAI, Kokoro, Piper), STT (Deepgram, OpenAI), separation |
| **Embeddings** | OpenAI, Cohere, Jina, Ollama, TEI, + more |
| **OCR** | Tesseract, PaddleOCR, HuggingFace |
| **Reranking** | Cohere, Jina, TEI |
| **3D** | Available providers |
| **Agents (AaaS)** | Markdown import, GitHub/ZIP/marketplace, durable sessions, resume/retry, subagent isolation, evaluations |
| **MCP** | stdio/SSE/HTTP server, 40+ tools, external aggregation, live hot-reload |
| **Godmode** | ULTRAPLINIAN, CONSORTIUM, AutoTune, Parseltongue, STM, feedback loop |
| **Admin** | Providers, models, tenants, keys, policies, quotas, benchmarks, request logs, usage, executions, evaluations |
| **Routing** | Meta-model aliases, free-tier strategies, provider preference/blacklist, fallback chains, Thompson Sampling bandit |

Plus: per-tenant rate limiting, request logging, OTel tracing, audit logging, RBAC,
guardrails, federation, and single-binary/single-container deployment.

## Authentication Flow

```
User Request → Authorization: Bearer *** or x-api-key *** or X-Admin-Key *** 
  → authMiddleware hashes key, queries api_keys table
  → Attaches tenant to request
  → Router applies tenant policies/quotas and free-tier strategy
  → Routes to best provider
  → Returns response in original format
```

## Architecture

```text
┌─────────────┐                 ┌──────────────────────────────────┐
│   Tenant    │◄── API Keys ───►│         DMR-X Gateway :3000      │
└─────────────┘                 │   Fastify + SQLite + Admin UI     │
                                └──────────────┬───────────────────┘
                                               │
                                    ┌──────────▼────────────┐
                                    │  Routing Pipeline      │
                                    │  Meta-models / Bandit  │
                                    │  Fallback / Scoring    │
                                    └──────────┬────────────┘
                                               │
                                ┌──────────────▼──────────────┐
                                │  Providers / Adapters        │
                                │  + AaaS + MCP + Godmode     │
                                └─────────────────────────────┘
```

## Developer Scripts

```bash
# From repo root
bun scripts/dev/check-schema.ts
bun scripts/dev/list-keys.ts
bun scripts/dev/list-providers.ts
bun scripts/dev/list-providers-v2.ts
```

## Relative Documentation

- `docs/QUICK-START-DEMO.md` — one-command Docker demo
- `docs/MCP.md` — full MCP tool/reference/aggregation docs
- `docs/RUNBOOK.md` — alert response and admin operations
- `docs/CONFIGURATION.md` — env vars and deployment patterns
- `docs/API_USAGE_GUIDE.md` — SDKs, routing, meta-models, and formats
- `services/needle-router/README.md` — cheap first-stage tool-call router
- `services/mcp-server/README.md` — MCP server quickstart
- `services/godmode/dist/` — G0DM0D3 integration surface
