# DMR-X Agent Runtime — Roadmap

> Improvement items derived from a full source review of `services/agent-runtime` (v0.5.12).
> Each item is tagged by impact and linked to the file + line range where the gap lives.

---

## Priority 1 — Critical (Blocks real multi-agent jobs)

### 1. Parallel independent task execution
- **Gap:** `runJobPass` in `job-orchestrator.ts` iterates `before.ready` **sequentially**. A DAG with independent branches (A→B and A→C) wastes wall-clock time running B then C instead of in parallel.
- **Impact:** Throughput. A 10-task job with 4 independent branches can take ~10 pass cycles instead of ~6.
- **File:** `services/agent-runtime/src/job-orchestrator.ts:72-140`
- **Fix:** Collect all ready tasks, partition into independent sets, run each set concurrently via `Promise.all`. Each set's executor is independent; only synchronize on budget check.

### 2. Transactional plan materialization
- **Gap:** `materializePlan` in `job-planner.ts` inserts tasks **one-by-one**. A crash mid-insert leaves a partial plan with dangling `dependsOn` refs and no recovery path.
- **Impact:** Data integrity. Half-materialized jobs are unrecoverable without manual DB surgery.
- **File:** `services/agent-runtime/src/job-planner.ts:481-535`
- **Fix:** Wrap the entire insert loop in `BEGIN TRANSACTION` / `COMMIT`. If `validatePlan` throws, the whole plan is rejected atomically.

### 3. Streaming job progress (SSE/WebSocket)
- **Gap:** The job orchestrator is fully synchronous. The client gets **zero feedback** until the entire pass (or all passes) complete.
- **Impact:** UX + observability. A 10-minute job looks "stuck" with no way to monitor progress.
- **Fix:** Emit events (`task:started`, `task:completed`, `task:failed`, `pass:completed`) via a callback or EventEmitter. Gateway routes subscribe and push to SSE.

### 4. Task-level retry with exponential backoff
- **Gap:** Failed tasks are **terminal**. The `attempt` counter exists but only increments on orphan reclamation (`reclaimOrphanedTasks`), not on task failure. Transient provider errors (503, timeout) kill the whole job.
- **Impact:** Reliability. A single blip in a 20-task job means the entire job is marked `failed`.
- **File:** `services/agent-runtime/src/job-orchestrator.ts:147-188`
- **Fix:** On executor error, check `classifyProviderError`. If retryable, increment `attempt`, set status to `pending`, and apply exponential backoff (e.g., `min(2^attempt * 1000, 30000)` ms) before the next pass picks it up. Add a `maxRetries` field to `JobTask`.

---

## Priority 2 — High (Correctness & safety)

### 5. Real quality evaluation (not just efficiency)
- **Gap:** `evaluateExecution` in `agent-runtime.ts` is a weighted average of tool success rate, budget adherence, and turn efficiency. An agent returning perfect output in `maxSteps` scores **lower** than one returning garbage in 2 steps.
- **Impact:** Quality signal is inverted. Good agents look bad; bad agents look good.
- **File:** `services/agent-runtime/src/agent-runtime.ts:365-414`
- **Fix:** Add semantic evaluation. Pass the task's `acceptance` criteria to a separate LLM call that scores output against the criteria (1-5 Likert). Combine with current metrics, weighted toward outcome quality (e.g., acceptance score × 0.6 + tool success × 0.2 + budget × 0.1 + turns × 0.1).

### 6. AgentScheduler is too primitive
- **Gap:** `AgentScheduler` in `agent-scheduler.ts` only supports `* /N * * * *`, `N * * * *`, and a default "in 1 hour". No ISO cron, no timezones, no "every Monday at 9am", no at-most-once guarantee across restarts, no concurrency cap. If 1000 jobs become due simultaneously, it fires 1000 HTTP requests.
- **Impact:** Production scheduling is unreliable and dangerous at scale.
- **File:** `services/agent-runtime/src/agent-scheduler.ts:286-313`
- **Fix:** Replace hand-rolled cron with a proper parser (e.g., `croner` or similar). Add `maxConcurrency` (default 10), at-most-once via `UPDATE ... SET next_run_at = ? WHERE next_run_at = ?` atomic compare-and-swap, and timezone awareness via `Intl.DateTimeFormat`.

### 7. Memory prefetch has no length cap
- **Gap:** `agentMemoryManager.prefetchForPrompt` in `agent-runtime.ts:157-168` returns a string injected into the system prompt. If the memory store has large entries, this can silently balloon the context window near its limit.
- **Impact:** Context overflow, silent truncation, or increased cost with no guardrail.
- **Fix:** Cap the injected memory string (e.g., 2000 chars) with a `[truncated N memories]` note. Add a configurable `maxMemoryChars` per agent definition.

### 8. Single-shot toolless subagents can't do multi-step work
- **Gap:** `runSubagent` in `agent-delegate.ts` is explicitly single-shot and toolless (documented limitation). A specialist agent that needs to read files, call tools, or iterate cannot do so — it's "ask a question, get an answer" only.
- **Impact:** Subdelegation is useless for complex tasks. The parent must do all the work itself.
- **File:** `services/agent-runtime/src/agent-delegate.ts:83-142`
- **Fix:** Pass an `execute` callback + tool defs into `runSubagent` from the gateway's `tools.routes.ts` call site. Add a bounded ReAct loop with `maxSubagentSteps` (default 10) to prevent infinite loops.

