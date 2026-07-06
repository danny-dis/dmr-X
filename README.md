# DMR-X

Universal AI routing, orchestration, and **Model Context Protocol (MCP) platform**. A single gateway that accepts requests in **OpenAI**, **Anthropic**, and **Google Gemini** wire formats, routes them to the best available provider, and returns responses in the same format. Also includes a full-featured MCP server for seamless agent integration.

## Key Features

- **Multi-Format API** — native OpenAI, Anthropic, and Gemini endpoints from one gateway
- **Dynamic Routing** — cost/latency/quality scoring with fallback chains and Thompson Sampling bandit
- **Meta-Model Aliases** — `auto-coding`, `auto-smart`, `auto-agentic`, `auto-fast`, `auto` for automatic provider selection
- **18 Provider Adapters** — OpenAI, Anthropic, Google, Mistral, Cohere, Ollama, Replicate, Stability, ElevenLabs, Deepgram, Jina, ComfyUI, FAL.ai, Runway, Veo, Kokoro, Piper, TEI, plus GenericOpenAI for any OAI-compatible provider
- **Zero External Dependencies** — SQLite via sql.js, no Redis/Postgres required
- **Single Binary Distribution** — compile to standalone executable for Windows, Linux, macOS
- **Admin UI** — React/Vite dashboard for providers, models, tenants, keys, policies, quotas, and telemetry
- **MCP Server** — expose DMR-X routing as MCP tools (stdio, SSE, HTTP transports)
- **Multi-Tenant** — per-tenant API keys, quotas, policies, and billing tracking
- **Agentic Workflows** — tool execution, multi-turn tool loops, and agentic chat with approval gates

## Quick Start

### From Source

```bash
# Clone and install
git clone https://github.com/dmr-x/dmr-x.git
cd dmr-x
bun install

# Configure
cp .env.example .env
# Edit .env — set at least one provider key, or use local providers like Ollama

# Run
bun run dev:gateway
# Open http://localhost:3000
```

### From Binary

```bash
# Linux / macOS
curl -sL https://github.com/dmr-x/dmr-x/releases/latest/download/dmrx-linux-x64.tar.gz | tar xz
./dmrx

# Windows
# Download dmrx-windows-x64.zip from releases, extract, run dmrx.exe
```

### Docker

```bash
docker compose up -d
# Gateway at http://localhost:3000
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Client (any format)               │
│         OpenAI / Anthropic / Gemini / MCP            │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│                   DMR-X Gateway (:3000)               │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Auth    │→ │  Router   │→ │  Adapter Executor │   │
│  │Middleware│  │ Pipeline  │  │                   │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
│                       │                               │
│  ┌──────────────────────────────────────────────┐    │
│  │  Services: Registry, Quota, Policy, Billing,  │    │
│  │  Benchmark, Telemetry, MCP Server             │    │
│  └──────────────────────────────────────────────┘    │
│                       │                               │
│  ┌──────────────────────────────────────────────┐    │
│  │  SQLite (sql.js) — debounced save, flush on   │    │
│  │  shutdown, zero external dependencies          │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│  Provider Adapters (18 total)                         │
│  OpenAI · Anthropic · Ollama · GenericOpenAI         │
│  Replicate · Stability · ComfyUI · FAL · Runway · Veo│
│  ElevenLabs · Deepgram · Kokoro · Piper              │
│  Cohere · Jina · TEI                                 │
└──────────────────────────────────────────────────────┘
```

This is an npm workspace TypeScript monorepo. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation.

## Repository Layout

```
dmr-x/
├── apps/
│   ├── gateway/          # Fastify HTTP gateway + static UI host
│   └── ui/               # React/Vite admin dashboard
├── packages/
│   ├── core/             # Shared types, schemas, and contracts
│   ├── db/               # SQLite client, cache, and migrations
│   ├── utils/            # Logging, retries, streams, crypto, errors
│   └── cli/              # CLI tool (dmrx command)
├── services/
│   ├── adapters/         # Provider adapter interface + 18 concrete adapters
│   ├── router/           # Task classifier, routing pipeline, fallback, bandit
│   ├── registry/         # Provider and model registry
│   ├── quota/            # Quota management
│   ├── policy/           # Routing policies (allowlist, blocklist, cost, residency)
│   ├── billing/          # Usage tracking and billing
│   ├── benchmark/        # Provider benchmarking
│   ├── telemetry/        # Metrics and observability
│   ├── oauth/            # OAuth provider authentication
│   ├── federation/       # Cross-instance federation
│   ├── memory/           # Conversation memory management
│   ├── sandbox/          # Sandboxed code execution
│   ├── workers/          # Background worker tasks
│   ├── mcp-server/       # MCP tool server (stdio/SSE/HTTP)
│   └── mcp-client/       # MCP client integration
├── tests/
│   ├── unit/             # Unit tests (41 test files / 1250+ tests)
│   └── e2e/              # Opt-in end-to-end connectivity tests
├── scripts/              # Install scripts and release packaging
├── docs/                 # Documentation
├── infra/                # Infrastructure configs
└── release/              # Pre-built release artifacts
```

