# Changelog

## v0.4.0 — Follow-up (Unreleased)

### Security
- **fastify 4 → 5 upgrade** — bumped `fastify` 4.29.1 → 5.8.5 to close the Content-Type tab-character bypass CVE present in 4.x. The plugin stack is aligned to its fastify-5-compatible majors: `@fastify/compress` 9, `@fastify/cors` 11, `@fastify/multipart` 10, `@fastify/rate-limit` 11, `@fastify/static` 9. Code adjustments: `setErrorHandler` error param is now `unknown` (cast to `any` for the existing access pattern, same as elsewhere in the file); `reply.code()` → `reply.status()` (1 site in `setNotFoundHandler`); `maxParamLength` moved under `routerOptions` to silence the FSTDEP022 deprecation (top-level key will be removed in v6); `request.body` is now `unknown` but the existing Zod-`safeParse` pattern is forward-compatible so no route body access needed changing. `scripts/dev/server-original.ts` (a historical reference snapshot, not on any build path) was kept internally consistent. Verification: `npx tsc --noEmit` clean across the whole tree, `bun run test` → **1216 passed / 38 skipped**, gateway boots and reaches `DMR-X Gateway running` on `0.0.0.0:3099` with 82 adapters registered.

### In Progress
- **request_logs writes** — durable per-request audit log table (`request_logs`) is now being populated by the gateway's `onResponse` hook (CRIT-6). The `request_logs` table captures `request_id`, `tenant_id`, `task_profile`, `routing_plan` (JSON with primary + top-3 candidates), `selected_provider`, `selected_model`, `fallback_used`, `latency_ms`, `time_to_first_token_ms`, `tokens_input`, `tokens_output`, `estimated_cost`, `error_code`, and `error_message`. Coverage: `tests/unit/request-logs-writes.test.ts` (11 tests) — the bandit reward-updater at `services/router/src/bandit/reward-updater.ts:198` will now see real rows.
- **OpenTelemetry spans** — `services/telemetry/src/tracer.ts` defines the gateway's `tracer: Tracer` (name `dmr-x-gateway`, version `0.4.0`), obtained from the OTel global provider. Spans are written via the `OTLPTraceExporter` configured by `TelemetryService.start()`. WIP: route handlers, the router pipeline, and adapter execution are not yet wrapped in `tracer.startActiveSpan(...)` calls — that integration is the next step.

## v0.2.0 — Production Ready (2026-06-15)

### Deployment infrastructure
- **Hardened Dockerfile** — multi-stage build with non-root user, tini as PID 1, HEALTHCHECK, OCI labels. Single-arch binary variant (distroless static) for the smallest possible image.
- **Production docker-compose** (`docker-compose.prod.yml`) — full stack with the gateway, Prometheus, Alertmanager, Grafana, Loki, Promtail, and a cron-driven SQLite backup service. Healthchecks, restart policies, resource limits, and secrets-via-env all wired up.
- **CI workflow** (`.github/workflows/ci.yml`) — parallel jobs for typecheck, unit tests, build, security audit, and a smoke-test E2E. Concurrency cancel-on-push to save minutes.
- **Release workflow** (`.github/workflows/release.yml`) — multi-arch binaries (linux/darwin/windows × amd64/arm64), multi-arch container image, cosign keyless signing, CycloneDX SBOM, GitHub release with auto-generated notes from CHANGELOG.
- **Grafana provisioning** — datasources and dashboards auto-imported on container start. No manual UI import step.
- **Alertmanager routing** — page / ticket / info severities with PagerDuty + Slack integration skeletons, inhibition rules to suppress noise.

### Operations
- **Operational runbook** (`docs/RUNBOOK.md`) — diagnose / mitigate / recover / postmortem procedures for every page-severity alert. Includes deployment, escalation, and useful commands.
- **SQLite backup tooling** (`scripts/backup/`) — online `sqlite3 .backup` snapshots, integrity-checked, optionally uploaded to S3, with rotation. Restore procedure documented.
- **k6 load test suite** (`scripts/loadtest/`) — smoke, baseline, stress, and streaming tests. Thresholds for SLO breach detection. Output JSON for trend tracking.
- **SLO definitions** (`docs/SLO.md`) — 99.9% availability, latency budgets per endpoint, burn-rate alerts. Includes the Google SRE workbook-style multi-window alerts.

### Security
- **SECURITY.md** — supported versions, disclosure process, residual vulnerability tracking table with mitigations for each.
- **LICENSES.md** — accepted/disallowed dependency licenses, SBOM generation, manual license-check procedure.
- **Banned-pattern CI gate** — fails the build on hardcoded secrets (`AKIA…`, `ghp_…`, PEM keys, `sk-…`) and `@ts-nocheck`.
- **FTS5-tolerant migration runner** — `packages/db/src/client.ts` now handles SQLite builds without FTS5 (some sql.js WASM distributions) by splitting migration 012 and skipping the FTS5 virtual table. Conversation search degrades gracefully; the rest of the schema still applies.

