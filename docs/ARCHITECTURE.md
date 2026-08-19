# Architecture

DMR-X is a universal AI routing and orchestration platform with an optional **Agent-as-a-Service (AaaS)** runtime and a built-in **MCP ecosystem**. It accepts requests in multiple native wire formats (OpenAI, Anthropic, Gemini, CloudCode), converts them to a unified internal representation, routes them through a multi-stage intelligence pipeline, optionally executes durable agent sessions, proxies MCP tools for external clients, exposes a first-party management surface for Godmode/UIs, and returns responses safely in the original format.

The entire platform targets a **zero-external-deps** footprint: one process, SQLite for persistence, no Redis, no PostgreSQL, no message queues.

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
| **Router extension** | Needle (localhost:8011) | Local semantic pre-filter for tool selection |
| **Kubernetes** | Operator + Helm | CRD-based deployment |

**No external infrastructure required.** No Redis, no PostgreSQL, no message queues. The entire platform runs as a single process with SQLite for persistence, and can also be deployed via Helm charts and a Kubernetes operator.

## Request Flow

```
Client Request (OpenAI / Anthropic / Gemini / CloudCode format)
    │
    ▼
┌─ Gateway (Fastify) ─────────────────────────────────┐
│                                                       │
│  1. Proxy / Health / Gateway Modes                    │
│     ├─ API Gateway mode: route + convert + respond    │
│     ├─ Relay/Local mode: pass-through or local exec   │
│     └─ Health probes: providers, router, data         │
│                                                       │
│  2. Auth Middleware                                    │
│     ├─ Validate API key (Bearer / x-api-key)          │
│     ├─ Resolve tenant / org membership                │
│     ├─ Agent RBAC / tool-allowlist checks             │
│     └─ Check rate limits / quota buckets              │
│                                                       │
│  3. Format Converter                                   │
│     ├─ Parse wire format (OpenAI/Anthropic/Gemini...) │
│     ├─ Convert to UnifiedRequest                      │
│     ├─ Optional Needle semantic pre-filter for tools  │
│     └─ Extract modality, capabilities, parameters     │
│                                                       │
│  4. Router Pipeline                                   │
│     ├─ Task Classifier — modality + capabilities      │
│     ├─ Capability Filter — model capability match     │
│     ├─ Meta-model Resolution — auto/auto-fast/...     │
│     ├─ Sticky Session — reuse successful providers   │
│     ├─ Provider Preference — tenant cfg / local-first │
│     ├─ Health/Availability Filter                      │
│     ├─ Rate Limit Filter (incl. free-tier limits)     │
│     ├─ Policy Filter — allowlist/blocklist/cost/res   │
│     ├─ Quota Filter — tenant + free-tier budgets      │
│     ├─ Free-Tier Strategy — prioritize/balance/fallb │
│     ├─ Cost/Latency Scorer — frontier/balanced/econ  │
│     ├─ Final Selector — Thompson Sampling bandit      │
│     └─ Fallback Chain — ordered candidate list        │
│                                                       │
│  5. Adapter Executor                                  │
│     ├─ Select provider adapter from registry          │
│     ├─ Execute request with retry + timeout           │
│     ├─ Classify retryable / non-retryable failures    │
│     └─ Track outcomes for bandit learning             │
│                                                       │
│  6. Response Converter                                │
│     ├─ Normalize to UnifiedResponse                   │
│     ├─ Convert back to wire format                    │
│     └─ Audit / telemetry / billing hooks              │
│                                                       │
└───────────────────────────────────────────────────────┘
```

```
Admin / Control Plane (Fastify admin app)
    │
    ▼
┌─ Admin Routes (/v1/admin/*) ────────────────────────────┐
│                                                          │
│  Tenant / Org / Key Management                           │
│  ├─ tenants / organizations / api-keys CRUD              │
│  ├─ admin API key rotation                                │
│  ├─ audit log (admin_audit_log)                           │
│  └─ .env secret sync (non-core)                           │
│                                                          │
│  Provider / Model / Policy / Quota                        │
│  ├─ providers, keys, OAuth, SSRF-safe base-url           │
│  ├─ models CRUD + free-tier recalculation                 │
│  ├─ policies (routing + RBAC)                             │
│  ├─ quotas + free-tier summary                            │
│  ├─ cost dashboard                                        │
│  └─ benchmarks / leaderboard / tournaments                │
│                                                          │
│  Observability / Workers / Memory / Sandbox              │
│  ├─ telemetry events + SSE stream                         │
│  ├─ workers + worker jobs + drain/resume                  │
│  ├─ memory search/stats (vector + keyword)                │
│  └─ sandbox jobs cancel                                   │
│                                                          │
│  AaaS / Godmode / MCP Control                             │
│  ├─ agents, marketplace, runtime controls                 │
│  ├─ godmode-status/fusion-panels/slots                    │
│  ├─ mcp status + tools execute                            │
│  ├─ mcp config, tool-search, guardrails, audit            │
│  ├─ mcp RBAC + federation peers + A2A config              │
│  ├─ mcp aggregation servers (hot-reload)                  │
│  └─ integrations test                                     │
└──────────────────────────────────────────────────────────┘
```