## Multi-Format API

DMR-X natively serves three API wire formats from a single gateway. Send requests in the format your client already uses — no SDK changes needed.

| Format | Chat Endpoint | Streaming | Auth Header |
|--------|--------------|-----------|-------------|
| **OpenAI** | `POST /v1/chat/completions` | SSE with `data: [DONE]` | `Authorization: Bearer <key>` |
| **Anthropic** | `POST /v1/messages` | SSE with `event:` types | `x-api-key: <key>` |
| **Google Gemini** | `POST /v1/gemini/generateContent` | SSE with `data:` lines | `x-api-key: <key>` |

All three formats support streaming, tool/function calling, vision (image inputs), JSON mode, and temperature/top_p/top_k/max_tokens/stop parameters.

The gateway converts every request into a unified internal format, routes it to the best available provider, and converts the response back to the requested wire format. An Anthropic-formatted request can be served by an OpenAI provider (or vice versa).

### Meta-Models (Dynamic Routing)

Instead of hard-coding a model name, use a **meta-model alias** — DMR-X picks the best available provider at request time:

| Alias | Picks |
|-------|-------|
| `auto` | Auto-pick best model (paid + free) |
| `auto-fast` | Fastest model (paid + free) |
| `auto-smart` | Most capable model (paid + free) |
| `auto-agentic` | Best model for tool use (64K+ context) |
| `auto-coding` | Best model for code generation |

Use them exactly like a model name: `"model": "auto-coding"`.

See [docs/API_USAGE_GUIDE.md](docs/API_USAGE_GUIDE.md) for detailed examples and SDK integration guides, and [docs/QUICK-START.md](docs/QUICK-START.md) for the single-API-key setup guide.

## API Endpoints

### Core

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat |
| `POST` | `/v1/messages` | Anthropic-compatible messages |
| `POST` | `/v1/gemini/generateContent` | Gemini-compatible generateContent |
| `GET` | `/v1/models` | List available models (OpenAI format) |
| `GET` | `/v1/models/:modelId` | Single model lookup |

### Multimodal

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/images/generations` | Image generation |
| `POST` | `/v1/embeddings` | Text embeddings |
| `POST` | `/v1/rerank` | Document reranking |
| `POST` | `/v1/audio/speech` | Text-to-speech |
| `POST` | `/v1/audio/transcriptions` | Speech-to-text |
| `POST` | `/v1/audio/separate` | Audio source separation (stems) |
| `POST` | `/v1/video/generations` | Video generation |
| `POST` | `/v1/3d/generate` | 3D asset generation |
| `POST` | `/v1/ocr` | Optical character recognition |

### Agentic

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/tools/execute` | Single tool execution |
| `POST` | `/v1/tools/loop` | Multi-turn tool loop |
| `POST` | `/v1/agentic/chat` | Agentic chat with approval gates |
| `POST/GET/DELETE` | `/v1/conversations` | Conversation history management |
| `POST` | `/v1/agents` | Agent execution |
| `POST` | `/v1/agent-chat` | Agent chat with streaming |
| `POST` | `/v1/prompts` | Prompt template management |

### Utilities

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/compression` | Prompt compression |
| `POST` | `/v1/route` | Route decision preview |
| `POST` | `/v1/validate` | Request validation |
| `POST` | `/v1/count-tokens` | Token counting |

### Integrations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/godmode/*` | G0DM0D3 integration (ULTRAPLINIAN, CONSORTIUM, etc.) |
| `POST` | `/cloudcode/*` | Cloud Code protocol (Antigravity/agy) |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET/POST/PUT/DELETE` | `/v1/admin/tenants` | Tenant management |
| `GET/POST/DELETE` | `/v1/admin/api-keys` | API key management |
| `GET/PUT` | `/v1/admin/providers` | Provider configuration |
| `GET/PUT` | `/v1/admin/settings` | System settings |
| `GET` | `/v1/admin/policies` | Routing policies |
| `GET` | `/v1/admin/quotas` | Quota management |
| `GET` | `/v1/admin/billing` | Usage and billing |
| `GET` | `/v1/admin/telemetry` | Metrics and observability |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Basic health check |
| `GET` | `/healthz` | Health with subsystem checks |
| `GET` | `/ready` | Readiness probe |
| `GET` | `/livez` | Liveness probe |

## Configuration

All environment variables are documented in `.env.example` and [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Gateway listen port |
| `DMRX_LOCAL_MODE` | `false` | Skip tenant auth for local dev |
| `DMRX_ADMIN_API_KEY` | — | Admin API key (required in production) |
| `DMRX_ENCRYPTION_KEY` | — | AES-256-GCM key for provider key encryption |
| `DMRX_CORS_ORIGIN` | `http://localhost:4200` | Allowed CORS origins |
| `DMRX_FREE_TIER_STRATEGY` | `none` | Free-tier routing: none/prioritize/load_balance/fallback |