---

## Priority 3 — Medium (Maintainability & polish)

### 9. Deduplicate session stores
- **Gap:** `AgentSessionStore` (336 lines) and `AgenticSessionStore` (186 lines) share ~70% of their upsert/get/delete logic. One is keyed by `agent_instance_id`, the other isn't.
- **Impact:** Drift. Bug fixes to one (e.g., corrupt-state handling) may not propagate to the other.
- **File:** `services/agent-runtime/src/agent-session.store.ts` + `agentic-session.store.ts`
- **Fix:** Extract a generic `BaseSessionStore<T>` with polymorphic key columns. Both stores extend it.

### 10. Re-plan / edit-plan capability
- **Gap:** Once materialized, the plan is immutable. If the LLM hallucinates a bad dependency (task depends on itself, or a non-existent ref), the job is stuck. No "edit plan" or "replan from here."
- **Impact:** Bad plans are fatal. Users must cancel and resubmit.
- **Fix:** Add `replan` endpoint that invalidates tasks after a checkpoint, re-prompts the LLM with current board state, and materializes a new plan. Allow manual `dependsOn` patch via PATCH `/jobs/:id/tasks/:id`.

### 11. Time-based budget
- **Gap:** Only USD and token budgets exist. A slow model could burn the entire token budget with no time guard.
- **Impact:** Cost spikes, SLO violations.
- **File:** `services/agent-runtime/src/job.store.ts:42-62`, `job-orchestrator.ts:226-235`
- **Fix:** Add `budgetDurationMs` to `Job`. In `budgetExhausted`, also check `Date.now() - jobStartAt >= job.budgetDurationMs`.

### 12. Input validation on job creation
- **Gap:** `brief` is unbounded free text. `acceptanceCriteria` is `unknown` (arbitrary JSON). A 10MB brief or adversarial payload could cause issues.
- **Impact:** DoS vector, potential prompt injection via acceptance criteria.
- **File:** `services/agent-runtime/src/job.store.ts:64-79`
- **Fix:** Add length limits (`brief` ≤ 10000 chars, `acceptanceCriteria` ≤ 50000 chars). Validate `acceptanceCriteria` against a JSON schema (no nested objects beyond depth 3, no `$ref`, no `patternProperties`).

---

## Priority 4 — Low (Nice-to-have / v1+)

### 13. Skill capture automation (not just a prompt nudge)
- **Gap:** "Consider capturing this as a skill every N turns" relies on the model voluntarily calling `skill_create`. No pattern detection, no "this 3-step sequence appeared 5 times, auto-suggest a skill."
- **Impact:** Skills accumulate slowly; users forget to capture.
- **File:** `services/agent-runtime/src/agent-runtime.ts:131-155`
- **Fix:** Post-session analysis pass: detect repeated tool-call sequences, compare against existing skills, and prompt the user with "I noticed you did X 3 times — capture as a skill?"

### 14. SQLite WAL mode + busy timeout for concurrent load
- **Gap:** `getDb()` returns a connection with no WAL enforcement, no busy timeout, no connection pooling. Under multi-tenant concurrent load, SQLite will lock.
- **Impact:** Write contention, "database is locked" errors.
- **File:** `@dmr-x/db` (shared package)
- **Fix:** Enable WAL (`PRAGMA journal_mode=WAL`), set `busy_timeout=5000`, and add a connection pool for multi-tenant scenarios. Document that horizontal scaling requires PostgreSQL.

---

## Summary table

| # | Item | Priority | File |
|---|------|----------|------|
| 1 | Parallel independent task execution | Critical | `job-orchestrator.ts` |
| 2 | Transactional plan materialization | Critical | `job-planner.ts` |
| 3 | Streaming job progress | Critical | `job-orchestrator.ts` |
| 4 | Task-level retry with backoff | Critical | `job-orchestrator.ts` |
| 5 | Real quality evaluation | High | `agent-runtime.ts` |
| 6 | AgentScheduler rewrite | High | `agent-scheduler.ts` |
| 7 | Memory prefetch cap | High | `agent-runtime.ts` |
| 8 | Multi-step tool-calling subagents | High | `agent-delegate.ts` |
| 9 | Deduplicate session stores | Medium | `agent-session.store.ts` + `agentic-session.store.ts` |
| 10 | Re-plan / edit-plan | Medium | `job-planner.ts` |
| 11 | Time-based budget | Medium | `job.store.ts` + `job-orchestrator.ts` |
| 12 | Input validation on job creation | Medium | `job.store.ts` |
| 13 | Skill capture automation | Low | `agent-runtime.ts` |
| 14 | SQLite WAL + busy timeout | Low | `@dmr-x/db` |

---

*Generated from source review: 2026-08-15. Version: `@dmr-x/agent-runtime@0.5.12`.*
