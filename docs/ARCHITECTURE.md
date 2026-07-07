# Architecture

DMR-X is a universal AI routing and orchestration platform. It accepts requests in three native wire formats (OpenAI, Anthropic, Gemini), converts them to a unified internal representation, routes them to the best available provider through a multi-stage pipeline, and returns responses in the original format.

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Bun 1.0+ | Primary runtime (Node.js 18+ also supported) |
| **HTTP** | Fastify 5.x | High-performance HTTP framework |
| **Database** | SQLite via sql.js | Zero-dependency embedded database |
| **Build** | Turbo 2.9 | Monorepo task orchestration |
| **Frontend** | React 19 + Vite 6 | Admin dashboard SPA |
| **Language** | TypeScript 5.9+ (ESM) | Type-safe, modern module system |
| **Packaging** | Bun workspaces (npm-compatible) | Monorepo dependency management |

**No external infrastructure required.** No Redis, no PostgreSQL, no message queues. The entire platform runs as a single process with SQLite for persistence.

## Request Flow

```
Client Request (OpenAI / Anthropic / Gemini format)
    │
    ▼
┌─ Gateway (Fastify) ─────────────────────────────────┐
│                                                       │
│  1. Auth Middleware                                    │
│     ├─ Validate API key (Bearer / x-api-key)          │
│     ├─ Resolve tenant                                 │
│     └─ Check rate limits                              │
│                                                       │
│  2. Route Handler                                     │
│     ├─ Parse wire format (OpenAI/Anthropic/Gemini)    │
│     ├─ Convert to UnifiedRequest                      │
│     └─ Extract modality, capabilities, parameters     │
│                                                       │
│  3. Router Pipeline                                   │
│     ├─ Task Classifier — extract modality + caps      │
│     ├─ Capability Filter — match model capabilities   │
│     ├─ Provider Preference Filter — honor tenant cfg  │
│     ├─ Availability Filter — check health status      │
│     ├─ Rate Limit Filter — sliding window RPM/TPM     │
│     ├─ Policy Filter — allowlist/blocklist/cost/res   │
│     ├─ Quota Filter — tenant quotas + free-tier       │
│     ├─ Cost/Latency Scorer — frontier/balanced/econ   │
│     ├─ Free-Tier Strategy — prioritize/load_balance   │
│     ├─ Final Selector — epsilon-greedy + Thompson     │
│     └─ Fallback Chain — ordered candidate list        │
│                                                       │
│  4. Adapter Executor                                  │
│     ├─ Select provider adapter from registry          │
│     ├─ Execute request with retry + timeout           │
│     ├─ Normalize response to UnifiedResponse          │
│     └─ Track success/failure for bandit learning      │
│                                                       │
│  5. Response Converter                                │
│     ├─ Convert UnifiedResponse to wire format         │
│     └─ Return in same format client sent              │
│                                                       │
└───────────────────────────────────────────────────────┘
```

## Monorepo Structure

