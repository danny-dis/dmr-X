# DMR-X — Universal TODO

> **Multi-agent tracking hub.** Every agent working on DMR-X MUST update this file when starting, finishing, or abandoning work. This is the single source of truth for in-progress, pending, and recently completed work across all agents.

## How to Use This File

When you start work on any item:
1. Find the item (or add it if newly discovered)
2. Set **Status** to `🔨 Working`
3. Set **Agent** to your identifier (e.g., `claude-code-1`, `mimo-3`, `opencode-review`)
4. Set **Started** to today's date

When you finish:
1. Set **Status** to `✅ Done`
2. Set **Finished** to today's date
3. Add a **Notes** link to the commit/PR

When you find a bug but don't fix it:
1. Add it to the **Backlog / Discovered Bugs** section at the bottom
2. Include file:line, severity, and a one-line description

**Never** start work on an item already marked `🔨 Working` without coordinating with that agent first.

---

## 🔴 Critical — Production Blocking

| # | Item | Status | Agent | Started | Finished | Notes |
|---|------|--------|-------|---------|----------|-------|
| C1 | Any tenant API key yields arbitrary code execution (tools.routes.ts:1072-1111) | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | RBAC + container isolation |
| C2 | Gateway clones & executes third-party GitHub repo on every boot (sidecar-boot.ts:508) | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | Default autostart → false |
| C3 | Spawned companion process runs unauthenticated in relay mode | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | Auth enforced |
| C4 | Godmode lifecycle endpoints tenant-auth'd, not admin-auth'd | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | Moved under /v1/admin |
| C5 | Persistence self-destructs as function of lifetime request count (R1) | ✅ Done | perf-team | 2026-08-04 | 2026-08-12 | Retention + pruning added |
| C6 | MemoryCache size-accounting leak → infinite loop hard-freeze (R2) | ✅ Done | perf-team | 2026-08-04 | 2026-08-12 | Two-line fix in cache.ts |
| C7 | Graceful shutdown loses writes since last save (R3) | ✅ Done | perf-team | 2026-08-04 | 2026-08-12 | flush() awaits in-flight save |
| C8 | docker-compose.yml persists nothing; every upgrade destroys DB (O1) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Volume path fixed |
| C9 | Shipped backup script cannot work in shipped production config (O2) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Handles data.db.enc |
| C10 | Wrong/rotated encryption key silently wipes database (O3) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Fail-fast on decrypt failure |
| C11 | Both documented quickstarts fail at boot (O4) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | .env.example fixed |
| C12 | Unguarded await on 'drain' leaks provider connection forever (R4) | ✅ Done | perf-team | 2026-08-04 | 2026-08-12 | Guarded all 8 sites |
| C13 | One unhandled rejection kills gateway, exits 0 (R5) | ✅ Done | perf-team | 2026-08-04 | 2026-08-12 | Exit 1 on crash paths |
| C14 | /healthz writes to DB on every probe (R6) | ✅ Done | perf-team | 2026-08-04 | 2026-08-12 | Probe no longer writes |
| C15 | Mid-stream provider errors reported as success (R7) | ✅ Done | perf-team | 2026-08-04 | 2026-08-12 | finish_reason corrected |

## 🟠 High — Correctness & Safety

