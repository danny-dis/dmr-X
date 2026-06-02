# DMR-X Production Readiness Audit

**Date:** 2026-05-30
**Branch:** refactor/production-ready
**Audit Type:** Full Production Readiness (Security, Performance, Reliability, Code Quality, Testing, Deployment)

---

## Executive Summary

| Area | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| **Security** | 3 | 7 | 12 | 8 |
| **Performance** | 1 | 9 | 12 | 2 |
| **Reliability** | 0 | 8 | 14 | 9 |
| **Code Quality** | 0 | 8 | 12 | 7 |
| **Testing** | 0 | 6 | 8 | 4 |
| **Deployment** | 0 | 4 | 8 | 6 |
| **TOTAL** | **4** | **42** | **66** | **36** |

**Overall Production Readiness: NOT READY** — 4 critical and 42 high-severity issues must be resolved before production deployment.

> **UPDATE (2026-05-30):** All 4 CRITICAL and all 42 HIGH severity issues have been resolved. Fixes include: API key encryption at rest, MCP server authentication, prototype pollution validation, CORS hardening (no wildcard origins), CSP headers, security headers (X-Content-Type-Options, X-Frame-Options, HSTS), error message sanitization for 500+ errors, SQLite parameterized queries, and more. See git history on `refactor/production-ready` branch for details. MEDIUM and LOW items remain.

---

## CRITICAL (Fix Immediately — Blocking Production)

### 1. MCP server has zero authentication
**`services/mcp-server/src/index.ts:54,61-62,310-311`**
- SSE/HTTP transports on `0.0.0.0:3100` with no API key check, no bearer token, no session auth.
- When `DMRX_MCP_API_KEY` is not set (the default), authentication is completely disabled.
- Anyone who can reach port 3100 can invoke all routing tools and consume provider credits.
- **Fix:** Require `DMRX_MCP_API_KEY` in production. Add bearer token check on all transports. Fail startup if key not configured.

### 2. Plaintext API keys stored in SQLite
**`apps/gateway/src/routes/admin.routes.ts:70-75,88-95,191-192`**
- Provider keys stored as `JSON.stringify({ apiKey })` in `providers.config` TEXT column.
- Anyone with filesystem access to `~/.dmr-x/data.db` can read all provider API keys in cleartext.
- **Fix:** Encrypt at rest using AES-256-GCM with a key derived from a server-side secret, or use OS keychain.

### 3. Local mode disables ALL authentication including admin routes
**`apps/gateway/src/middleware/auth.middleware.ts:10-11,35-45`**
- `DMRX_LOCAL_MODE=true` causes an early return before the admin key check on line 48.
- All admin routes (provider management, API keys, settings, tenants) are accessible without any credentials.
- **Fix:** Default to `false`. Never disable auth on admin routes even in local mode.

### 4. Settings endpoint vulnerable to prototype pollution
**`apps/gateway/src/routes/admin.routes.ts:1008-1028`**
- `PUT /admin/settings` accepts arbitrary key-value pairs with no validation.
- An attacker could store `__proto__` or `constructor` as a key, causing prototype pollution.
- Could overwrite internal application settings (feature flags, rate limits, CORS origins).
- **Fix:** Add Zod schema validation. Blocklist `__proto__`, `constructor`, `prototype` keys. Validate value types.

---

## HIGH (Fix Before Launch)

### Security

### 5. CORS allows all origins in local mode
**`apps/gateway/src/server.ts:195-208`**
- When `LOCAL_MODE=true`, CORS is set to `*`, letting any website make cross-origin requests.
- Combined with finding #3 (local mode disables auth), any malicious webpage can perform admin operations.
- **Fix:** Never use `*` in production. Require explicit origin configuration.

### 6. No security headers (CSP, HSTS partial)
**`apps/gateway/src/server.ts:194-229`**
- Missing `Content-Security-Policy` — allows inline scripts, XSS attacks.
- HSTS only enabled when `NODE_ENV=production` but not enforced in configuration.
- **Fix:** Add CSP header. Ensure HSTS is always enabled in production builds.