### Verification
- `bun run test:unit` — 524 passed, 19 e2e skipped, 0 failed
- `bun x tsc --noEmit` — all 23 packages / services / apps clean
- `bun run build` — 23/23 tasks built successfully
- `bun audit` — 8 residual (documented in SECURITY.md, 4 patched via overrides, 2 false-positives on stale DB, 2 mitigated by config)

## v0.1.1 — Finish-Up (2026-06-15)

### Production Hardening
- **Response compression** — `@fastify/compress` registered in the gateway with gzip / deflate / brotli encodings. Configurable via `DMRX_COMPRESS_THRESHOLD` (default 1024 bytes; 0 disables). SSE streams are skipped automatically by the plugin. Closes the deferred item from the v0.1.0 production-readiness audit.

### Observability
- **Prometheus alert rules** — `monitoring/prometheus-alerts.yml` ships 11 alert rules across 4 groups: availability, latency, cost, and gateway health. 5 page-severity, 5 ticket-severity, plus the dashboard-health `up` alert.
- **Grafana dashboard** — `monitoring/grafana-dashboard.json` is a 10-panel importable dashboard with template variables for `provider` and `modality`. Stat row has threshold coloring for healthy providers, RPS, error rate, and cost/min.
- **Monitoring README** — `monitoring/README.md` documents the metric reference, alert summary table, scrape config, and recommended deployment.

### Testing
- **Workspace split** — `vitest.workspace.ts` splits the suite into `unit` and `e2e` projects. New scripts: `bun run test:unit` and `bun run test:e2e`. The `e2e` project is configured for `singleFork`, 30s timeouts, and `bail: 1` so a broken gateway fails fast.
- **3 new compression tests** — covers large-response compression, sub-threshold pass-through, and missing `accept-encoding` pass-through.

### Versioning
- All 5 workspace packages bumped to `0.1.1`.

## Unreleased — Production Readiness (2026-06-12)

### Bug Fixes