```
AaaS Runtime Path (agent chat loop)
    │
    ▼
┌─ Agent Dispatch ────────────────────────────────────────┐
│                                                          │
│  1. Load AgentContext from registry                      │
│     ├─ active agent instance                             │
│     ├─ definition (system prompt, model tier, skills)    │
│     └─ tenant check                                      │
│                                                          │
│  2. Build System Prompt                                  │
│     ├─ identity + personality + system prompt            │
│     ├─ progressive skill disclosure (advertised / loaded)│
│     ├─ on-demand memory prefetch                         │
│     ├─ allowed-tools allowlist                           │
│     └─ verify-on-stop nudge + skill-capture nudge        │
│                                                          │
│  3. Agent Loop / Durable Session                         │
│     ├─ load ConversationState from agent_sessions       │
│     ├─ in-process per-conversation mutex                 │
│     ├─ run turn through router / adapter                 │
│     ├─ allow/disallow/block tools per turn              │
│     └─ persist run_steps + updated session state         │
│                                                          │
│  4. On-Demand Skills                                     │
│     └─ SkillLoader resolves bodies + names mid-run      │
│                                                          │
│  5. Scheduler / Retry / Billing                          │
│     ├─ cron-triggered jobs (agent_scheduled_jobs)        │
│     ├─ fallback meta-model resolution on retry           │
│     └─ recordExecution -> billing -> agent_executions    │
└──────────────────────────────────────────────────────────┘
```

## Monorepo Structure

