# DMR-X — Master Roadmap

> Consolidated roadmap for all DMR-X workstreams. For day-to-day task tracking with multi-agent status, see **[TODO.md](TODO.md)**.

## Progress Dashboard

| Category | Total | Done | Planned | TBD | Wontfix | Unfixed |
|----------|-------|------|---------|-----|---------|---------|
| Agent Runtime | 14 | 12 | 2 | 0 | 0 | 0 |
| SDKs | 5 | 2 | 1 | 2 | 0 | 0 |
| Feature Wiring | 18 | 15 | 1 | 0 | 0 | 0 |
| Production Hardening | 14 | 13 | 1 | 0 | 0 | 0 |
| CI/Test/Docs | 17 | 17 | 0 | 0 | 0 | 0 |
| Security | 16 | 15 | 0 | 0 | 1 | 0 |
| Silent Fakes | 7 | 7 | 0 | 0 | 0 | 0 |
| Operations | 8 | 8 | 0 | 0 | 0 | 0 |
| Test Failures | 5 | 0 | 0 | 0 | 0 | 5 |
| **Total** | **104** | **89** | **5** | **2** | **1** | **5** |

> **86% complete.** 5 items planned, 2 TBD, 1 wontfix, 5 pre-existing test failures.

---

## 1. Platform & Agent Runtime (Core)

| # | Item | Priority | Status | Target | Notes |
|---|------|----------|--------|--------|-------|
| 1 | Parallel independent task execution | Critical | ✅ Done | v0.5.12 | Promise.all for independent task sets |
| 2 | Transactional plan materialization | Critical | ✅ Done | v0.5.12 | BEGIN TRANSACTION wrap |
| 3 | Streaming job progress (SSE/WebSocket) | Critical | ✅ Done | v0.5.12 | EventEmitter + gateway SSE |
| 4 | Task-level retry with exponential backoff | Critical | ✅ Done | v0.5.12 | maxRetries + backoff |
| 5 | Real quality evaluation (LLM-judge scoring) | High | ✅ Done | v0.5.12 | Acceptance-criteria Likert scoring |
| 6 | AgentScheduler rewrite | High | ✅ Done | v0.5.12 | croner + maxConcurrency + at-most-once CAS |
| 7 | Memory prefetch cap | High | ✅ Done | v0.5.12 | 2000-char cap + configurable maxMemoryChars |
| 8 | Multi-step tool-calling subagents | High | ✅ Done | v0.5.12 | Bounded ReAct loop, maxSubagentSteps=10 |
| 9 | Deduplicate session stores | Medium | ✅ Done | v0.5.12 | BaseSessionStore<T> polymorphic base |
| 10 | Re-plan / edit-plan capability | Medium | ✅ Done | v0.5.12 | replan endpoint + manual dependsOn patch |
| 11 | Time-based budget (budgetDurationMs) | Medium | ✅ Done | v0.5.12 | Added to Job type |
| 12 | Input validation on job creation | Medium | ✅ Done | v0.5.12 | Length limits + JSON schema |
| 13 | Skill capture automation | Low | 🔲 Planned | v1.0 | Post-session repeated-sequence detection |
| 14 | SQLite WAL mode + busy timeout | Low | 🔲 Planned | v1.0 | Architectural decision: Postgres vs WAL |

---

## 2. SDKs & Developer Experience

| Phase | Item | Status | Target |
|-------|------|--------|--------|
| 1 | Python + Go SDKs (sync/async, streaming, Pydantic v2, typed errors) | ✅ Done | Q1 2025 |
| 2 | MIT Core Types Extraction (`@dmr-x/core-types`, `dmrx-core`, Go module) | 🔲 Planned | v1.0 |
| 3 | Langfuse / MLflow Observability (auto-instrumentation, callbacks, spans) | ✅ Done | Q3 2025 |
| 4 | Guardrails (input moderation, PII detection, output validation) | 📋 TBD | v1.0 |
| 5 | Enterprise (SSO/RBAC propagation, admin SDK methods, audit) | 📋 TBD | v1.0 |

---

## 3. Feature & Wiring Verification