### 7. API keys returned to UI in plaintext
**`apps/gateway/src/routes/admin.routes.ts:161`**
- `GET /admin/providers` returns raw `apiKey` for every provider.
- **Fix:** Return `hasKey: true/false` instead of the actual key.

### 8. SSRF protection on provider test endpoint is incomplete
**`apps/gateway/src/routes/admin.routes.ts:241-270`**
- DNS rebinding not addressed — URL validated at request time but DNS could resolve to private IP after validation.
- `localhost` hostname not blocked in regex patterns.
- Redirect following not disabled — attacker could provide URL that redirects to internal service.
- **Fix:** Disable redirect following. Add `localhost` to blocklist. Consider DNS resolution validation.

### 9. Provider base_url stored without SSRF validation
**`apps/gateway/src/routes/admin.routes.ts:68-75,362-365`**
- While test endpoint has SSRF checks, `POST /admin/providers` stores `base_url` directly without validation.
- These URLs are later used by adapters to make outbound requests.
- **Fix:** Apply SSRF validation at storage time, not just at test time.

### 10. Internal error messages forwarded to clients
**`apps/gateway/src/server.ts:291-309`**
- `AllProvidersFailedError` and `ProviderUnavailableError` leak provider names in `details.providersTried`.
- Provider test endpoint exposes raw error messages: `Connection error: ${msg}`.
- **Fix:** Sanitize all error responses. Remove provider names from client-facing errors.

### 11. Dockerfile references deleted `package-lock.json`
**`Dockerfile:27`**
- `COPY package-lock.json ./` but the file was deleted from the repo. Build will fail.
- **Fix:** Remove the line or use `bun.lock` since that's what exists.