```
dmr-x/
├── apps/
│   ├── gateway/              # HTTP API gateway + admin
│   │   ├── src/
│   │   │   ├── main.ts       # Startup: init SQLite, security, scheduler, plugins
│   │   │   ├── server.ts     # Plugin registration, route mounting, middleware grid
│   │   │   ├── adapter-init.ts # Register all ~50 adapters + health checker
│   │   │   ├── converters/   # Wire format ↔ UnifiedRequest converters
│   │   │   │   ├── anthropic-converter.ts
│   │   │   │   ├── anthropic-stream-serializer.ts
│   │   │   │   ├── cloudcode-converter.ts
│   │   │   │   ├── gemini-converter.ts
│   │   │   │   └── ...
│   │   │   ├── middleware/   # Auth, agent-RBAC, cost-headers, request-id, SIEM/audit forwarding
│   │   │   ├── routes/       # Route handlers per feature
│   │   │   │   ├── chat.routes.ts, anthropic.routes.ts, gemini.routes.ts, cloudcode.routes.ts
│   │   │   │   ├── agent.routes.ts, agent-chat.routes.ts, agent-dispatch.routes.ts
│   │   │   │   ├── admin.routes.ts          # 100+ admin endpoints
│   │   │   │   ├── godmode.routes.ts        # Godmode endpoints + server lifecycle
│   │   │   │   ├── tools.routes.ts          # Tool invocation + sandbox + coding handlers
│   │   │   │   ├── 3d, audio, audio-separation, images, video, embeddings, rerank, ocr, moderation, prompt, compression, conversation, models, route, skill, validate, tools routes
│   │   │   │   └── ...
│   │   │   ├── services/     # Gateway-local services (engines, compression)
│   │   │   ├── lib/          # Needle pre-filter, SSE shims
│   │   │   └── utils/        # Quality-target parsing
│   │   ├── public/           # Built UI assets (served as static SPA with SPA fallback)
│   │   └── docs/             # Gateway-specific docs
│   │
│   └── ui/                   # React 19 + Vite 6 admin dashboard
│       ├── src/
│       │   ├── pages/        # 22+ pages: Dashboard, Playground, Providers, Models, FreeTier, FreeTierDashboard, Tenants, Policies, Quotas, Requests, Routing, Benchmarks, Observability, Memory, Workers, Federation, Sandbox, Settings, Usage, MCP, Connect, Tools, NotFound, plus Marketplace, Agents, MCP tools, FusionPanel, CostDashboard, Credits, Infrastructure, Integrations, ClaudeCode, Codex, OpenCode, Antigravity, Compression, AgentAnalytics, Antigravity
│       │   ├── components/   # Shared UI: charts (bar, donut, gauge, heatmap, latency, pie, time-series, topology, waterfall), domain dialogs (providers, models, tenants, policies, keys), fusion/Godmode panels, integrations, layout (shell, sidebar, topbar, command palette), playground, primitives
│       │   ├── store/        # Playground state, live UI state
│       │   ├── hooks/        # API/misc/URL state hooks
│       │   ├── lib/          # Admin API helpers, markdown, formatters, utils
│       │   └── types/        # API types, shared contracts
│       └── public/           # Static assets
│
├── packages/
│   ├── core/                 # Thin shared types shim (re-exports @dmr-x/types)
│   ├── types/                # Central shared TypeScript contracts (source of truth)
│   ├── db/                   # SQLite persistence layer (sql.js, client, cache, 45 migrations)
│   ├── utils/                # Cross-cutting utilities (logging, retries, streams, errors, crypto, tool execution, SSRF-validator, encryption)
│   ├── secrets/              # AES-encrypted provider-key storage
│   ├── tokenizers/           # Tokenizer registry (heuristic, tiktoken, anthropic)
│   ├── provider-catalog/     # 35+ provider catalog: taxonomy, OAuth configs, pricing, free-tier metadata
│   ├── plugin-loader/        # Plugin loader for external extensions (manifest/transport/tool/permissions)
│   └── cli/                  # CLI tool (`dmrx` command)
│
├── services/
│   ├── adapters/             # Provider adapter layer — 50+ concrete adapters (OpenAI, Anthropic, Ollama, Groq, DeepSeek, XAI, etc.)
│   ├── router/               # Routing intelligence (pipeline, classifier, decomposer, bandit, A/B strategies, meta-models, sticky sessions, cluster scorer)
│   ├── registry/             # Provider and model registry (classifications, free-tier metadata, discovery, enrichment)
│   ├── quota/                # Tenant + free-tier quota + rate-limit sliding windows
│   ├── policy/               # Routing policies and RBAC policy engine (tool-allowlists, data-residency rules)
│   ├── billing/              # Usage tracking, billing records, credits/wallet enforcement
│   ├── benchmark/            # Provider benchmarking + LLM-judge quality scoring + leaderboard
│   ├── telemetry/            # Metrics, OTel tracing, audit logging, content capture
│   ├── oauth/                # OAuth provider authentication (auth_code / device_code flows)
│   ├── federation/           # Cross-instance federation and peer sync
│   ├── memory/               # Conversation memory + embeddings + vector search
│   ├── sandbox/              # Sandboxed code execution for tool-handlers
│   ├── cache/                # Response + semantic cache
│   ├── workers/              # Background worker tasks + task queue + worker/heartbeat/drain APIs
│   ├── mcp-server/           # MCP tool server + A2A, aggregation, guardrails, RBAC, audit, workflow engine, federation
│   ├── mcp-client/           # MCP client integration (external upstream servers as adapters)
│   ├── server-manager/       # Locally-managed G0DM0D3 lifecycle: clone/install/docker-native/bun-native start/stop/health
│   ├── agent-registry/       # Agent definitions, instances, marketplace, RBAC roles, marketplace import/ZIP/GitHub
│   ├── agent-runtime/        # Agent execution runtime + scheduler + billing hooks, evaluation + telemetry
│   ├── skill-loader/         # Agent-side progressive skill disclosure (advertise + resolve body mid-run)
│   ├── skill-registry/       # Universal skill registry (CRUD, import/export, versioning, RBAC-aware)
│   ├── prompts/              # Prompt library + .mkd template parser
│   ├── tool-search/          # Hybrid BM25 + semantic tool search engine
│   ├── godmode/              # G0DM0D3 integration client (chat, ULTRAPLINIAN, CONSORTIUM, AutoTune, Parseltongue, STM, feedback/EMA stats)
│   ├── plugin-loader-bootstrap/ # Bootstrap-/manifest-driven plugin loader
│   ├── needle-router/        # Local Python-based semantic pre-filter for tool routing
│   └── operator/             # Kubernetes operator (MCP/federation/workflow CRDs)
│
├── tests/
│   ├── unit/                 # 86 unit test files (1248+ assertions)
│   │   └── vitest.workspace.ts / vitest.workspace.js
│   └── e2e/                  # Opt-in connectivity tests (4 files)
│
├── scripts/                  # Install scripts, release packaging, backup, loadtest, dev
├── docs/                     # Documentation
├── helm/                     # Helm chart for Kubernetes deployment
├── monitoring/               # Prometheus/Alertmanager/Loki/Grafana + dashboards
└── infra/                    # Additional infrastructure configs (terraform, etc.)
```