> From `ROADMAP-STATUS.md` — partial or planned integrations.

| Feature | Status | Notes |
|---------|--------|-------|
| Codex (OpenAI CLI) | ✅ Shipped | Points OPENAI_BASE_URL at `/v1/chat/completions` |
| Antigravity (Google Cloud Code / `agy`) | ✅ Shipped | Outbound adapter + inbound `/v1internal*` wildcard |
| Semantic response cache | ✅ Shipped | `services/cache` / `SemanticCacheService` |
| Install CLI (`dmrx setup/off`) | ✅ Shipped | `packages/cli` |
| Handover summarization | ✅ Shipped | `services/router/src/handover/handover-summarizer.ts` |
| STAY vs SWITCH planner | ✅ Shipped | `ev-planner.ts` + `sticky-session-handler.ts` |
| Cluster scorer / multi-binding catalog | ⚠️ Scaffolded, disconnected | `cluster-scorer.ts` has no callers; `DMRX_CLUSTER_ROUTING_ENABLED` loads ONNX but changes no behavior |
| Versioned A/B routing | ✅ Shipped | least-busy, usage-based, latency-based, tag-based |
| MCP Tools (stdio/SSE/HTTP, 40+ tools) | ✅ Shipped | `docs/MCP.md` |
| A2A agent cards | ✅ Shipped | |
| RBAC engine | ✅ Shipped | `DMRX_RBAC_ENABLED` |
| Guardrails (PII redaction, content filtering) | ✅ Shipped | `DMRX_GUARDRAILS_*` |
| Audit logging | ✅ Shipped | `DMRX_AUDIT_*` |
| Federation | ⚠️ Partial | Peer registration live; cross-instance routing not wired (`FederationRouter.routeRequest` has no callers) |
| Hybrid tool search (BM25 + semantic, RRF) | ✅ Shipped | `services/tool-search` |
| Burn-rate SLO alerts | ✅ Shipped | `monitoring/prometheus-alerts.yml` |
| Benchmark SLO alerts | 🔲 Planned | No benchmark failure rate alert (O16) |
| Kubernetes Operator | ✅ Shipped | `services/operator` |
| Workflow engine (CRDs / Workflow API) | ✅ Shipped | `WorkflowSpec` + `generateWorkflowManifest()` |
| MCP server Phase 3 features | ✅ Shipped | A2A, RBAC, guardrails, audit, federation |

---

## 4. Production Hardening & Architecture

| # | Item | Severity | Status | Target |
|---|------|----------|--------|--------|
| R1 | Persistence self-destructs as function of request count (no retention) | Critical | ✅ Done | v0.5.12 |
| R2 | MemoryCache size leak → infinite loop hard-freeze | Critical | ✅ Done | v0.5.12 |
| R3 | Graceful shutdown loses writes | Critical | ✅ Done | v0.5.12 |
| R4 | Unguarded await on 'drain' leaks provider connection | High | ✅ Done | v0.5.12 |
| R5 | One unhandled rejection kills gateway, exits 0 | High | ✅ Done | v0.5.12 |
| R6 | /healthz writes to DB per probe | High | ✅ Done | v0.5.12 |
| R7 | Mid-stream provider errors reported as success | High | ✅ Done | v0.5.12 |
| R8 | Horizontal scaling impossible (no file locking, sql.js rewrites whole file) | Medium | 🔲 Planned | v2.0 |
| R9 | PRAGMA journal_mode=WAL inert on in-memory WASM DB | Medium | ✅ Done | v0.5.12 |
| R10 | Atomic replace not atomic on fallback path, no fsync | Medium | ✅ Done | v0.5.12 |
| R11 | Pre-migration backups never run in production | Medium | ✅ Done | v0.5.12 |
| R12 | No global request deadline (3×N×M worst case) | Medium | ✅ Done | v0.5.12 |
| R13 | Admin SSE writes discard write() return (no backpressure) | Medium | ✅ Done | v0.5.12 |
| R14 | least-busy cleanup deletes in-flight counters after 30s | Medium | ✅ Done | v0.5.12 |

---

## 5. CI / Test / Documentation Gaps