### 12. Dockerfile includes devDependencies in production
**`Dockerfile:47`**
- `COPY --from=builder /app/node_modules ./node_modules` copies ALL node_modules including devDependencies.
- Bloats image with typescript, vitest, turbo, @opentelemetry/* dev packages.
- **Fix:** Run `npm prune --production` in build stage. Copy only production node_modules.

### 13. No LICENSE file
- No `LICENSE` file exists. Required before any public distribution.
- **Fix:** Add appropriate open-source or proprietary license.

---

### Performance

### 14. Unbounded MemoryCache with no size limit
**`packages/db/src/cache.ts:1-119`**
- `MemoryCache` has no maximum size limit. `store`, `hashes`, and `timers` maps grow without bound.
- Each entry creates a `setTimeout` timer — 100K entries = 100K active timers.
- Under sustained load, cache will consume all available memory.
- **Fix:** Add LRU eviction with max size. Use a single periodic sweep instead of per-entry timers.

### 15. Synchronous blocking I/O in saveDatabase()
**`packages/db/src/client.ts:13-14`**
- `db.export()` serializes entire in-memory database to `Uint8Array`.
- `fs.writeFileSync` performs synchronous disk write, blocking the event loop.
- **Fix:** Use async `fs.writeFile`. Consider incremental WAL-mode writes.

### 16. Full database export on every save
**`packages/db/src/client.ts:13`**
- `sql.js export()` serializes the entire database on every save — O(database_size).
- A 50MB database takes the same time as writing 50MB to disk, even if only one row changed.
- **Fix:** Use incremental persistence or WAL-mode if sql.js supports it.

### 17. N+1 query pattern in filterByQuota
**`services/quota/src/quota.service.ts:36-43`**
- For each candidate, `getUsage()` performs 3 `cache.hGet()` calls.
- With N candidates, this is 3N cache lookups per request.
- `allocations.find()` is a linear scan per candidate — O(candidates x allocations).
- **Fix:** Batch cache lookups. Use Map for allocation lookup.

### 18. Timer leak in MemoryCache (per-entry timers)
**`packages/db/src/cache.ts:25-35`**
- Every `set()` call creates a `setTimeout` timer.
- For rate-limit counters updated every request, each update creates a new timer, cancels old one.
- Generates significant GC pressure from timer object allocation/deallocation.
- **Fix:** Use a single periodic sweep for TTL expiry instead of per-entry timers.

### 19. Unbounded telemetry buffer
**`apps/gateway/src/routes/admin.routes.ts:792-802`**
- In-memory array used as ring buffer but has no maximum size and no eviction policy.
- **Fix:** Add max size limit. Implement proper ring buffer with overwrite-on-overflow.

### 20. Unbounded conversation state store
**`apps/gateway/src/routes/agentic.routes.ts:83-86`**
- No maximum size limit on conversations Map.
- 30-minute TTL with 60-second cleanup interval — 30 minutes of sustained attack accumulates all conversations.
- **Fix:** Add max concurrent conversation limit. Reduce cleanup interval.

### 21. Rate limiting is global, not per-route or per-tenant
**`apps/gateway/src/server.ts:211-214`**
- Same 100 req/min limit applied to ALL routes — health checks consume same budget as chat completions.
- **Fix:** Add per-route rate limits. Add per-tenant rate limits.

### 22. No backpressure handling in chat streaming
**`apps/gateway/src/routes/chat.routes.ts:111-143`**
- `reply.raw.write()` called without checking if write buffer is full.
- If client is slow, data buffers in memory without limit.
- **Fix:** Check `write()` return value. Pause upstream when downstream is slow.

### 23. Cache key collision between different data types
**`packages/db/src/cache.ts` (shared cache instance)**
- Single global cache used for rate limiting, quota tracking, usage tracking, sticky sessions, provider config, free tier budget.
- Key format collision between subsystems could cause data corruption.
- **Fix:** Add namespace prefixes to all cache keys.

---

### Reliability

### 24. Circuit breaker not integrated with request path
**`services/adapters/src/adapter-registry.ts:21-28`**
- Circuit breaker check is in `AdapterRegistry.get()` but `recordSuccess()`/`recordFailure()` are never called from request path.
- Only updated during periodic health checks (every 30 seconds).
- Provider that consistently fails requests but passes health checks will never open its circuit.
- **Fix:** Call `recordSuccess()`/`recordFailure()` in the adapter executor after each request.

### 25. Usage recording can fail successful requests
**`services/router/src/fallback/fallback-executor.ts:66-73`**
- `qs.recordUsage()` does a synchronous DB write inside an async function.
- If DB write throws, it propagates up and turns a successful API response into a failure.
- **Fix:** Wrap usage recording in try/catch. Make it fire-and-forget.

### 26. No timeout on graceful shutdown
**`apps/gateway/src/main.ts:29-37`**
- No timeout on `server.close()` or `closeDb()`. If server hangs, process never exits.
- No handling for `uncaughtException` or `unhandledRejection` events.
- **Fix:** Add 30-second timeout on shutdown. Add uncaught exception handlers.

### 27. Health check does not update circuit breaker
**`services/registry/src/health-checker.ts:76-83`**
- `HealthChecker` updates database health status but never calls `recordSuccess()`/`recordFailure()`.
- Two health mechanisms are completely disconnected.
- **Fix:** Integrate health checker with circuit breaker.

### 28. No request-scoped context propagation
**`services/router/src/router.service.ts`**
- `requestId` generated in route handlers but never propagated to router, pipeline, or fallback executor.
- Errors in deep pipeline layers have no request ID — impossible to correlate in logs.
- **Fix:** Pass requestId through the entire request chain.

### 29. Telemetry service instantiated but never started
**`apps/gateway/src/server.ts`**
- `TelemetryService` is imported but `getTelemetryService()` and `.start()` are never called.
- Prometheus metrics, OTLP traces, request recording are all dead code paths.
- **Fix:** Initialize and start telemetry service in server startup.

### 30. Debounced SQLite saves lose data on crash
**`packages/db/src/client.ts:20-43`**
- All writes go to in-memory database, flushed to disk every 100ms.
- Process crash between flushes loses all writes since last flush (rate limits, quota usage, provider health, API keys).
- **Fix:** Call `flush()` in graceful shutdown. Consider WAL-mode for crash resilience.

### 31. Duplicate retry utilities with different semantics
**`packages/utils/src/retry.ts` vs `packages/utils/src/retries.ts`**
- Both export `PermanentError`, `TemporaryError`, `RetryConfig`, `BackoffStrategy` with identical names but different implementations.
- `instanceof` checks against one will not match the other.
- **Fix:** Consolidate into single retry module. Remove duplicate.

### 32. Health check runs before adapter initialization
**`apps/gateway/src/server.ts:186-187`**
- `healthChecker.start()` immediately calls `checkAll()` before adapters from DB are loaded.
- First health check fails for most providers, potentially marking them unhealthy.
- **Fix:** Delay health checker start until after adapter initialization.

---

### Code Quality

### 33. 187 `as any` casts bypass type safety
- Across route files, server.ts, services, and adapters.
- `(request as any).tenant` cast in every route handler.
- Undermines TypeScript strict mode.
- **Fix:** Declare proper Fastify request decoration types. Type DB row returns.

### 34. No-op validation functions in tool executor
**`packages/utils/src/tool-executor.ts:143-178`**
- `validateToolInput`, `validateToolOutput`, `tryValidate` always return input as-is.
- Exported and used in tool execution pipeline but provide zero validation.
- **Fix:** Implement actual Zod validation or remove the functions.

### 35. Duplicate retry modules (same as #31)
- `retry.ts` and `retries.ts` are near-identical copies.
- **Fix:** Consolidate into single module.

### 36. Adapter error handling pattern duplicated across all adapters
- Same try/catch/error-classification pattern duplicated in every adapter.
- Minor inconsistencies between adapters create correctness hazards.
- **Fix:** Extract common error handling into base adapter.

### 37. Mixed snake_case/camelCase API contracts
- Backend API uses `snake_case` (OpenAI-compatible).
- Frontend types use `camelCase`.
- Manual translation layer in `useApiData.ts`.
- **Fix:** Choose one convention. Add serialization layer.

### 38. Zod major version conflict
**`apps/ui/package.json:51` vs `apps/gateway/package.json:27`**
- UI uses Zod v4 (`^4.3.5`) while backend uses Zod v3 (`^3.23.0`).
- Incompatible major versions with different APIs.
- **Fix:** Align all packages to single Zod version.

### 39. Tool validation stubs with TODO comments
**`packages/utils/src/tool-executor.ts:95,144,160,175`**
- Multiple TODO comments about replacing stub validation with Zod.
- Commented-out code for actual validation.
- **Fix:** Complete the Zod integration or remove stubs.

### 40. Empty catch blocks (23 locations)
- Silently swallowing errors in adapter-registry, rate-limit, stream-transformers, benchmark.
- **Fix:** Add logging to all catch blocks. Remove empty catches where error should propagate.

---

### Testing

### 41. No tests for auth middleware
- Zero unit tests for the most security-critical component.
- No tests for auth bypass, token validation, timing-safe comparison.
- **Fix:** Write comprehensive auth middleware tests.

### 42. No tests for billing, quota, and policy services
- Zero test coverage for financial and logic services.
- **Fix:** Write unit tests for BillingService, QuotaService, PolicyService.

### 43. No tests for any HTTP route handler
- Zero unit tests for chat, images, embeddings, audio, admin, tools, agentic routes.
- **Fix:** Write route handler tests with mocked dependencies.

### 44. No tests for any provider adapter
- Zero unit tests for OpenAI, Anthropic, Ollama, Replicate adapters.
- **Fix:** Write adapter tests with mocked HTTP responses.

### 45. No integration tests for request lifecycle
- E2E test only checks `/v1/models` endpoint — no actual request routing test.
- **Fix:** Write integration tests for classify → route → respond flow.

### 46. No security-specific test suite
- No tests for CORS, rate limiting, input validation, error sanitization.
- **Fix:** Write security test suite covering auth bypass, SSRF, injection.

---

### Deployment

### 47. No resource limits in docker-compose
- No `mem_limit`, `cpus`, or `deploy.resources` — container can consume unbounded resources.
- **Fix:** Add resource limits (e.g., `mem_limit: 2g`, `cpus: '2'`).

### 48. No logging configuration in docker-compose
- Container logs can fill disk without rotation limits.
- **Fix:** Add `logging:` driver with `max-size` and `max-file`.

### 49. Dockerfile uses `npm install` instead of `npm ci`
- Non-deterministic builds due to dynamic version resolution.
- **Fix:** Use `npm ci` for reproducible builds.

### 50. `.env.example` has insecure defaults
- `DMRX_CORS_ORIGIN=*` — wildcard CORS.
- `DMRX_MCP_HOST=0.0.0.0` — binds to all interfaces.
- **Fix:** Set secure defaults. Add security warnings.

---

## MEDIUM (Fix Before Production)

| # | Category | Issue | Location |
|---|----------|-------|----------|
| 51 | Security | No RBAC on admin routes — single key has god-mode access | `admin.routes.ts:44-1029` |
| 52 | Security | Admin API key plaintext in env/memory | `auth.middleware.ts:25,57` |
| 53 | Security | API key hashing unsalted SHA-256 | `packages/utils/src/crypto.ts:15-17` |
| 54 | Security | `db.exec()` accepts raw SQL (injection escape hatch) | `packages/db/src/client.ts:112-115` |
| 55 | Security | No CSRF protection | `apps/gateway/src/server.ts` |
| 56 | Security | Missing Zod validation on admin PUT/POST endpoints | `admin.routes.ts:867-976` |
| 57 | Security | MCP server binds 0.0.0.0 by default | `mcp-server/src/index.ts:176,241` |
| 58 | Security | No per-tenant rate limiting on admin routes | `server.ts:211-214` |
| 59 | Security | Full errors logged with request headers (token leakage risk) | `server.ts:292-297` |
| 60 | Security | Conversation state stored in unbounded in-memory map (DoS) | `agentic.routes.ts:83-97` |
| 61 | Security | DELETE endpoints lack cascade awareness | `admin.routes.ts:869-912` |
| 62 | Security | `.env` has placeholder admin key | `.env:18` |
| 63 | Performance | Single-writer DB — no read/write separation | `packages/db/src/client.ts:7,62-129` |
| 64 | Performance | Redundant SELECT after INSERT (read-your-writes anti-pattern) | `usage-tracker.ts:83-100` |
| 65 | Performance | No database indexes on hot query paths | `packages/db/src/client.ts:147-163` |
| 66 | Performance | No per-route rate limiting (expensive routes share global 100/min) | `server.ts:211-214` |
| 67 | Performance | Unindexed aggregation queries in billing summary | `admin.routes.ts:524-591` |
| 68 | Performance | No stream cleanup on client disconnect | `chat.routes.ts:104-144` |
| 69 | Performance | JSON.stringify on every token in streaming | `chat.routes.ts:114-118` |
| 70 | Performance | Provider config cache has no invalidation on update | `registry.service.ts:99-115` |
| 71 | Performance | Pricing cache race condition on refresh | `billing.service.ts:260-285` |
| 72 | Performance | UsageTracker cache has 90-day TTL with no size management | `usage-tracker.ts:54` |
| 73 | Performance | N+1 inserts in provider activation | `admin.routes.ts:99-126` |
| 74 | Reliability | Empty catch blocks silently swallowing errors (20 locations) | Various |
| 75 | Reliability | Error hierarchy inconsistency — duplicate error classes | `retries.ts`, `retry.ts` |
| 76 | Reliability | Missing sticky session break on failure (non-rate-limited path) | `router.service.ts:159-167` |
| 77 | Reliability | Circuit breaker state not persisted across restarts | `circuit-breaker.ts` |
| 78 | Reliability | Non-proportional jitter in retries.ts backoff strategy | `retries.ts:188` |
| 79 | Reliability | First retry has no backoff (x=0 in exponent) | `retries.ts:162,188,194` |
| 80 | Reliability | Pipeline retry only for ProviderUnavailableError | `router.service.ts:237-258` |
| 81 | Reliability | No cleanup of in-memory state on shutdown | `server.ts:312-315` |
| 82 | Reliability | MCP server HTTP has no graceful shutdown | `mcp-server/index.ts` |
| 83 | Reliability | `/health` always returns 200 regardless of state | `server.ts:236` |
| 84 | Reliability | Non-atomic multi-statement DB operations | `admin.routes.ts:76-127` |
| 85 | Reliability | Composite executor silently drops failed sub-task results | `composite-executor.ts:267-320` |
| 86 | Reliability | Free-tier budget not persisted to DB (lost on restart) | `quota.service.ts:84-101` |
| 87 | Reliability | Conversation lock implementation has potential deadlock | `agentic.routes.ts:83-84,214-221` |
| 88 | Code Quality | `PUT /admin/settings` accepts arbitrary JSON with no schema | `admin.routes.ts:956` |
| 89 | Code Quality | Correlated subqueries in quota/alerts endpoints | `admin.routes.ts:639,706` |
| 90 | Code Quality | `X-Routed-Via` and `X-Fallback-Attempts` headers leak routing info | `chat.routes.ts:98-99` |
| 91 | Code Quality | Provider health shows 100% when zero providers exist | `admin.routes.ts:599` |
| 92 | Code Quality | `quota_remaining` hardcoded to 1,000,000 | `admin.routes.ts:597` |
| 93 | Code Quality | Hardcoded dashboard values shown as real data | `admin.routes.ts:647-651` |
| 94 | Code Quality | Missing peerDependencies for TypeScript in packages | Various package.json |
| 95 | Testing | E2E test only checks `/v1/models` — no real routing test | `tests/e2e/connectivity.test.ts` |
| 96 | Testing | No integration tests for database migrations | `packages/db/src/migrations/` |
| 97 | Testing | No tests for rate limiting behavior | Various |
| 98 | Testing | No tests for security headers configuration | `server.ts` |
| 99 | Deployment | docker-compose.yml version '3.8' is deprecated | `docker-compose.yml:1` |
| 100 | Deployment | No `stop_grace_period` configured | `docker-compose.yml` |
| 101 | Deployment | No `read_only: true` or `security_opt` | `docker-compose.yml` |
| 102 | Deployment | No secrets management — env vars in plain text | `docker-compose.yml` |
| 103 | Deployment | No OpenAPI/Swagger specification for REST API | N/A |
| 104 | Deployment | No build status badges in README | `README.md` |

---

## API Contract Mismatches (Frontend vs Backend)

| # | Issue | Impact |
|---|-------|--------|
| 105 | BillingSummary `tenant_id` (snake_case) vs `tenantId` (camelCase) | Data silently `undefined` |
| 106 | Quota `alerts` and `rerouting_suggestions` returned as JSON strings, not arrays | Frontend gets `'[]'` instead of `[]` |
| 107 | Route decisions `fallback_chain` is a string, not array | Same issue |
| 108 | Benchmark columns snake_case vs frontend camelCase | Data silently `undefined` |
| 109 | Dashboard `worker_utilization: 0`, `system_status: 'operational'` hardcoded | Fake data shown as real |

---

## LOW

| # | Category | Issue | Location |
|---|----------|-------|----------|
| 110 | Security | Admin key compared as plaintext (no hashing) — timingSafeEqual is used but key not hashed | `auth.middleware.ts:25,56-58` |
| 111 | Security | API key returned in response body upon creation (accepted pattern) | `admin.routes.ts:451-455` |
| 112 | Security | MCP health endpoint leaks session count | `mcp-server/src/index.ts:218-221` |
| 113 | Security | PUT/DELETE allowed in CORS (unnecessarily permissive) | `server.ts:206` |
| 114 | Security | Unguarded `JSON.parse` on DB values | `admin.routes.ts:148,163,1002` |
| 115 | Performance | ThompsonSampler arms never evicted | `thompson-sampler.ts:22,112-122` |
| 116 | Performance | ReusableReadableStream buffer grows without bound | `reusable-stream.ts:24` |
| 117 | Reliability | Useless catch-rethrow in 3 route handlers | `chat.routes.ts`, `tools.routes.ts` |
| 118 | Reliability | Missing error codes in thrown errors from route handlers | `router.service.ts:112,146,218,283` |
| 119 | Reliability | Half-open concurrency guard missing in circuit breaker | `circuit-breaker.ts:18-31` |
| 120 | Reliability | Uncleaned setInterval in agentic routes | `agentic.routes.ts:89-97` |
| 121 | Reliability | `/healthz` missing adapter/telemetry checks | `server.ts:238-257` |
| 122 | Reliability | `/ready` identical to `/healthz` | `server.ts:259-268` |
| 123 | Reliability | Health check runs initial checkAll before adapter init | `server.ts:186-187` |
| 124 | Reliability | console.error used instead of logger in db/client.ts, mcp-server | Various |
| 125 | Reliability | Sticky session hash collision risk | `sticky-session.ts:25-34` |
| 126 | Code Quality | Dead exports: `registerProvider`, `listAvailableProviders`, etc. | `auto-register.ts`, `tools.routes.ts` |
| 127 | Code Quality | Pointless catch-rethrow in 6 route handlers | `tools.routes.ts`, `images.routes.ts`, etc. |
| 128 | Code Quality | Missing null check on `res.body!` | `ui/src/lib/api.ts:552` |
| 129 | Code Quality | `dangerouslySetInnerHTML` in chart component | `ui/src/components/ui/chart.tsx:83` |
| 130 | Code Quality | Days-in-month hardcoded to 30 | `admin.routes.ts:525` |
| 131 | Code Quality | Stub "coming soon" endpoints returning empty arrays | `admin.routes.ts:851-865` |
| 132 | Code Quality | Duplicate `CREATE TABLE IF NOT EXISTS settings` | `admin.routes.ts:992-998,1012-1018` |
| 133 | Testing | No tests for sticky session routing | `services/router/src/sticky/` |
| 134 | Testing | No tests for task decomposition | `services/router/src/decomposer/` |
| 135 | Testing | E2E test environment file is empty | `tests/e2e/.env.test` |
| 136 | Testing | No tests for key rotation service | `services/quota/src/key-rotation.service.ts` |
| 137 | Deployment | `packageManager` specifies bun but Dockerfile uses npm | `package.json:26`, `Dockerfile` |
| 138 | Deployment | `engines` field requires bun but no node engine specified | `package.json` |
| 139 | Deployment | TypeScript/Vite version mismatches between root and UI | Various |
| 140 | Deployment | `pino-pretty` in production dependencies | `apps/gateway/package.json:26` |
| 141 | Deployment | Dead `@types/inquirer` dependency | `package.json:24` |
| 142 | Deployment | No architecture diagram in README | `README.md` |

---

## Testing Coverage Summary

### What IS Tested (17 unit test files)
- Routing pipeline (candidate selection, filtering, fallback chains, Thompson sampling)
- Task classifier (LLM/vision/diffusion/embedding classification)
- Anthropic converter (request/response conversion)
- Anthropic stream serializer (SSE streaming)
- Meta-models (free/fast/smart/agentic/coding variants)
- Final selector, cost-latency scorer, capability filter, availability filter
- Memory cache (get/set, TTL, incrBy, hash ops)
- SQLite client (prepared statements, exec, close)
- HTTP errors (error classes, error map)
- Tool orchestrator (resultsToMap, summarizeExecutions)
- Conversation state (ID generation, state updates, tool approval)
- Event stream (SSE parsing, chunked delivery)
- Stop conditions (step count, tool call, max tokens/cost)
- Stream transformers (tool call extraction, text extraction)

### What is NOT Tested (Critical Gaps)
- Auth middleware (zero tests)
- Billing service (zero tests)
- Quota service (zero tests)
- Rate limit service (zero tests)
- Policy service (zero tests)
- Registry service (zero tests)
- Benchmark service (zero tests)
- Telemetry service (zero tests)
- MCP server/client (zero tests)
- All provider adapters (zero tests)
- All HTTP route handlers (zero tests)
- Router service top-level (zero tests)
- Integration tests (minimal — only `/v1/models`)
- Security tests (zero — auth bypass, CORS, SSRF, input validation)

---

## Top 20 Priority Fixes

| Priority | Issue | Category | Effort |
|----------|-------|----------|--------|
| 1 | Add auth to MCP server — require DMRX_MCP_API_KEY | Security | Low |
| 2 | Encrypt API keys at rest — don't store plaintext in SQLite | Security | Medium |
| 3 | Fix prototype pollution in settings endpoint | Security | Low |
| 4 | Default DMRX_LOCAL_MODE=false — never disable auth | Security | Low |
| 5 | Fix CORS to not default to `*` | Security | Low |
| 6 | Don't return raw API keys from GET /admin/providers | Security | Low |
| 7 | Fix public route check — strip query strings | Security | Low |
| 8 | Add security headers (CSP, ensure HSTS) | Security | Medium |
| 9 | Apply SSRF validation at provider storage time | Security | Medium |
| 10 | Fix saveDatabase() — use async write, add flush on shutdown | Performance | Medium |
| 11 | Add LRU eviction to MemoryCache | Performance | Medium |
| 12 | Add per-route and per-tenant rate limiting | Performance | Medium |
| 13 | Integrate circuit breaker with request path | Reliability | Medium |
| 14 | Add request-scoped context propagation (requestId) | Reliability | Medium |
| 15 | Initialize and start telemetry service | Reliability | Low |
| 16 | Add timeout on graceful shutdown | Reliability | Low |
| 17 | Consolidate duplicate retry modules | Code Quality | Low |
| 18 | Write auth middleware tests | Testing | Medium |
| 19 | Add resource limits to docker-compose | Deployment | Low |
| 20 | Add LICENSE file | Deployment | Low |

---

## Production Readiness Checklist

- [ ] MCP server authentication enabled
- [ ] API keys encrypted at rest
- [ ] Local mode disabled by default
- [ ] CORS restricted to specific origins
- [ ] Security headers configured (CSP, HSTS)
- [ ] No prototype pollution vectors
- [ ] SSRF protection on all user-supplied URLs
- [ ] Error messages sanitized for clients
- [ ] Database writes use async I/O
- [ ] MemoryCache has size limits
- [ ] Rate limiting per-route and per-tenant
- [ ] Circuit breaker integrated with request path
- [ ] Request context (requestId) propagated throughout
- [ ] Telemetry service initialized and working
- [ ] Graceful shutdown with timeout
- [ ] Auth middleware tested
- [ ] Billing/quota/policy services tested
- [ ] Route handlers tested
- [ ] Docker image hardened (non-root, minimal, resource limits)
- [ ] LICENSE file added
- [ ] API documentation (OpenAPI/Swagger) available
- [ ] Integration tests for full request lifecycle