## Development

```bash
bun install              # Install dependencies
bun run dev              # Run all workspace dev tasks (turbo)
bun run dev:gateway      # Gateway only
bun run dev:ui           # UI only (Vite at :4200, proxies /v1/* to gateway :3000)
bun run build            # Production build
bun run start            # Start built gateway
bun run test             # Run unit tests
bun run lint             # Lint all packages
```

E2E connectivity tests require a running gateway:

```bash
DMRX_RUN_E2E=true bun run test -- tests/e2e/connectivity.test.ts
```

## Testing

```bash
bun run test
```

**Security:** Since v0.2.0, DMR-X has patched a cross-tenant data leak, an SSRF DNS-rebinding bypass, and 11 CVEs. See [SECURITY.md](SECURITY.md).

41 unit test files / 1250+ tests covering:

- Routing pipeline (capability filter, availability, cost/latency scoring, final selector, fallback)
- Anthropic converter and stream serializer
- API contracts and auth middleware
- Task classifier and tool orchestrator
- SQLite client, memory cache, crypto
- Meta-model resolution
- Event streams, HTTP errors, stop conditions

See [docs/TESTING.md](docs/TESTING.md) for details.

## Distribution

DMR-X compiles to a single standalone binary via `bun build --compile`. Pre-built binaries are available on the [Releases](https://github.com/dmr-x/dmr-x/releases) page for:

- **Linux x64** — `dmrx-linux-x64.tar.gz`
- **macOS x64** — `dmrx-darwin-x64.tar.gz`
- **Windows x64** — `dmrx-windows-x64.zip`

Each archive contains the binary, UI assets, and an install script. See [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) for details.

CI/CD: push a `v*` tag to trigger the GitHub Actions release workflow that builds, packages, and publishes all platform binaries.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical architecture and request flow |
| [docs/API_USAGE_GUIDE.md](docs/API_USAGE_GUIDE.md) | API usage with SDK examples |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Environment variable reference |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment guide (Bun, Docker, binary) |
| [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) | Binary packaging and install scripts |
| [docs/MCP.md](docs/MCP.md) | MCP server setup and tool reference |
| [docs/TESTING.md](docs/TESTING.md) | Testing guide |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Version history |
| [SECURITY.md](SECURITY.md) | Security policy, supported versions, and vulnerability disclosure |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operational runbook and incident response |
| [docs/WIRING-VERIFICATION.md](docs/WIRING-VERIFICATION.md) | Technical wiring verification reference |
| [docs/TRANSPARENCY-VERIFICATION.md](docs/TRANSPARENCY-VERIFICATION.md) | Provider transparency verification |
| [docs/AI_PROVIDER_REFERENCE.md](docs/AI_PROVIDER_REFERENCE.md) | Provider API reference (35+ providers) |
| [docs/AI_API_PROVIDERS_EXHAUSTIVE.md](docs/AI_API_PROVIDERS_EXHAUSTIVE.md) | Exhaustive provider catalog (100+) |
| [docs/FREE_API_PROVIDERS_REPORT.md](docs/FREE_API_PROVIDERS_REPORT.md) | Free-tier provider report |

## Contributing

- Branch names: `feature/<topic>`, `fix/<topic>`, `refactor/<topic>`, `docs/<topic>`.
- Run `bun run test` and `bun run build` before opening a PR.
- Keep generated files out of source folders; build outputs belong in `dist/` or `apps/gateway/public/`.
- Prefer behavior-preserving refactors and small commits by phase.
- Follow existing TypeScript ESM style and package boundaries.
- **All contributors must sign the [CLA](CLA.md) before contributions can be merged.**

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## License

This project is licensed under the [Business Source License 1.1](LICENSE) (BSL-1.1).

| Use Case | Terms |
|----------|-------|
| **Production (≤50 users)** | Free |
| **Non-production** | Unlimited (dev, testing, evaluation) |
| **Production (>50 users)** | Commercial license required |
| **After 2030-05-30** | Converts to AGPL-3.0 |

For commercial licensing: see [LICENSE](LICENSE) for contact details.
