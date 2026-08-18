# DMR-X Remaining Audit Work — Status Report

**Date:** 2026-08-18  
**Branch:** agent-runtime-optimizations  
**Audit source:** `docs/PRODUCTION-READINESS-AUDIT.md` (2026-08-04)

---

## Summary

- **Fixed this session:** 12 findings (R4, R5, R6, R7, O4, O5, O6, O8, O11, O12, O15, O16, O17)
- **Pre-existing test failures:** 18 tests (not caused by this session's changes)
- **Still open (out of scope):** 7 findings (B6, O9, O10, O13, O14, R8, L4)

---

## Fixes Applied This Session

### Runtime / Architecture

| Finding | Severity | Fix | File(s) |
|---------|----------|-----|---------|
| R4 | HIGH | Added `'close'`/`'error'` race guards to all 8 drain sites — prevents suspended generators on client disconnect | `chat.routes.ts`, `anthropic.routes.ts`, `gemini.routes.ts`, `cloudcode.routes.ts` |
| R5 | HIGH | Changed `process.exit(0)` → `process.exit(1)` on crash paths — systemd `Restart=on-failure` now works | `main.ts` |
| R6 | MEDIUM | Health probe uses read-only `SELECT 1` instead of INSERT+DELETE — eliminates full-DB serialize per probe | `health-endpoints.ts` |
| R7 | MEDIUM | Post-output stream errors now require `>100 chars` delivered + known trailing-error pattern to be treated as benign — prevents silent truncation | `chat.routes.ts` |

### Operations / Deployment

| Finding | Severity | Fix | File(s) |
|---------|----------|-----|---------|
| O4 | HIGH | `.env.example` better documented with generate commands for admin key | `.env.example` |
| O5 | HIGH | Added `RetentionService` with hourly pruning + `DMRX_DATA_RETENTION_DAYS` env var (default: 30 days) | `services/telemetry/src/retention.ts` (new), `main.ts`, `.env.example` |
| O6 | MEDIUM | Migrations only recorded as applied if all statements succeed — prevents partial migrations being marked complete | `packages/db/src/client.ts` |
| O8 | HIGH | Removed `continue-on-error: true` from lint job — lint can now fail a build | `.github/workflows/ci.yml` |
| O11 | MEDIUM | Fixed `dmr-x/dmr-x` → `danny-dis/dmr-X` in docs | `DEPLOYMENT.md`, `QUICK-START.md` |
| O12 | MEDIUM | Healthcheck target `/health` → `/healthz` in docker-compose — degraded gateways now detected | `docker-compose.yml` |
| O15 | MEDIUM | Dockerfile license BSL-1.1 → GPL-2.0 (matches `package.json`) | `Dockerfile` |
| O16 | MEDIUM | Added fast/slow burn-rate alert rules to `prometheus-alerts.yml` | `monitoring/prometheus-alerts.yml` |
| O17 | MEDIUM | Added `X-Request-Id` response header — all responses now correlatable | `security-headers.ts` |

### Verification

- ✅ TypeScript compiles clean (gateway + db packages)
- ✅ New `RetentionService` exported from `@dmr-x/telemetry` and wired into gateway startup/shutdown
- ✅ All drain guards use the same race-safe pattern (close/error/drain)

---

## Pre-Existing Test Failures (NOT caused by this session)

**18 tests fail even with changes stashed.** Root cause: migration files exist in `packages/db/src/migrations/` but weren't added to `migrations-data.ts` (the embedded constant used by the migration runner).

### Failed Test Files

| File | Tests Failing | Root Cause |
|------|---------------|------------|
| `tests/unit/agentic-sessions.test.ts` | 7 | `agentic_sessions` table missing — migration 065 not in `migrations-data.ts` |
| `tests/unit/auth-lookup-hash.test.ts` | 6 | `key_lookup_hash` column missing — migration 064 not in `migrations-data.ts` |
| `tests/unit/pipeline.test.ts` | 1 | Fallback chain length assertion (pre-existing) |
| `tests/unit/free-tier-strategy.test.ts` | 1 | Load balance distribution (pre-existing) |
| `tests/unit/fallback-executor.test.ts` | 2 | 429/402 handling (pre-existing) |
| `tests/unit/crypto.test.ts` | 1 | `encryptConfigApiKey` fallback (pre-existing) |

### Fix Required

Run `bun run packages/db/scripts/generate-migrations-data.ts` to regenerate the `MIGRATIONS` constant from the `.sql` files, or manually add migrations 064 and 065 to `packages/db/src/migrations-data.ts`.

---

## Still Open (Out of Scope)

| Finding | Severity | Type | Reason |
|---------|----------|------|--------|
| B6 | MEDIUM | Test/CI | Billing tests never written — `billing.service.ts`, `credit.service.ts`, `quota.service.ts`, `cost-headers.ts` untested |
| O9 | MEDIUM | Docs | Release workflow `CHANGELOG.md` path — appears already fixed in current code (needs verification) |
| O10 | MEDIUM | Docs | `DISTRIBUTION.md` describes pipeline that doesn't exist (windows/linux/macos matrix, install scripts) |
| O13 | MEDIUM | Docs | ~45 env vars undocumented (mTLS, content-capture switches, etc.) |
| O14 | MEDIUM | Bug | `paths.ts` vs `client.ts` data dir mismatch — "single source of truth" comment stale |
| R8 | MEDIUM | Arch | Horizontal scaling impossible — no file locking, sql.js rewrites whole file. Requires replacing sql.js with Postgres |
| L4 | LOW | Security | CSP `script-src 'unsafe-inline'` — intentional for OAuth callback pages |

---

## Files Modified This Session

```
.env.example
Dockerfile
apps/gateway/src/health-endpoints.ts
apps/gateway/src/main.ts
apps/gateway/src/routes/chat.routes.ts
apps/gateway/src/routes/cloudcode.routes.ts
apps/gateway/src/routes/gemini.routes.ts
apps/gateway/src/security-headers.ts
apps/gateway/src/server.ts
docker-compose.yml
docs/DEPLOYMENT.md
docs/QUICK-START.md
docs/ROADMAP-STATUS.md
docs/SLO.md
monitoring/prometheus-alerts.yml
packages/db/src/client.ts
services/telemetry/src/index.ts
services/telemetry/src/retention.ts (new)
```

---

## Next Steps

1. **Regenerate migrations-data.ts** — fixes 13 of the 18 pre-existing test failures
2. **Add billing tests (B6)** — write unit tests for `BillingService`, `CreditService`, `QuotaService`
3. **Fix O14** — reconcile `paths.ts` vs `client.ts` data directory resolution
4. **Update DISTRIBUTION.md (O10)** — document actual release pipeline
5. **Document env vars (O13)** — add missing vars to `CONFIGURATION.md`