```
dmr-x/
├── apps/
│   ├── gateway/              # HTTP API gateway
│   │   ├── src/
│   │   │   ├── main.ts       # Entry point — init SQLite, start Fastify
│   │   │   ├── server.ts     # Plugin registration, route mounting, middleware
│   │   │   ├── converters/   # Wire format ↔ UnifiedRequest converters
│   │   │   ├── middleware/   # Auth, request-id, rate limiting
│   │   │   └── routes/       # Route handlers (chat, admin, models, etc.)
│   │   └── public/           # Built UI assets (served as static SPA)
│   │
│   └── ui/                   # React/Vite admin dashboard
│       └── src/
│           ├── pages/        # Dashboard, Providers, Models, Tenants, Settings, etc.
│           ├── components/   # Shared UI components
│           └── hooks/        # API hooks and state management
│
├── packages/
│   ├── core/                 # Shared types re-export (thin shim over @dmr-x/types)
│   ├── types/                # Central shared TypeScript contracts (source of truth)
│   ├── db/                   # SQLite persistence layer (client, cache, migration runner)
│   ├── utils/                # Cross-cutting utilities (logging, retries, crypto, tool exec)
│   ├── cli/                  # CLI tool (dmrx command)
│   ├── secrets/              # Secrets manager (AES-encrypted provider-key storage)
│   ├── tokenizers/           # Tokenizer registry (heuristic, tiktoken, anthropic)
│   ├── provider-catalog/     # 35+ provider catalog: taxonomy, OAuth configs, pricing
│   └── plugin-loader/        # Plugin loader (manifest/transport/tool/permissions)
│
├── services/
│   ├── adapters/             # Provider adapter layer — 57+ concrete adapters
│   ├── router/               # Routing intelligence (pipeline, classifier, decomposer, bandit, A/B strategies)
│   ├── registry/             # Provider and model registry (incl. classification/free-tier)
│   ├── quota/                # Quota + rate-limit management
│   ├── policy/               # Routing policies + RBAC policy engine
│   ├── billing/              # Usage tracking, billing records, credits/wallet
│   ├── benchmark/            # Provider benchmarking + LLM-judge quality scoring
│   ├── telemetry/            # Metrics, OTel tracing, audit logging
│   ├── oauth/                # OAuth provider authentication (auth_code / device_code)
│   ├── federation/           # Cross-instance federation
│   ├── memory/               # Conversation memory + embeddings + vector search
│   ├── sandbox/              # Sandboxed code execution
│   ├── cache/                # Response + semantic cache
│   ├── workers/              # Background worker tasks + task queue
│   ├── mcp-server/           # MCP tool server + A2A, federation, RBAC, guardrails, audit
│   ├── mcp-client/           # MCP client integration (external servers as adapters)
│   ├── agent-registry/       # Agent definitions, instances, marketplace, RBAC roles
│   ├── agent-runtime/        # Agent execution runtime + scheduler + billing
│   ├── prompts/              # Prompt library + .mkd template parser
│   ├── skill-registry/       # Universal skill registry (CRUD, import/export, versioning)
│   ├── tool-search/          # Hybrid BM25 + semantic tool search engine
│   ├── godmode/              # G0DM0D3 integration (ULTRAPLINIAN, CONSORTIUM, etc.)
│   └── operator/             # Kubernetes operator (MCP/federation/workflow CRDs)
│
├── tests/
│   ├── unit/                 # 54 unit test files
│   └── e2e/                  # Opt-in connectivity tests (4 files)
│
├── scripts/                  # Install scripts, release packaging, backup, loadtest, dev
├── docs/                     # Documentation
├── helm/                     # Helm chart for Kubernetes deployment
├── monitoring/               # Prometheus/Alertmanager/Loki/Grafana + dashboards
└── infra/                    # Additional infrastructure configs (terraform, etc.)
```

## Package Boundaries

Each package has a clear responsibility and dependency direction:

| Package | Depends On | Provides |
|---------|-----------|----------|
| `packages/core` | nothing | Shared types re-export (shim over `@dmr-x/types`) |
| `packages/types` | nothing | Central shared TypeScript contracts |
| `packages/db` | core | SQLite client, cache, migrations |
| `packages/utils` | core | Logging, retries, streams, crypto, errors, tool execution |
| `packages/secrets` | core, db | AES-encrypted secrets/provider-key storage |
| `packages/tokenizers` | core | Tokenizer registry |
| `packages/provider-catalog` | core | 35+ provider catalog (taxonomy, OAuth, pricing) |
| `packages/plugin-loader` | core | Plugin manifest/transport/tool/permissions |
| `packages/cli` | core, provider-catalog | `dmrx` CLI commands |
| `services/adapters` | core, utils | Provider-specific I/O adapters (57+) |
| `services/router` | core, utils | Selection, scoring, fallback, bandit, A/B logic |
| `services/registry` | core, db | Provider/model registration and lookup |
| `services/quota` | core, db | Quota + rate-limit enforcement |
| `services/policy` | core | Routing + RBAC policy evaluation |
| `services/billing` | core, db | Usage tracking, credits/wallet |
| `services/benchmark` | core, adapters | Provider quality benchmarking |
| `services/cache` | core, db | Response + semantic cache |
| `services/telemetry` | core | Metrics, OTel tracing, audit logging |
| `services/oauth` | core, db | OAuth provider authentication |
| `services/federation` | core | Cross-instance federation |
| `services/memory` | core, db | Conversation memory + vector search |
| `services/sandbox` | core | Sandboxed code execution |
| `services/workers` | core | Background worker tasks + task queue |
| `services/mcp-server` | core, adapters | MCP tools, A2A, federation, RBAC, guardrails, audit |
| `services/mcp-client` | core, adapters | External MCP servers as adapters |
| `services/agent-registry` | core, db | Agent definitions, marketplace, RBAC |
| `services/agent-runtime` | core, db, agent-registry | Agent execution runtime + billing |
| `services/prompts` | core, db | Prompt library + template parser |
| `services/skill-registry` | core, db | Universal skill registry |
| `services/tool-search` | core, utils | Hybrid BM25 + semantic tool search |
| `services/godmode` | core, router | G0DM0D3 integration |
| `services/operator` | core | Kubernetes operator (CRDs) |
| `apps/gateway` | all services | HTTP API, middleware, route handlers |
| `apps/ui` | — | Admin dashboard (bundled into gateway/public) |