| # | Item | Severity | Status | Target |
|---|------|----------|--------|--------|
| B1 | `bun run test` never terminates (vitest.workspace.ts e2e extends) | High | ✅ Done | v0.5.12 |
| B2 | `mcp-input-validator.test.ts` executes nowhere | High | ✅ Done | v0.5.12 |
| B3 | CI type-checks zero UI files | High | ✅ Done | v0.5.12 |
| B4 | .gitignore blanket `*.d.ts` untracks `vite-env.d.ts` | High | ✅ Done | v0.5.12 |
| B5 | tests/ excluded from every tsconfig, contains drift | High | ✅ Done | v0.5.12 |
| B6 | Billing path untested (billing, credit, quota, cost-headers) | High | ✅ Done | v0.5.12 |
| B7 | api-contracts.test.ts cannot detect backend drift | Medium | ✅ Done | v0.5.12 |
| B8 | vitest.config.ts hardcodes bun-store paths with pinned versions | Medium | ✅ Done | v0.5.12 |
| O9 | Release workflow fails at release step (CHANGELOG.md path) | High | ✅ Done | v0.5.12 |
| O10 | Distribution doc describes pipeline that doesn't exist | Medium | ✅ Done | v0.5.12 |
| O11 | Install URLs point at wrong repo (dmr-x/dmr-x vs danny-dis/dmr-X) | Medium | ✅ Done | v0.5.12 |
| O12 | docker-compose.yml healthcheck hits always-200 /health | Medium | ✅ Done | v0.5.12 |
| O13 | ~45 env vars undocumented | Medium | ✅ Done | v0.5.12 |
| O14 | paths.ts "single source of truth" but client.ts doesn't use it | Medium | ✅ Done | v0.5.12 |
| O15 | Default drift across .env.example, CONFIGURATION.md, code | Medium | ✅ Done | v0.5.12 |
| O16 | SLO.md claims burn-rate rules exist; they don't | Medium | ✅ Done | v0.5.12 |
| O17 | security-headers.ts documents x-request-id response header that no code sets | Medium | ✅ Done | v0.5.12 |

---

## 6. Security Remediations

| # | Item | Severity | Status | Target |
|---|------|----------|--------|--------|
| C1 | Any tenant API key yields arbitrary code execution | Critical | ✅ Done | v0.5.12 |
| C2 | Gateway clones & executes third-party GitHub repo on boot | Critical | ✅ Done | v0.5.12 |
| C3 | Spawned companion runs unauthenticated in relay mode | Critical | ✅ Done | v0.5.12 |
| C4 | Godmode lifecycle endpoints tenant-auth'd, not admin | Critical | ✅ Done | v0.5.12 |
| H1 | Every error logs caller's API key in plaintext | High | ✅ Done | v0.5.12 |
| H2 | Production guards gated on NODE_ENV, not LOCAL_MODE | High | ✅ Done | v0.5.12 |
| H3 | Two high-severity dependency advisories (fast-uri, ip-address) | High | ✅ Done | v0.5.12 |
| M1 | Unauthenticated admin-key oracle via /validate | Medium | ✅ Done | v0.5.12 |
| M2 | Sandbox containment via startsWith, no trailing separator | Medium | ✅ Done | v0.5.12 |
| M3 | api_key_ref free-form string can exfiltrate master key | Medium | ✅ Done | v0.5.12 |
| M4 | Provider keys written to .env in plaintext | Medium | ✅ Done | v0.5.12 |
| M5 | /healthz INSERT/DELETE per probe + raw err.message | Medium | ✅ Done | v0.5.12 |
| L1 | Client-supplied x-request-id used verbatim (log injection) | Low | ✅ Done | v0.5.12 |
| L2 | Admin keys silently truncated to 256 bytes | Low | ✅ Done | v0.5.12 |
| L3 | encryptConfigApiKey silently stores plaintext when key absent | Low | ✅ Done | v0.5.12 |
| L4 | CSP includes script-src 'unsafe-inline' (intentional for OAuth) | Low | ⏳ Wontfix | — |

---

