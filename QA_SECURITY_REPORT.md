# DMR-X Full QA & Security Analysis

**Date:** 2026-05-30
**Branch:** refactor/production-ready

## Executive Summary

| Area | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| **Security** | 2 | 5 | 9 | 4 |
| **QA/Bugs** | 0 | 12 | 8 | 5 |
| **API/Data Flow** | 1 | 4 | 7 | 4 |
| **TOTAL** | **3** | **21** | **24** | **13** |

---

## CRITICAL (Fix Immediately)

### 1. Local mode disables ALL authentication by default
**`apps/gateway/src/middleware/auth.middleware.ts:9,32-41`** + **`docker-compose.yml:14`**
- `DMRX_LOCAL_MODE=true` in both `.env.example` and `docker-compose.yml` — any unauthenticated user on the network gets full access to chat, images, embeddings, audio, tools, and agentic routes.
- **Fix:** Default to `false`. Require explicit opt-in.

### 2. Plaintext API keys stored in SQLite
**`apps/gateway/src/routes/admin.routes.ts:87-95,183-189`**
- Provider keys stored as `JSON.stringify({ apiKey })` in `providers.config`. Anyone with read access to `~/.dmr-x/data.db` gets every key.
- **Fix:** Encrypt at rest or use OS keychain.

### 3. MCP server has zero authentication
**`services/mcp-server/src/index.ts:145-272`**
- SSE/HTTP transports on `0.0.0.0:3100` with no API key check, no bearer token, no session auth. Anyone who reaches port 3100 can invoke all routing tools and consume provider credits.
- **Fix:** Add bearer token check on all transports.

---

## HIGH (Fix Before Launch)

### 4. Admin API key timing attack
**`apps/gateway/src/middleware/auth.middleware.ts:49`** — Uses `apiKey !== adminApiKey` (simple string comparison). Use `crypto.timingSafeEqual()`.

### 5. API keys returned to UI in plaintext
**`apps/gateway/src/routes/admin.routes.ts:161`** — `GET /admin/providers` returns raw `apiKey` for every provider. Return `hasKey: true/false` instead.

### 6. CORS allows all origins by default
**`apps/gateway/src/server.ts:195-199`** — `origin: '*'` lets any malicious webpage use the gateway as a proxy to call LLM APIs.

### 7. Internal error messages forwarded to clients
**`apps/gateway/src/server.ts:291`** — 500 errors send `error.message` which may contain SQL fragments, file paths, or internal details. Also `AllProvidersFailedError` and `ProviderUnavailableError` leak provider names in `details.providersTried`.

### 8. Auth middleware public route check breaks with query strings
**`apps/gateway/src/middleware/auth.middleware.ts:27`** — `PUBLIC_ROUTES.has(request.url)` — `/v1/models?limit=10` won't match `/v1/models`, breaking public model listing.

### 9. `all_steps` always empty in non-streaming agentic response
**`apps/gateway/src/routes/agentic.routes.ts:516`** — The `allSteps` accumulator is only populated in the streaming code path. Non-streaming responses always return `all_steps: []`.

### 10. In-memory conversation store has no locking
**`apps/gateway/src/routes/agentic.routes.ts:83-85`** — Two concurrent requests with the same `conversationId` race on read/write. Data corruption risk in the approval flow.

### 11. `saveDatabase()` called on every single write
**`packages/db/src/client.ts:62`** — Every `.run()` triggers a full binary export + filesystem write. Under load = catastrophic I/O. Needs batching/debouncing.

### 12. Swallowed adapter init errors
**`apps/gateway/src/routes/admin.routes.ts:208-210`** — Empty catch block silently swallows ALL adapter initialization errors. Bad API key, network error, config bug — all invisible.

### 13. SSRF via provider test endpoint
**`apps/gateway/src/routes/admin.routes.ts:217-301`** — `POST /admin/providers/test` fetches a user-supplied `base_url`. Can probe `http://169.254.169.254` (cloud metadata) or internal services. Needs URL allowlist/blocklist.

### 14. Unbounded arrays in request schemas
**`chat.routes.ts`, `embeddings.routes.ts`, `audio.routes.ts`** — `messages`, `input`, and audio file accept unbounded arrays/content. No max length constraints beyond Fastify's 1MiB default.

### 15. Dockerfile runs as root
**`Dockerfile:61`** — No `USER` directive. Compromised container = root access.