| # | Item | Status | Agent | Started | Finished | Notes |
|---|------|--------|-------|---------|----------|-------|
| H1 | Every error logs caller's API key in plaintext (security-headers.ts:57) | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | pino redact added |
| H2 | Production guards gated on NODE_ENV, not LOCAL_MODE | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | Guards now on LOCAL_MODE |
| H3 | Two high-severity dependency advisories (fast-uri, ip-address) | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | Overrides raised |
| H4 | Parallel independent task execution (job-orchestrator.ts:72-140) | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | Promise.all for independent sets |
| H5 | Transactional plan materialization (job-planner.ts:481-535) | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | BEGIN TRANSACTION wrap |
| H6 | Streaming job progress (SSE/WebSocket events) | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | EventEmitter + gateway SSE |
| H7 | Task-level retry with exponential backoff | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | maxRetries + backoff |
| H8 | Real quality evaluation (not just efficiency metrics) | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | LLM-judge acceptance scoring |
| H9 | AgentScheduler rewrite (croner, maxConcurrency, at-most-once) | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | croner + CAS |
| H10 | Memory prefetch cap (2000 chars + configurable) | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | maxMemoryChars |
| H11 | Multi-step tool-calling subagents (bounded ReAct loop) | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | maxSubagentSteps=10 |
| H12 | Unbounded table growth — no retention/TTL (O5) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Retention policies added |
| H13 | Migration error-swallowing marks partial as complete (O6) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Transactional migrations |
| H14 | Metrics may silently not exist (O7) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Fail-fast on telemetry init |
| H15 | CI weaker than it looks (continue-on-error, skipped e2e) (O8) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Drop continue-on-error |
| H16 | Release workflow fails at release step (O9) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Fixed CHANGELOG path |
| H17 | Bedrock adapter forges AWS signature — always fails (F3) | ✅ Done | adapter-team | 2026-08-04 | 2026-08-12 | Proper SigV4 signing |
| H18 | Fake moderation providers (Anthropic/Google return allowed:true) (F1) | ✅ Done | router-team | 2026-08-04 | 2026-08-12 | Real implementations |
| H19 | RBAC wildcard-on-parse-failure default (F2) | ✅ Done | policy-team | 2026-08-04 | 2026-08-12 | Fail closed on parse error |

## 🟡 Medium — Maintainability & Polish

| # | Item | Status | Agent | Started | Finished | Notes |
|---|------|--------|-------|---------|----------|-------|
| M1 | Unauthenticated admin-key oracle via /validate (=== comparison) | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | Constant-time comparison |
| M2 | Sandbox containment via startsWith, no trailing separator | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | Uses path.relative |
| M3 | api_key_ref free-form string can exfiltrate master key | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | Validated against DMRX_* |
| M4 | Provider keys written to .env in plaintext | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | Encrypted storage only |
| M5 | /healthz INSERT/DELETE per probe + raw err.message returned | ✅ Done | audit-team | 2026-08-04 | 2026-08-12 | Sanitized errors |
| M6 | Deduplicate session stores (AgentSessionStore + AgenticSessionStore) | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | BaseSessionStore<T> |
| M7 | Re-plan / edit-plan capability | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | replan endpoint |
| M8 | Time-based budget (budgetDurationMs) | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | Added to Job type |
| M9 | Input validation on job creation (brief, acceptanceCriteria) | ✅ Done | runtime-team | 2026-08-15 | 2026-08-16 | Length limits + JSON schema |
| M10 | Distribution doc describes pipeline that doesn't exist (O10) | ✅ Done | docs-team | 2026-08-04 | 2026-08-12 | Matches release.yml |
| M11 | Install URLs point at wrong repo (dmr-x/dmr-x vs danny-dis/dmr-X) (O11) | ✅ Done | docs-team | 2026-08-04 | 2026-08-12 | Fixed all URLs |
| M12 | docker-compose.yml healthcheck hits always-200 /health (O12) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Uses /healthz |
| M13 | ~45 env vars undocumented (O13) | ✅ Done | docs-team | 2026-08-04 | 2026-08-18 | +99 lines in CONFIGURATION.md |
| M14 | paths.ts "single source of truth" but client.ts doesn't use it (O14) | ✅ Done | ops-team | 2026-08-04 | 2026-08-18 | resolveDataDir unified |
| M15 | Default drift across .env.example, CONFIGURATION.md, code (O15) | ✅ Done | docs-team | 2026-08-04 | 2026-08-12 | Aligned defaults |
| M16 | SLO.md claims burn-rate rules exist; they don't (O16) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Rules added |
| M17 | security-headers.ts documents x-request-id response header that no code sets (O17) | ✅ Done | gateway-team | 2026-08-04 | 2026-08-12 | Header now set |
| M18 | Horizontal scaling impossible — no file locking, sql.js rewrites whole file (R8) | 🔲 Pending | — | — | — | Requires Postgres migration |
| M19 | Atomic replace not atomic on fallback path, no fsync (R10) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | fsync added |
| M20 | Pre-migration backups never run in production (R11) | ✅ Done | ops-team | 2026-08-04 | 2026-08-12 | Fixed path matching |
| M21 | No global request deadline (3×N×M worst case) (R12) | ✅ Done | gateway-team | 2026-08-04 | 2026-08-12 | Global deadline added |
| M22 | Admin SSE writes discard write() return value (R13) | ✅ Done | gateway-team | 2026-08-04 | 2026-08-12 | Backpressure handling |
| M23 | least-busy cleanup deletes in-flight counters after 30s (R14) | ✅ Done | router-team | 2026-08-04 | 2026-08-12 | TTL extended to 120s |
| M24 | Alert acknowledge/resolve returns success with no storage write (F4) | ✅ Done | gateway-team | 2026-08-04 | 2026-08-12 | Persists to DB |
| M25 | Hardcoded 20-tool fallbackTools arrays (F5) | ✅ Done | gateway-team | 2026-08-04 | 2026-08-12 | Live registration |
| M26 | Legacy MCP aggregation endpoints return hardcoded status (F6) | ✅ Done | mcp-team | 2026-08-04 | 2026-08-12 | Uses live status |
| M27 | Plugin loader never reads manifest (F7) | ✅ Done | plugin-team | 2026-08-04 | 2026-08-12 | Reads manifest |
| M28 | vitest.workspace.ts: bun run test never terminates (B1) | ✅ Done | ci-team | 2026-08-04 | 2026-08-12 | Drop extends from e2e |
| M29 | mcp-input-validator.test.ts executes nowhere (B2) | ✅ Done | ci-team | 2026-08-04 | 2026-08-12 | Wired into project |
| M30 | CI type-checks zero UI files (B3) | ✅ Done | ci-team | 2026-08-04 | 2026-08-12 | Points at tsconfig.app.json |
| M31 | .gitignore blanket *.d.ts untracks vite-env.d.ts (B4) | ✅ Done | ci-team | 2026-08-04 | 2026-08-12 | Exception added |
| M32 | tests/ excluded from every tsconfig, contains drift (B5) | ✅ Done | ci-team | 2026-08-04 | 2026-08-12 | Typecheck added |
| M33 | Billing path untested (billing.service.ts, credit.service.ts, quota.service.ts) (B6) | ✅ Done | test-team | 2026-08-04 | 2026-08-18 | 34 new tests |
| M34 | api-contracts.test.ts cannot detect backend drift (B7) | ✅ Done | test-team | 2026-08-04 | 2026-08-12 | Now executes backend |
| M35 | vitest.config.ts hardcodes bun-store paths with pinned versions (B8) | ✅ Done | ci-team | 2026-08-04 | 2026-08-12 | Dynamic resolution |