## 7. "Silent Semantic Fakes" — Modules That Compile But Don't Work

| # | Item | Severity | Status | Target |
|---|------|----------|--------|--------|
| F1 | Fake moderation providers (Anthropic/Google return allowed:true) | High | ✅ Done | v0.5.12 |
| F2 | RBAC wildcard-on-parse-failure default | High | ✅ Done | v0.5.12 |
| F3 | Bedrock adapter forges AWS signature — always fails | High | ✅ Done | v0.5.12 |
| F4 | Alert acknowledge/resolve returns success with no storage write | Medium | ✅ Done | v0.5.12 |
| F5 | Hardcoded 20-tool fallbackTools arrays | Medium | ✅ Done | v0.5.12 |
| F6 | Legacy MCP aggregation endpoints return hardcoded status | Medium | ✅ Done | v0.5.12 |
| F7 | Plugin loader never reads manifest | Medium | ✅ Done | v0.5.12 |

---

## 8. Operations & Deployment

| # | Item | Severity | Status | Target |
|---|------|----------|--------|--------|
| O1 | docker-compose.yml persists nothing; every upgrade destroys DB | Critical | ✅ Done | v0.5.12 |
| O2 | Shipped backup script cannot work in shipped production config | Critical | ✅ Done | v0.5.12 |
| O3 | Wrong/rotated encryption key silently wipes database | Critical | ✅ Done | v0.5.12 |
| O4 | Both documented quickstarts fail at boot | High | ✅ Done | v0.5.12 |
| O5 | Unbounded table growth — no retention/TTL | High | ✅ Done | v0.5.12 |
| O6 | Migration error-swallowing marks partial as complete | High | ✅ Done | v0.5.12 |
| O7 | Metrics may silently not exist | High | ✅ Done | v0.5.12 |
| O8 | CI weaker than it looks (continue-on-error, skipped e2e) | High | ✅ Done | v0.5.12 |

---

## 9. Pre-Existing Test Failures (Not Caused by Remediation)

| # | File | Tests Failing | Root Cause | Status |
|---|------|---------------|------------|--------|
| T-001 | `tests/unit/pipeline.test.ts` | 1 | Fallback chain length assertion | 🔲 Unfixed |
| T-002 | `tests/unit/free-tier-strategy.test.ts` | 1 | Load balance distribution | 🔲 Unfixed |
| T-003 | `tests/unit/fallback-executor.test.ts` | 2 | 429/402 handling | 🔲 Unfixed |
| T-004 | `tests/unit/crypto.test.ts` | 1 | encryptConfigApiKey fallback | 🔲 Unfixed |
| T-005 | `tests/unit/godmode-wrap-order.test.ts` | 1 | Emergency list assertion | 🔲 Unfixed |

---

## Progress Summary

| Category | Total | Done | Planned | TBD | Wontfix | Unfixed |
|----------|-------|------|---------|-----|---------|---------|
| Agent Runtime | 14 | 12 | 2 | 0 | 0 | 0 |
| SDKs | 5 | 2 | 1 | 2 | 0 | 0 |
| Feature Wiring | 18 | 15 | 1 | 0 | 0 | 0 |
| Production Hardening | 14 | 13 | 1 | 0 | 0 | 0 |
| CI/Test/Docs | 17 | 17 | 0 | 0 | 0 | 0 |
| Security | 16 | 15 | 0 | 0 | 1 | 0 |
| Silent Fakes | 7 | 7 | 0 | 0 | 0 | 0 |
| Operations | 8 | 8 | 0 | 0 | 0 | 0 |
| Test Failures | 5 | 0 | 0 | 0 | 0 | 5 |
| **Total** | **104** | **89** | **5** | **2** | **1** | **5** |

> **86% complete.** 5 items planned, 2 TBD, 1 wontfix, 5 pre-existing test failures.

---

*Last updated: 2026-08-18. Consolidated from `docs/ROADMAP.md`, `docs/ROADMAP-STATUS.md`, `docs/PRODUCTION-READINESS-AUDIT.md`, `docs/REMAINING-AUDIT-WORK-STATUS.md`, `sdks/ROADMAP.md`.*