### 16. Dockerfile references deleted `package-lock.json`
**`Dockerfile:27`** — `COPY package-lock.json ./` but the file was deleted from the repo. Build will fail.

---

## MEDIUM (Fix Before Production)

| # | Issue | Location |
|---|-------|----------|
| 17 | `db.exec()` accepts raw SQL (injection escape hatch) | `packages/db/src/client.ts:71-73` |
| 18 | No security headers (no helmet, no CSP, no HSTS) | `apps/gateway/src/server.ts` |
| 19 | No CSRF protection | `apps/gateway/src/server.ts` |
| 20 | Missing Zod validation on admin PUT/POST endpoints | `admin.routes.ts:867-976` |
| 21 | No per-route rate limiting (expensive routes share global 100/min) | `apps/gateway/src/server.ts:202-205` |
| 22 | In-memory telemetry buffer grows unbounded | `admin.routes.ts:742-752` |
| 23 | Conversation cleanup interval never cleared (leak on HMR) | `agentic.routes.ts:88-96` |
| 24 | MCP server sessions have no TTL or max limit | `mcp-server/src/index.ts:153,216` |
| 25 | `pricingCache` never invalidated | `billing.service.ts:63` |
| 26 | 60+ `as any` casts bypass type safety | Route files, server.ts, services |
| 27 | `(request as any).tenant` cast in every route | All route handlers |
| 28 | Correlated subqueries in quota/alerts endpoints | `admin.routes.ts:639,706` |
| 29 | N+1 inserts in provider activation | `admin.routes.ts:99-126` |
| 30 | `X-Routed-Via` and `X-Fallback-Attempts` headers leak routing info | `chat.routes.ts:98-99` |
| 31 | `PUT /admin/settings` accepts arbitrary JSON with no schema | `admin.routes.ts:956` |
| 32 | Provider health shows 100% when zero providers exist | `admin.routes.ts:599` |
| 33 | `quota_remaining` hardcoded to 1,000,000 | `admin.routes.ts:597` |

---

## API Contract Mismatches (Frontend vs Backend)

| # | Issue | Impact |
|---|-------|--------|
| 34 | BillingSummary `tenant_id` (snake_case) vs `tenantId` (camelCase) | Data silently `undefined` |
| 35 | Quota `alerts` and `rerouting_suggestions` returned as JSON strings, not arrays | Frontend gets `'[]'` instead of `[]` |
| 36 | Route decisions `fallback_chain` is a string, not array | Same issue |
| 37 | Benchmark columns snake_case vs frontend camelCase | Data silently `undefined` |
| 38 | Dashboard `worker_utilization: 0`, `system_status: 'operational'` hardcoded | Fake data shown as real |
| 39 | UI sends no auth headers (`api.ts:12-27`) | Only works because local mode disables auth |

---

## LOW

| # | Issue | Location |
|---|-------|----------|
| 40 | Dead exports: `registerProvider`, `listAvailableProviders`, `discoverHuggingFaceModels`, `getToolHandler` | `auto-register.ts`, `tools.routes.ts` |
| 41 | Pointless catch-rethrow in 6 route handlers | `tools.routes.ts`, `images.routes.ts`, etc. |
| 42 | Missing null check on `res.body!` | `ui/src/lib/api.ts:552` |
| 43 | `dangerouslySetInnerHTML` in chart component | `ui/src/components/ui/chart.tsx:83` |
| 44 | SHA-256 for API key hashing (no salt, acceptable for keys) | `packages/utils/src/crypto.ts:15-17` |
| 45 | Global rate limit not per-tenant | `server.ts:202-205` |
| 46 | `pricingCache` in billing never invalidated | `billing.service.ts:63` |
| 47 | Days-in-month hardcoded to 30 | `admin.routes.ts:525` |

---

## Top 10 Priority Fixes

1. **Default `DMRX_LOCAL_MODE=false`** — don't ship with auth disabled
2. **Add auth to MCP server** — bearer token on SSE/HTTP transports
3. **Use `crypto.timingSafeEqual()`** for admin key comparison
4. **Encrypt API keys at rest** — don't store plaintext in SQLite
5. **Don't return raw API keys** from `GET /admin/providers`
6. **Fix public route check** — strip query strings before Set lookup
7. **Fix `saveDatabase()` batching** — don't fsync on every write
8. **Restrict CORS** to specific origins in production
9. **Add URL validation** to provider test endpoint (SSRF)
10. **Populate `allSteps`** in non-streaming agentic path