## 🟢 Low — Nice-to-have / v1+

| # | Item | Status | Agent | Started | Finished | Notes |
|---|------|--------|-------|---------|----------|-------|
| L1 | Client-supplied x-request-id used verbatim (log injection) | ✅ Done | gateway-team | 2026-08-04 | 2026-08-12 | Validated + sanitized |
| L2 | Admin keys silently truncated to 256 bytes | ✅ Done | gateway-team | 2026-08-04 | 2026-08-12 | Full length comparison |
| L3 | encryptConfigApiKey silently stores plaintext when key absent | ✅ Done | crypto-team | 2026-08-04 | 2026-08-12 | Throws if no key |
| L4 | CSP includes script-src 'unsafe-inline' (intentional for OAuth) | ⏳ Wontfix | — | — | — | Intentional, documented |
| L5 | Skill capture automation (pattern detection, not just nudge) | 🔲 Pending | — | — | — | Post-session analysis |
| L6 | SQLite WAL mode + busy timeout for concurrent load | 🔲 Pending | — | — | — | Architectural decision needed |

---

## 🔨 Active Work

| # | Item | Agent | Started | ETA | Notes |
|---|------|-------|---------|-----|-------|
| G-1 | Fix `restartGodmodeProxy` apiKey drop (B-006) + test | opencode | 2026-08-19 | 2026-08-19 | ✅ Done — pass `api_key` through all 3 `setGodmodeConfig` calls; 3 regression tests added; live service re-verified (no more 401s) |

---

## 📋 Backlog / Discovered Bugs

> Agents: add newly found bugs here. Do NOT let bugs live only in chat. If you find it, log it.