## Package Boundaries

Each package/service has a clear responsibility and dependency direction:

| Package | Depends On | Provides |
|---------|-----------|----------|
| `packages/types` | none | Central shared TypeScript contracts |
| `packages/core` | types | Shared types re-export / public API surface |
| `packages/db` | core, sql.js | SQLite client, cache, migration runner, direct-SQL queries |
| `packages/utils` | core | Logging, retries, streams, crypto, errors, tool execution, SSRF validation, encryption |
| `packages/secrets` | core, db | AES-encrypted secrets / provider-key storage |
| `packages/tokenizers` | core | Tokenizer registry (heuristic, tiktoken, anthropic) |
| `packages/provider-catalog` | core | 35+ provider catalog: taxonomy, OAuth configs, pricing, free-tier metadata |
| `packages/plugin-loader` | core | Plugin manifest/transport/tool/permissions loader |
| `packages/cli` | core, provider-catalog | `dmrx` CLI commands |
| `services/adapters` | core, utils | Provider-specific I/O adapters (50+) |
| `services/router` | core, utils | Selection, scoring, fallback, bandit, A/B, meta-models, sticky sessions, cluster |
| `services/registry` | core, db | Provider/model registration and lookup |
| `services/quota` | core, db | Quota + rate-limit enforcement |
| `services/policy` | core | Routing + RBAC policy evaluation |
| `services/billing` | core, db | Usage tracking, credits/wallet |
| `services/benchmark` | core, adapters | Provider quality benchmarking + LLM-judge scoring |
| `services/cache` | core, db | Response + semantic cache |
| `services/telemetry` | core | Metrics, OTel tracing, audit logging |
| `services/oauth` | core, db | OAuth provider authentication |
| `services/federation` | core | Cross-instance federation |
| `services/memory` | core, db | Conversation memory + vector search |
| `services/sandbox` | core | Sandboxed code execution |
| `services/workers` | core | Background worker tasks + task queue + heartbeat/drain |
| `services/mcp-server` | core, adapters, services/* | MCP tools, A2A, aggregation, guardrails, RBAC, audit, workflow | 
| `services/mcp-client` | core, adapters | External MCP servers as upstream adapters |
| `services/server-manager` | core, db | Locally-managed G0DM0D3 server lifecycle |
| `services/agent-registry` | core, db | Agent definitions, instances, marketplace, RBAC |
| `services/agent-runtime` | core, db, agent-registry, skill-loader, router, billing | Agent execution runtime + scheduling + billing + evaluation |
| `services/skill-loader` | core, db | Progressive skill disclosure for agent prompts |
| `services/skill-registry` | core, db | Universal skill registry |
| `services/prompts` | core, db | Prompt library + .mkd template parser |
| `services/tool-search` | core, utils | Hybrid BM25 + semantic tool search |
| `services/godmode` | core, router | G0DM0D3 API client |
| `services/plugin-loader-bootstrap` | core | Bootstrap plugin loader |
| `services/needle-router` | external Python service | Semantic pre-filter for tool selection |
| `services/operator` | core | Kubernetes operator (CRDs) |
| `apps/gateway` | all services | HTTP API, middleware, admin routes, gateway adapters |
| `apps/ui` | — | Admin dashboard (bundled into `apps/gateway/public`) |

**Rules:**
- `packages/*` never depend on `services/*` or `apps/*`
- `services/*` never depend on `apps/*`
- `apps/gateway` is the only entry point that wires everything together
- Outbound HTTP to upstream providers, G0DM0D3, and the Needle router uses a configurable trust proxy / SSRF-safe base URL validator

## Data Layer

SQLite via sql.js (WASM, zero native dependencies), exposed through `packages/db`:

- **Debounced saves** — writes batched in a 100ms window to reduce I/O
- **Shutdown flush** — `closeDb()` ensures all pending writes complete before exit
- **Migrations** — 64 SQL migrations in `packages/db/src/migrations/` run on startup
- **No ORM** — direct parameterized SQL queries throughout
- **Data directory** — `~/.dmr-x/data.db` via `DMRX_DATA_DIR`; gateway writes hybrid .env sync for provider keys

Key tables include:
- **Tenancy**: `tenants`, `organizations`, `organization_members`
- **Auth/Policy**: `api_keys`, `policies`, `admin_audit_log`
- **Providers**: `provider_keys`, `providers`, `models`
- **Routing/Learning**: `request_logs`, `bandit_state`
- **Agent/AaaS**: `agent_instances`, `agent_executions`, `agent_sessions`, `session_steps`, `agent_scheduled_jobs`
- **Usage**: `billing_records`, `credits`, `quota_usage`
- **Memory**: `memory_items`
- **Infrastructure**: `server_instances`, `worker_jobs`
- **MCP**: `mcp_tool_search_config`, `mcp_guardrail_config`, `mcp_rbac_policies`, `mcp_audit_log`, `mcp_aggregation_servers`, `mcp_federation_peers`
- **Settings/UI**: `settings`, `fusion_panels`
- **Telemetry**: `telemetry_events`

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

The `GenericOpenAIAdapter` handles any OpenAI-compatible provider (OpenRouter, Together, Fireworks, Groq, Cerebras, SambaNova, etc.) without custom code. A `GenericAnthropicAdapter` and cloud-code/gemini-family adapters remove the need for bespoke code per remote API.

The `AdapterRegistry` manages lifecycle:
- Registration with immediate health checking
- Automatic failure tracking (`consecutive_failures`)
- Runtime activation/deactivation
- Startup sweep to re-activate keyless providers
- Free-tier rate-limit metadata for local strategies

## Router Pipeline

The router is a multi-stage pipeline under `services/router`:

1. **Task Classifier** — extracts modality (text, image, audio, embedding) and required capabilities (streaming, tools, vision, reasoning)
2. **Capability Filter** — removes models that don't support required modality/capabilities
3. **Meta-model Resolution** — maps aliases (`auto`, `auto-fast`, `auto-smart`, `auto-agentic`, `auto-coding`) to actual candidates; supports global/per-request `costFilter=free`
4. **Sticky Session** — reuses the last working provider across turns when possible
5. **Provider Preference Filter** — tenant-specific provider preferences, `x-provider-preference`, `DMRX_LOCAL_FIRST`
6. **Availability Filter** — removes unhealthy providers (health checker failures)
7. **Rate Limit Filter** — sliding window check with optional free-tier rate limits injected from `freeTierMetadata`
8. **Policy Filter** — applies tenant policies + tool-allowlists/blocklists + cost limits
9. **Quota Filter** — tenant quotas + free-tier budgets
10. **Free-Tier Strategy** — re-ranks free providers via `DMRX_FREE_TIER_STRATEGY` (`none`/`prioritize`/`load_balance`/`fallback`) or per-request `x-free-tier-strategy` header
11. **Cost/Latency Scorer** — scores candidates on cost, latency, quality with `frontier`/`balanced`/`economy` targets
12. **Final Selector** — epsilon-greedy selection with optional Thompson Sampling bandit; when enabled, Thompson replaces greedy across all candidate sets
13. **Fallback Chain** — ordered list of candidates for automatic failover

Optional extensions:
- **WorkerPoolFanout** — `DMRX_WORKER_POOL_FANOUT=true` wires a fanout executor that records `WorkerJob` rows for parallel sub-tasks from `TaskDecomposer`
- **Cluster Scorer** — optional cluster-side scoring; falls back to Thompson Sampling when unavailable
- **Reward Updater** — persists bandit state to `bandit_state` table with snapshot/serialization

## Meta-Model Resolution

Meta-model aliases are resolved at request time by the router pipeline:
1. Apply alias-specific scoring weighting (speed, quality, context length, specialization)
2. Select the best match dynamically from all providers (paid + free) or free-only via `costFilter=free`
3. Honor per-request `x-cost-filter` and per-conversation sticky providers

If no provider matches, the gateway returns `503 No available providers`.

## Security Model

- **API Key Auth** — tenant API keys verified with timing-safe comparison
- **Admin Auth** — separate admin API key for `/v1/admin/*` routes; runtime rotation supported via `/admin/security/rotate-admin-key`
- **Agent RBAC** — per-agent enabled-tools enforcement via `agent-rbac` middleware and policy tool-allowlists
- **Encryption at Rest** — provider API keys encrypted with AES-256-GCM (`DMRX_ENCRYPTION_KEY`)
- **CORS/Trust Proxy** — explicit origin allowlist, configurable trusted proxies
- **Security Headers** — CSP, X-Frame-Options, X-Content-Type-Options, HSTS
- **Rate Limiting** — configurable per-tenant/gateway rate limits; free-tier injections at route time
- **SSRF Validation** — admin routes validate provider base URLs to prevent SSRF
- **Input Validation** — Zod schema validation on all admin endpoints
- **Error Sanitization** — 500+ errors return generic messages, no internal details leak
- **Audit Logging** — admin actions and select MCP/RBAC events recorded to SQLite audit tables

## Needle Router Integration

DMR-X can call a local **Needle 2** (`cactus-needle`) semantic pre-router (`services/needle-router`, localhost:8011) from `apps/gateway/src/lib/needlePreFilter.ts`. It posts the user query plus the candidate tool list to Needle 2, which returns the subset of relevant tools; if Needle 2 is unavailable, the gateway silently falls back to the full list. Needle 2 uses a C inference engine (no JAX), a 256-token sliding window, and an optional tool-retrieval head. This keeps large tool sets cheap to search without requiring every gateway to embed a full vector index.

## MCP Ecosystem

The MCP surface is split across a self-hosted server, a client/aggregator, and an admin control plane.

### MCP Server (`services/mcp-server`)
Exposes **40+ tools** and acts as a standalone MCP endpoint.

| Group | Tools |
|-------|-------|
| Routing/generation | `dmrx_chat`, `dmrx_chat_stream`, `dmrx_models`, `dmrx_status`, `dmrx_batch`, `dmrx_workflow`, `dmrx_rerank`, `dmrx_embed`, `dmrx_transcribe`, `dmrx_speak`, `dmrx_generate_image` (+stream), `dmrx_generate_video` (+stream), `dmrx_generate_music`, `dmrx_generate_3d` |
| Context/memory | `dmrx_context_save`, `_load`, `_list`, `_summarize`, `_compress` |
| Filesystem | `dmrx_read_file`, `_write_file`, `_edit_file`, `_list_files`, `_search_files` |
| Skills | `dmrx_skill_get`, `_list`, `_search`, `_sync` |
| Presets/Templates | CRUD sets for presets and templates, plus `_execute` |
| Tool search | `dmrx_tool_search`, `dmrx_tool_list` |

Transports: `stdio` (default), `sse`, `http`. Configure with `DMRX_MCP_TRANSPORT`.

### MCP Proxy / Aggregator
Outside MCP clients (**Claude Desktop**, **Cursor**, **Continue**, etc.) can consume DMR-X as an MCP server. For internal/external integration, the server uses `services/mcp-client` to aggregate upstream MCP tools. Upstream tools are registered under `<serverId>__<toolName>` with a `[Proxied via MCP server '<id>']` description prefix, preventing collisions.

- **Hot-reload**: when configured via `dmrx-mcp.config.json` (`aggregation.servers`), editing the file live-reconnects/disconnects upstreams and re-registers tools without a restart.
- **Per-server authorization**: optional `allowedTools` arrays restrict which upstream tools are visible.

### RBAC + Guardrails + Audit
- **RBAC** — `policies/tool-invocation-policy.ts` enforces per-tool allowlists based on admin policies, tenant config, and request context
- **Guardrails** — input validation, JSON Schema validation, and `FilterEngine` for PII redaction and content filtering before execution
- **Audit** — dedicated `audit/audit-logger.ts` records MCP tool invocations, with admin-configurable audit settings (`/admin/mcp/audit/config`)

### A2A / Federation
- **A2A** — agent-card publication (`a2a/agent-card.ts`) and task manager (`a2a/task-manager.ts`) expose DMR-X agent cards over A2A
- **Federation** — `federation/manager.ts` supports cross-instance federation; admin surfaces CRUD peers and sync state via `/admin/mcp/federation/*`

### Workflows
A built-in workflow engine (`workflow/engine.ts`) composes multiple MCP/tool calls with `retry_policy`, `fail_fast`, and `persist` semantics — exposed both as `dmrx_workflow` and internally.

## Admin & Admin-UI

`apps/gateway/src/routes/admin.routes.ts` is a single large route module exposing **100+ `v1/admin` endpoints** under auth middleware. Major surfacing:

- **Tenancy & Identity**: tenants, organizations, members, API keys, admin-key rotation, audit logging, SSRF-safe provider base URLs
- **Provider/Model Management**: providers (CRUD, OAuth start/callback/device-code/refresh, key/secret tests, delete), models (free-tier verify/refresh, CRUD), catalog discovery, free-tier summary
- **Policy/Quota/Billing**: policies CRUD, quota lookups, free-tier budgets, billing summary, credit topups and transactions
- **Benchmarks**: leaderboard, battles/tournaments, validate/run tournaments, model stats/history, validation queue
- **Telemetry + Observability**: event list, SSE stream (`/admin/telemetry/stream`), dashboard SSE stream, routing decisions, cost dashboard
- **Workers/Sandbox/Memory**: worker list/heartbeat/drain/resume, job list, sandbox jobs cancel, memory search/stats
- **Federation + Settings**: federation config + peers, settings, integrations test
- **AaaS Direct**: agents, marketplace, installation flow control
- **Godmode Control**: fusion panels + slot management
- **MCP Plane**: status, tools, tools execute, config, tool-search config, guardrails config, audit config, RBAC policies CRUD, federation config/peers, A2A config, aggregation servers CRUD
- **Godmode Server Lifecycle**: install/start/stop/status/config endpoints under `/godmode/server/*`

`apps/ui` is a React 19 + Vite 6 SPA. Production build outputs to `apps/gateway/public`, which Fastify serves as static files with SPA fallback. In development, Vite proxies `/v1/*` to the gateway. The UI exposes 22+ pages and syncs config changes to `.env` when non-null/empty provider keys are entered.

## Agent Platform (AaaS)

DMR-X ships an **Agent-as-a-Service runtime** built under `services/agent-registry`, `services/agent-runtime`, `services/skill-loader`, and supporting services.

- **Definitions + Instances** — `agent-registry` stores agent definitions (personality, system prompt, model tier, skills, allowlists, nudge settings) and instances via `agent_sessions`.
- **Marketplace/Import** — agents can be provisioned from the in-app marketplace, ZIP, GitHub, or direct import. `/v1/marketplace` and `/v1/marketplace/:id/install` expose browse/install flows.
- **Durable Sessions** — `AgentSessionStore` persists `ConversationState` and step artifacts (`session_steps`) to SQLite, enabling pause/resume after approvals, interruptions, or restarts. A per-conversation in-process mutex serializes concurrent requests.
- **Resume/Retry** — completed or interrupted runs can be resumed without restarting retry semantics. Agent runtime classifies provider errors (502/overload vs auth/context/budget) and falls back across meta-model aliases (`auto` → `auto` → `auto-fast`) on transient failures.
- **Subagent Isolation** — offers per-tenant, per-instance execution context.
- **Scheduler** — `AgentScheduler` persists cron jobs to `agent_scheduled_jobs` and triggers agent chat via internal gateway calls.
- **On-Demand Skills** — progressive disclosure at runtime: skills are advertised one-line in the prompt and loaded mid-run via skill tool calls, avoiding full-body prompt bloat. Skill-Capture nudges synthesize captured reusable behaviors.
- **Evaluation/Telemetry** — `evaluateExecution` computes tool-success-rate, budget adherence, turn efficiency, and an overall score; executions feed billing records and `agent_executions` ledger.
- **MCP Native Surface** — external MCP clients can create, list, run, and inspect agents via provided MCP tools without forking DMR-X.

## Godmode

`services/godmode` is a client that wraps an externally managed G0DM0D3 server, while **`services/server-manager`** manages lifecycle of a locally deployed G0DM0D3 instance (git-clone, install, docker-native or bun-native start/stop, health check, persistence in `server_instances`).

### Godmode Routes
`POST /v1/godmode/chat`, `/ultraplinian`, `/consortium`, `/autotune`, `/parseltongue`, `/transform`, `/feedback`; their streaming variants; `GET /v1/godmode/tier`, `/godmode/health`, `/godmode/feedback/stats`. Plus lifecycle endpoints `POST /v1/godmode/server/install|start|stop`, `GET /v1/godmode/server/status|config`.

### Godmode Features
- **Standard Chat** — AutoTune/Parseltongue/STM pipeline
- **ULTRAPLINIAN** — multi-model racing with liquid SSE streaming
- **CONSORTIUM** — hive-mind synthesis with long timeouts
- **AutoTune** — parameter analysis over conversation history
- **Parseltongue** — text obfuscation (technique + intensity)
- **STM** — semantic transformations (hedge reducer, direct mode, curiosity bias, casual mode)
- **Feedback (EMA learning loop)** — submit ratings + fetch stats from `/v1/feedback/stats`
- **Config hot-reload** — `setConfig()` rotates base URL/key without re-instantiating the service

## UI

`apps/ui` is a React 19 + Vite 6 SPA. Its production build outputs to `apps/gateway/public`, which the gateway serves as static files with SPA fallback.

Pages include: Dashboard, Playground, Providers, Models, FreeTier, FreeTierDashboard, Tenants, Policies, Quotas, Requests, Routing, Benchmarks, Observability, Memory, Workers, Federation, Sandbox, Settings, Usage, MCP, Connect, Tools, Marketplace, Agents, AgentAnalytics, FusionPanel, CostDashboard, Credits, Infrastructure, Integrations, ClaudeCode, Codex, OpenCode, Antigravity, Compression, NotFound, plus config tabs inside settings.

The UI communicates with the gateway via the `/v1/admin/*` API endpoints. In development, Vite runs at `:4200` and proxies `/v1/*` to the gateway at `:3000`.

## Monitoring / Operator

- `monitoring/` ships Prometheus/Alertmanager/Loki/Grafana configs and dashboards.
- `helm/` provides a Helm chart for Kubernetes deployment.
- `services/operator` includes a Kubernetes operator with CRDs for MCP, federation, and workflows.
- OpenTelemetry traces and metrics are emitted throughout the gateway (`trace.getActiveSpan()`), router, adapters, and telemetry service.

## Design Philosophy

These principles guide the architecture and the design decisions made throughout the codebase.

### Core Principles

- **Unified multi-format API** — accept OpenAI, Anthropic, Gemini, and CloudCode wire formats; the gateway normalizes to a single internal representation and replies in the client's format.
- **Local-first execution** — Ollama, vLLM, llama.cpp are first-class alongside remote providers.
- **Dynamic routing** — clients never pick a provider directly; the router decides at request time.
- **Multi-provider orchestration** — fan-out, fan-in, fallback chains across heterogeneous providers.
- **Self-learning routing** — Thompson Sampling bandit improves selection based on observed quality; bandit state is persisted in SQLite.
- **Quota-aware execution** — every request is checked against tenant and free-tier budgets.
- **Federated intelligence** — multiple instances can share learned signals and provider health.
- **Multi-tenancy** — per-tenant API keys, quotas, policies, billing, memory namespaces.
- **Multimodal support** — text, image, audio, video, music, embeddings, OCR, 3D through the same routing fabric.
- **Single-binary distribution** — `bun build --compile` produces a standalone executable with embedded UI; Helm + K8s operator for cloud scale.

### Intelligence Hierarchy

The router organises provider selection along a five-layer hierarchy, where each layer is a different way of resolving a request:

1. **Brain** — the long-lived reasoning model that handles complex, multi-step tasks
2. **Thinkers** — specialised reasoning models selected by task type (coding, math, planning)
3. **Executers** — fast, instruction-following models for well-defined tasks
4. **Workers** — short-lived background processes spawned for parallel subtasks; implemented as `WorkerPoolFanout` and observable today via `/v1/admin/workers` and `worker_jobs`
5. **Temporary Workers** — ephemeral local models spun up just for a single request and torn down

The current router implements the Brain, Thinkers, Executers, and **Workers** layers (Workers landed in v0.4.0). Temporary Workers are in-progress.

**Workers layer wiring:** when the gateway has `DMRX_WORKER_POOL_FANOUT=true`, `Router.setAdapterExecutor` constructs a `WorkerPoolFanout` and passes it to `CompositeExecutor`. Parallel sub-task groups (from `TaskDecomposer`) are dispatched via `WorkerPoolFanout.runParallel`, which:
1. Lazily registers the gateway as a Worker (type `router-fanout`).
2. For each sub-task, calls `WorkersService.assignJob` to record a `WorkerJob` (jobType `router.fanout`).
3. Executes the sub-task in-process via the existing `AdapterExecutor`.
4. Calls `WorkersService.completeJob` with success or error.

### Operational Philosophy

DMR-X acts as the intelligent execution fabric between clients and AI providers. Clients never directly select providers. The router dynamically determines the best execution path based on quality, cost, latency, quotas, modality, and policy — and learns from every request. External MCP clients, admin APIs, and programmatic agents all resolve through the same routing fabric, with AaaS adding durable execution, subagent isolation, and marketplace-driven provisioning on top of the same foundation.