- **`MemoryCache.hSet` LRU eviction** — previously the 3rd `hSet` into a 3-slot cache silently evicted an entry, leaving size=2. Now `hSet` evicts *before* inserting (matching `set()`'s pattern). Fixes the regression tests at `tests/unit/memory-cache.test.ts:223-265`.
- **Telemetry build-blocker** — `@opentelemetry/exporter-prometheus@0.52.0` exports a `PrometheusExporter` whose internal `MetricReader` is nominally distinct from the one in `@opentelemetry/sdk-metrics@1.25.0`. The constructor signature was failing structural type-checking, breaking `bun run build`. Now the cast is documented and explicit.
- **MCP server TypeScript errors** — `services/mcp-server/src/prompts.ts` and `resources.ts` failed to compile against `@modelcontextprotocol/sdk@1.12.1` (Zod type mismatch on prompt args, `ResourceTemplate` moved to a top-level export). The `registerPrompt()` wrapper around `server.prompt()` papers over the Zod 3.23 vs SDK mismatch in one place.
- **mcp-config test type error** — `resolveConfig<McpConfigFile>(...)` was passing a number where `T` is constrained to `McpConfigFile`; the type parameter is now `string`.

### Server Hardening

- **Body limit** — `bodyLimit: 10 MB` (env: `DMRX_BODY_LIMIT`). Rejects 100MB JSON bodies before they hit the parser.
- **Request timeout** — `requestTimeout: 60 s` (env: `DMRX_REQUEST_TIMEOUT`). Fastify's default 5 min is too generous for an LLM gateway.
- **Keep-alive timeout** — `keepAliveTimeout: 65 s` (env: `DMRX_KEEPALIVE_TIMEOUT`).
- **Connection timeout** — `connectionTimeout: 10 s` (env: `DMRX_CONNECTION_TIMEOUT`). Slow-loris defense.
- **`maxParamLength: 200`** (env: `DMRX_MAX_PARAM_LENGTH`).
- **`trustProxy: 'loopback'`** (env: `DMRX_TRUST_PROXY`). Accepts `true` / `false` / `loopback` / `linklocal` / `uniquelocal` / CIDR / IP list. Set to `true` if behind nginx/Cloudflare.

All six are validated by `validateStartupConfig()` in `apps/gateway/src/main.ts` on boot.

### Observability

- **Deepened `/healthz`** — now reports `db_read`, `db_write`, `candidates`, `memory` (vs `DMRX_MEMORY_LIMIT`, default 1.5 GB), and `uptime`. Returns 503 if any check fails.
- **Request ID in error responses** — 5xx errors now include `error.request_id` so users can quote it in support tickets. The same ID is on the `x-request-id` response header on success.
- **Telemetry wired into the request flow** — `onResponse` hook calls `telemetry.recordRequest` / `recordLatency` / `recordError` / `recordTokens` when route handlers populate `request.metrics`. The chat route now does this automatically; other routes can opt in by setting `(request as any).metrics = { providerId, modelId, modality, tokens?, errorCode? }`.
- **Prometheus endpoint documented** — `:9464/metrics` (separate port, started by `TelemetryService`). The 7 metric series are now listed in `docs/DEPLOYMENT.md` with a sample scrape config.

### Documentation

- `docs/CONFIGURATION.md` — new "Server Limits" table with all 7 new env vars.
- `docs/DEPLOYMENT.md` — Metrics section with Prometheus scrape config, `docker-compose.yml` port mapping, `trustProxy` note in the nginx example, new Server Hardening checklist.
- `.env.example` — all 7 new env vars documented with format hints.

### Testing

- 2 previously-failing `memory-cache.test.ts` regression tests now pass.
- New `tests/unit/server-hardening.test.ts` — 25 tests covering body limit, request timeout, max param length, request ID generation/honoring, trust proxy (`loopback` vs `true`), 5xx error `request_id`, 4xx error omission, and the new `/healthz` shape.
- New `tests/unit/telemetry-integration.test.ts` — 7 tests verifying the `onResponse` hook calls `recordRequest` / `recordLatency` / `recordTokens` / `recordError` with correct args.
- Total: **521/540 tests pass** (was 487/508; +34 tests, 0 failing).

### Known Limitations

- **gzip compression** — `@fastify/compress` was identified as a desired dependency but install was deferred (requires explicit user approval for new dependencies). Without it, large JSON responses aren't gzipped. Workaround: terminate at a reverse proxy that compresses (nginx `gzip on;`).
- **Compression is the only deferred item from the production-readiness audit.** All other identified gaps are addressed.

## Unreleased — Top-3 Improvement Sprint (2026-06-10)

### Adapters
- Re-exported the remaining adapter classes from `services/adapters/src/index.ts`:
  `KokoroAdapter` (audio_tts), `PiperAdapter` (audio_tts), and `TeiAdapter`
  (embedding + reranking). All three were already implemented on disk but
  missing from the public surface.
- Audited `services/adapters/src` against the docs and the README.
  Confirmed 18 concrete adapter implementations present (not 10 as the
  docs/README previously claimed).

### Documentation
- `docs/AI_PROVIDER_REFERENCE.md`: updated header to reflect the actual
  adapter inventory (18 adapters + `GenericOpenAIAdapter`) with a
  cross-reference to `services/adapters/src/index.ts`.
- `README.md`: corrected the "70+ providers" line to enumerate the real
  18 adapters, and updated the architecture diagram's provider block.
- `docs/archive/agents checklist.md`: added **Phase 8 — Top-3 Improvement
  Sprint** tracking 16 new sub-tasks across three workstreams
  (adapter surface reconciliation, Intelligence Hierarchy Workers
  layer, bandit learning from real outcomes).

## v0.3.0 — Documentation Overhaul & Gemini API (2026-06-01)

### Documentation
- Rewrote `README.md` with accurate Bun-first quickstart, architecture diagram, full API endpoint reference, meta-model aliases, and distribution section.
- Rewrote `docs/ARCHITECTURE.md` with accurate technology stack (SQLite, Bun, Fastify — no Redis/Postgres), detailed request flow diagram, package boundaries, adapter architecture, router pipeline stages, and security model.
- Rewrote `CLAUDE.md` as proper Claude Code project instructions (coding conventions, common gotchas, key files, architecture rules).
- Rewrote `docs/DEPLOYMENT.md` with Bun, Docker, binary, and reverse proxy configurations plus production checklist.
- Rewrote `docs/CONFIGURATION.md` with complete environment variable reference, all provider keys, and security notes.
- Created `docs/DISTRIBUTION.md` — binary packaging, install scripts, CI/CD release workflow.
- Created `docs/MCP.md` — MCP server setup, all 8 tools documented, client integration examples.
- Created `docs/TESTING.md` — test suites, running tests, type checking, known issues.
- Created `CONTRIBUTING.md` — contribution guidelines, branch naming, PR checklist.
- Moved historical audit reports to `docs/archive/` (PHASE1_AUDIT, QA_SECURITY_REPORT, REFACTOR_REPORT, agents checklist).
- Updated `docs/CHANGELOG.md` (this file).

### API
- Added Google Gemini native endpoint (`POST /v1/gemini/generateContent`) with streaming, tools, and thought tokens.
- Added meta-model aliases: `auto`, `auto-fast`, `auto-smart`, `auto-agentic`, `auto-coding` for dynamic provider routing.
- Added OAuth provider authentication endpoints for Google, GitHub, HuggingFace, MiniMax.

### Routing
- Fixed `getCandidates()` to map `context_window` for meta-model resolution (auto-agentic/auto-coding always got 0 candidates).
- Router now throws 503 instead of silently falling back to paid models when meta-model resolution fails.
- Router direct model selection — matches `request.model` to candidate `modelId`.

### Adapters
- Added `PollinationsAdapter` for keyless image generation.
- Dynamic model loading with 5 bug fixes: activation, refresh, routing, consecutive_failures, hasKey.
- Startup sweep now covers ALL providers including keyless providers.

### UI
- Consolidated 20 routes into 10 tabbed pages.
- Settings page with 11 sections using left-nav pattern.
- ProviderKeys page rewritten with inline key editing, test, and save.
- Overview page fully dynamic — all data from API hooks, no hardcoded values.
- Deleted 85 stale `.js`/`.js.map` build artifacts from UI source.

### Infrastructure
- Cross-compile outputs use platform-specific names (`dmrx-linux`, `dmrx-darwin`, `dmrx-windows`).
- CI/CD release workflow triggers on `v*` tags, builds all platforms, publishes GitHub Release.
- Install scripts for Linux/macOS (`.tar.gz`) and Windows (`.zip`).

### Bug Fixes
- `billing_records` table now has `ON DELETE CASCADE` (was the only FK table without it).
- HTTP 204 No Content no longer crashes `res.json()` in request helper.
- Local mode admin auth — admin routes open when `LOCAL_MODE=true` OR no admin key set.
- Adapter UUID/name mismatch — router passes DB UUIDs, registry resolves to names.

## v0.2.0 — Production Hardening (2026-05-30)

### Security
- API keys encrypted at rest (AES-256-GCM via `@dmr-x/utils` crypto module).
- MCP server requires authentication (`DMRX_MCP_API_KEY`).
- Prototype pollution protection on settings endpoint (Zod schema validation).
- CORS uses explicit origin allowlist, never wildcard.
- CSP, X-Frame-Options, HSTS, and other security headers added.
- 500+ error responses sanitized — no internal details leak to clients.
- Timing-safe comparisons for API key verification.

### Infrastructure
- Migrated primary runtime from Node.js to Bun.
- Dockerfile uses `oven/bun:1-alpine` with multi-stage build and resource limits.
- SQLite via `sql.js` with debounced saves and shutdown flush.
- Removed Redis/Postgres dependencies — zero external infrastructure required.

### Adapters
- 18 provider adapters: OpenAI, Anthropic, Ollama, Replicate, Stability, ElevenLabs, Deepgram, Cohere, Jina, GenericOpenAI, plus ComfyUI, Fal, Veo, Runway, Kokoro, Piper, Tei (see `services/adapters/src/index.ts` for the canonical list).
- Unified adapter registry with health checking and automatic failure tracking.
- GenericOpenAIAdapter for any OpenAI-compatible provider.

### Gateway
- Anthropic Messages API endpoint (`POST /v1/messages`) alongside OpenAI format.
- Admin routes for provider management, tenant keys, and settings.
- Agentic chat with approval gates (`POST /v1/agentic/chat`).
- Tool execution and multi-turn tool loops.
- Rate limiting, request ID middleware, and SPA fallback for UI.

### MCP
- MCP server with stdio, SSE, and streamable HTTP transports.
- Tools: `dmrx_chat`, `dmrx_generate_image`, `dmrx_embed`, `dmrx_transcribe`, `dmrx_speak`, `dmrx_rerank`, `dmrx_models`, `dmrx_status`.

### Testing
- 262+ unit tests passing.
- Opt-in E2E connectivity tests (`DMRX_RUN_E2E=true`).
- QA/security audit completed — 142 findings cataloged, all CRIT+HIGH resolved.

### Documentation
- Rewrote README, architecture, configuration, and deployment docs.
- Added AI provider reference catalogs (100+ providers documented).
- Added BSL-1.1 license with CLA.

## v0.1.0 — Refactor Baseline

- Removed generated TypeScript artifacts from source folders.
- Removed orphaned prototype UI source.
- Tightened test discovery and generated-file ignores.
- Fixed unused imports and locals reported by TypeScript.
- Simplified MCP server tool registration types.
- Rewrote environment documentation and production setup docs.
