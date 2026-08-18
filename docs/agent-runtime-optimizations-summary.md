# Agent Runtime Optimizations — Summary

Branch: `agent-runtime-optimizations`
Generated: August 2026

---

## What Was Fixed

### 1. Parallel Task Execution
**Problem:** Jobs ran tasks one-by-one even when independent.  
**Fix:** `Promise.all` instead of sequential loop in `runJobPass`.

### 2. Transactional Plan Materialization
**Problem:** Crash mid-plan left a broken half-written plan with dangling refs.  
**Fix:** SQLite transaction wraps the whole plan write — commits fully or not at all.

### 3. Task-Level Retry with Backoff
**Problem:** One transient error (503, timeout, rate limit) killed the whole job forever.  
**Fix:** Tasks retry up to 3 times with exponential backoff (2s, 4s, 8s... capped at 30s). Scheduler respects backoff window via `retry_after` column.

### 4. Streaming Job Progress (SSE)
**Problem:** No visibility into what a job was doing — just a loading spinner.  
**Fix:** New SSE endpoint `GET /v1/jobs/:id/events`. Events: `task:started`, `task:completed`, `task:failed`, `job:completed`, `job:blocked`, `job:failed`.

### 5. Scheduler Concurrency Cap + At-Most-Once
**Problem:** If 1000 cron jobs landed in the same window, 1000 HTTP requests fired. Same job could run twice.  
**Fix:** `maxConcurrency` cap (default 10), atomic compare-and-swap on `running` flag.

### 6. Proper Cron Parsing + Timezone Support
**Problem:** Scheduler only understood `*/N * * * *` and `N * * * *`. No timezone support.  
**Fix:** Full 5-field cron: ranges (`1-5`), steps (`*/15`), lists (`1,3,7`), day-of-week. Timezone-aware via `triggerConfig.timezone`.

### 7. Memory Prefetch Cap
**Problem:** Large memory entries could silently balloon the system prompt toward context limit.  
**Fix:** Capped at 2000 chars with `[truncated N chars]` note.

### 8. Time-Based Budget
**Problem:** No guard against slow models burning tokens forever.  
**Fix:** New `budgetDurationMs` field on jobs. `budgetExhausted` checks elapsed time.

### 9. Configurable History Compaction
**Problem:** Compaction threshold was hardcoded at 24 messages — wrong for all models.  
**Fix:** Per-agent `compactionThreshold` and `compactionKeepRecent` settings.

### 10. Tool Catalog Cache Invalidation
**Problem:** New tools didn't show up for up to 60 seconds after registration.  
**Fix:** `invalidateToolCatalog()` called on `registerToolHandler`.

### 11. Input Validation on Job Creation
**Problem:** `brief` field had no length limit — potential DoS vector.  
**Fix:** Capped at 10,000 chars. Added `budgetDurationMs` to schema.

### 12. Direct Subagent Lookup
**Problem:** Looking up a subagent loaded ALL definitions into memory.  
**Fix:** New `getDefinitionByName` — single tenant-scoped SQL lookup.

---

## Migrations Created

| Migration | File | Purpose |
|-----------|------|---------|
| 072 | `072_job_task_retry.sql` | `max_retries`, `retry_after` columns on `job_tasks` |
| 073 | `073_scheduler_running.sql` | `running` flag on `agent_scheduled_jobs` for CAS |
| 074 | `074_job_time_budget.sql` | `budget_duration_ms` column on `jobs` |

---

## What Was Skipped (and Why)

| Item | Reason |
|------|--------|
| Multi-step tool-calling subagents | Architectural change — needs threading tool handlers from gateway into services layer. Violates `services/*` boundary. |
| Real quality evaluation | Needs separate LLM call to score output against acceptance criteria. |
| Deduplicate session stores | Refactor only — no behavior change. |
| Re-plan / edit-plan | Bigger feature — needs new endpoint + board state re-prompt. |
| SQLite WAL + busy timeout | Already existed in `client.ts:1106-1110`. |

---

## Files Modified

**Core Runtime:**
- `services/agent-runtime/src/job-orchestrator.ts`
- `services/agent-runtime/src/job-planner.ts`
- `services/agent-runtime/src/job.store.ts`
- `services/agent-runtime/src/job-scheduler.ts`
- `services/agent-runtime/src/agent-runtime.ts`
- `services/agent-runtime/src/agent-scheduler.ts`
- `services/agent-runtime/src/agent-delegate.ts`
- `services/agent-runtime/src/index.ts`

**Gateway:**
- `apps/gateway/src/routes/job.routes.ts`
- `apps/gateway/src/routes/agent-chat-loop.ts`
- `apps/gateway/src/routes/tools.routes.ts`

**Registry:**
- `services/agent-registry/src/agent-registry.service.ts`
- `services/agent-registry/src/index.ts`

**Database:**
- `packages/db/src/migrations/072_job_task_retry.sql`
- `packages/db/src/migrations/073_scheduler_running.sql`
- `packages/db/src/migrations/074_job_time_budget.sql`
- `packages/db/src/migrations-data.ts`

---

## Commits

1. `a5b47d1` — feat(agent-runtime): parallel task execution + transactional plan materialization
2. `a6311df` — feat(agent-runtime): task-level retry with exponential backoff
3. `d65c2f4` — feat(agent-runtime): streaming job progress via SSE
4. `656d474` — feat(agent-runtime): scheduler concurrency cap + at-most-once + proper cron
5. `afb9e1f` — perf(router): 5 efficiency optimizations
6. `a98920e` — feat(agent-runtime): memory cap, time-based budget, configurable compaction
7. `ee4d249` — feat(agent-runtime): tool cache invalidation, input validation, direct subagent lookup