**Rules:**
- `packages/*` never depend on `services/*` or `apps/*`
- `services/*` never depend on `apps/*`
- `apps/gateway` is the only entry point that wires everything together

## Data Layer

SQLite via `sql.js` (WebAssembly-based, zero native dependencies):

- **Debounced saves** — writes batched in a 100ms window to reduce I/O
- **Shutdown flush** — `flush()` ensures all pending writes complete before exit
- **Migrations** — 45 SQL migration files in `packages/db/src/migrations/` run on startup
- **No ORM** — direct SQL queries with parameterized statements
- **Data directory** — `~/.dmr-x/data.db` (configurable via `DMRX_DATA_DIR`)

Tables include: `tenants`, `api_keys`, `providers`, `models`, `policies`, `quotas`, `billing_records`, `telemetry_events`, `settings`, `memory_items`.

## Adapter Architecture

Every provider adapter implements the same interface:

```typescript
interface ProviderAdapter {
  readonly providerId: string;
  readonly supportedModalities: Modality[];
  initialize(config: ProviderConfig): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse>;
  executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk>;
  listModels(): Promise<ModelInfo[]>;
  dispose(): Promise<void>;
}
```

The `GenericOpenAIAdapter` handles any OpenAI-compatible provider (OpenRouter, Together, Fireworks, Groq, Cerebras, SambaNova, etc.) without custom code.

The `AdapterRegistry` manages adapter lifecycle:
- Registration with health checking
- Automatic failure tracking (`consecutive_failures`)
- Runtime activation/deactivation
- Startup sweep to re-activate keyless providers

## Router Pipeline

The router is a multi-stage pipeline that selects the best provider for each request:

1. **Task Classifier** — extracts modality (text, image, audio, embedding) and required capabilities (streaming, tools, vision, reasoning)
2. **Capability Filter** — removes models that don't support the required modality/capabilities
3. **Provider Preference Filter** — respects tenant-specific provider preferences
4. **Availability Filter** — removes unhealthy providers (health checker failures)
5. **Rate Limit Filter** — sliding window check (RPM, RPD, TPM, TPD)
6. **Policy Filter** — applies allowlist/blocklist, cost limits, data residency rules
7. **Quota Filter** — checks tenant quotas and free-tier budgets
8. **Cost/Latency Scorer** — scores candidates on cost, latency, and quality
   - `frontier` — optimize for quality
   - `balanced` — balance quality and cost (default)
   - `economy` — optimize for cost
9. **Free-Tier Strategy** — applies free-tier routing (prioritize, load_balance, fallback)
10. **Final Selector** — epsilon-greedy selection with Thompson Sampling bandit for exploration/exploitation
11. **Fallback Chain** — ordered list of candidates for automatic failover

## Meta-Model Resolution

Meta-model aliases (`auto`, `auto-fast`, `auto-smart`, `auto-agentic`, `auto-coding`) are resolved at request time by the router pipeline. The resolution:

1. Applies the alias-specific scoring (speed, quality, context length, specialization)
2. Selects the best match dynamically from all providers (paid + free)

By default, all meta-model aliases route through all providers (paid + free). To restrict to free-only providers, pass `costFilter='free'` to `resolveMetaModel` or set `DMRX_META_MODEL_COST_FILTER=free` globally.

If no provider matches the criteria at all, the gateway returns `503 No available providers`.

## Security Model

- **API Key Auth** — tenant API keys verified with timing-safe comparison
- **Admin Auth** — separate admin API key for `/v1/admin/*` routes
- **Encryption at Rest** — provider API keys encrypted with AES-256-GCM (configurable via `DMRX_ENCRYPTION_KEY`)
- **CORS** — explicit origin allowlist, never wildcard in production
- **Security Headers** — CSP, X-Frame-Options, X-Content-Type-Options, HSTS
- **Rate Limiting** — configurable per-gateway rate limits
- **Input Validation** — Zod schema validation on all admin endpoints
- **Error Sanitization** — 500+ errors return generic messages, no internal details leak

## MCP Server

The MCP server (`services/mcp-server`) exposes DMR-X routing as MCP tools and also provides A2A (Agent2Agent) agent cards, cross-instance federation, an RBAC engine, guardrails (PII redaction, content filtering), audit logging, and a hybrid tool-search engine. It registers **40+ tools** (see `docs/MCP.md` for the full catalog). Groups include:

- **Routing/generation:** `dmrx_chat`, `dmrx_chat_stream`, `dmrx_models`, `dmrx_status`, `dmrx_batch`, `dmrx_workflow`, `dmrx_rerank`, `dmrx_embed`, `dmrx_transcribe`, `dmrx_speak`, `dmrx_generate_image` (+stream), `dmrx_generate_video` (+stream), `dmrx_generate_music`, `dmrx_generate_3d`.
- **Context/memory:** `dmrx_context_save` / `_load` / `_list` / `_summarize` / `_compress`.
- **Filesystem:** `dmrx_read_file`, `dmrx_write_file`, `dmrx_edit_file`, `dmrx_list_files`, `dmrx_search_files`.
- **Skills:** `dmrx_skill_get` / `_list` / `_search` / `_sync`.
- **Presets/Templates:** `dmrx_preset_*` (create/get/list/update/delete), `dmrx_template_*` (create/get/list/update/delete/execute).
- **Tool search:** `dmrx_tool_search`, `dmrx_tool_list`.

Transports: stdio (default), SSE, HTTP. Configured via `DMRX_MCP_TRANSPORT`.

## UI

`apps/ui` is a React 19 + Vite 6 SPA. Its production build outputs to `apps/gateway/public`, which the gateway serves as static files with SPA fallback.

Pages (22 total per `apps/ui/src/pages/index.ts`): Dashboard, Playground, Providers, Models, FreeTier, Tenants, Policies, Quotas, Requests, Routing, Benchmarks, Observability, Memory, Workers, Federation, Sandbox, Settings, Usage, MCP, Connect, Tools, plus a NotFound route.

The UI communicates with the gateway via the `/v1/admin/*` API endpoints. In development, Vite runs at `:4200` and proxies `/v1/*` to the gateway at `:3000`.

## Design Philosophy

These principles guide the architecture and the design decisions made
throughout the codebase.

### Core Principles

- **Unified OpenAI-compatible API** — clients speak one wire format and
  the gateway translates to/from provider-specific formats
- **Local-first execution** — Ollama, vLLM, llama.cpp are first-class
  alongside remote providers
- **Dynamic routing** — clients never pick a provider directly; the
  router decides at request time
- **Multi-provider orchestration** — fan-out, fan-in, fallback chains
  across heterogeneous providers
- **Self-learning benchmarking** — Thompson Sampling bandit improves
  selection based on observed quality
- **Quota-aware execution** — every request is checked against tenant
  and free-tier budgets
- **Federated intelligence** — multiple instances can share learned
  signals and provider health
- **Multi-tenancy** — per-tenant API keys, quotas, policies, billing
- **Multimodal support** — text, image, audio, video, music, embeddings
  through the same routing fabric
- **Single-binary distribution** — `bun build --compile` produces a
  standalone executable with embedded UI

### Intelligence Hierarchy (Vision)

The router organises provider selection along a five-layer hierarchy,
where each layer is a different way of resolving a request:

1. **Brain** — the long-lived reasoning model that handles complex,
   multi-step tasks
2. **Thinkers** — specialised reasoning models selected by task type
   (coding, math, planning)
3. **Executers** — fast, instruction-following models for well-defined
   tasks
4. **Workers** — short-lived background processes spawned for parallel
   subtasks
5. **Temporary Workers** — ephemeral local models spun up just for a
   single request and torn down

The current router implements the Brain, Thinkers, Executers, and **Workers**
layers (Workers landed in v0.4.0). Temporary Workers are in-progress.

**Workers layer wiring:** when the gateway has `DMRX_WORKER_POOL_FANOUT=true`,
`Router.setAdapterExecutor` constructs a `WorkerPoolFanout` and passes it to
`CompositeExecutor`. Parallel sub-task groups (from `TaskDecomposer`) are
dispatched via `WorkerPoolFanout.runParallel`, which:
1. Lazily registers the gateway as a `Worker` (type `router-fanout`).
2. For each sub-task, calls `WorkersService.assignJob` to record a
   `WorkerJob` (jobType `router.fanout`).
3. Executes the sub-task in-process via the existing `AdapterExecutor`.
4. Calls `WorkersService.completeJob` with success or error.

The "Workers" layer is therefore observable today via `/v1/admin/workers` and
the SQLite `workers` / `worker_jobs` tables; it becomes a true multi-process
worker pool when the gateway is run as multiple processes — the
`assignJob → execute → completeJob` contract is the exact handoff point.

### Operational Philosophy

DMR-X acts as the intelligent execution fabric between clients and
AI providers. Clients never directly select providers. The router
dynamically determines the best execution path based on quality,
cost, latency, quotas, modality, and policy — and learns from every
request.