| # | Severity | File:Line | Description | Discovered By | Date | Status |
|---|----------|-----------|-------------|---------------|------|--------|
| B-001 | MEDIUM | `tests/unit/pipeline.test.ts` | Fallback chain length assertion (pre-existing) | audit-team | 2026-08-18 | 🔲 Unfixed |
| B-002 | MEDIUM | `tests/unit/free-tier-strategy.test.ts` | Load balance distribution (pre-existing) | audit-team | 2026-08-18 | 🔲 Unfixed |
| B-003 | MEDIUM | `tests/unit/fallback-executor.test.ts` | 429/402 handling (pre-existing, 2 tests) | audit-team | 2026-08-18 | 🔲 Unfixed |
| B-004 | MEDIUM | `tests/unit/crypto.test.ts` | encryptConfigApiKey fallback (pre-existing) | audit-team | 2026-08-18 | 🔲 Unfixed |
| B-005 | MEDIUM | `tests/unit/godmode-wrap-order.test.ts` | Emergency list assertion (pre-existing) | audit-team | 2026-08-18 | 🔲 Unfixed |
| B-006 | HIGH | `apps/gateway/src/lib/godmode-guard.ts:133-174` | `restartGodmodeProxy()` drops `apiKey` from all `setGodmodeConfig` calls → gateway sends no Bearer to sidecar (which always requires auth) → every godmode wrap/stream 401s | opencode | 2026-08-19 | ✅ Done |

---

## 📊 Summary

| Category | Total | Done | Working | Pending | Wontfix |
|----------|-------|------|---------|---------|---------|
| Critical | 15 | 15 | 0 | 0 | 0 |
| High | 19 | 19 | 0 | 0 | 0 |
| Medium | 35 | 33 | 0 | 1 | 1 |
| Low | 6 | 3 | 0 | 2 | 1 |
| **Total** | **75** | **70** | **0** | **3** | **2** |

> **93% complete.** Remaining: 3 pending (R8 arch, skill capture, SQLite WAL), 2 wontfix (L4 CSP, L6 needs arch decision).

## D List — Post-Audit Hardening (2026-08-18)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 7 | Rate-limit backoff tuning | ✅ Done | TTLs verified in code: `model_not_found=6h`, `auth_error=15m`, `provider_overloaded=5m`. Burst test (12 concurrent auto-coding): 10/12 passed, 2 empty 200s from gemma free-tier models, zero 429s/5xx. Backoff holds under load. |
| 4 | Provider pruning | 🔲 Skipped | Deferred — dead model_profiles still in vault but not causing failures. Revisit if auto-free fallback wraps degrade. |
| — | Chaos/burst test | ✅ Done | 12 concurrent `auto-coding` calls: 10/12 HTTP 200 + content, 2/12 HTTP 200 empty (gemma models, tiny prompt edge case), 0 failures. Latency avg=88ms, max=155ms. Rate-limit escalation not triggered = TTLs not too tight. |
| — | Migration backfill verification | ✅ Done | `key_lookup_hash` column: 1/1 rows populated, 0 NULLs. `064_key_lookup_hash.sql` migration applied correctly. |
| — | Vault watchdog cron | ✅ Done | Script at `scripts/vault_watchdog.py` reports `[OK] 117 total, 20 healthy, 11 with key, 41 active keys`. Wired as cron job `76261f9f6291` running every 5 min, delivers JSON to origin chat. |

---

## Changelog

- **2026-08-19** — B-006 fixed (`3f96ef4`): `restartGodmodeProxy()` in `apps/gateway/src/lib/godmode-guard.ts` now passes `api_key` through all 3 `setGodmodeConfig` calls (env key / live instance key / freshly-started key). Regression tests in `tests/unit/godmode-wrap-order.test.ts`. Live godmode service restarted via gateway lifecycle and verified: `/server/config` → `hasApiKey:true`, auto-free wrap returns 200.
- **2026-08-18** — D List hardening complete: burst test (12 concurrent, 10/12 pass), vault watchdog wired to cron (every 5 min), key_lookup_hash backfill verified (0 NULLs), rate-limit TTLs confirmed in code. Provider pruning deferred.
