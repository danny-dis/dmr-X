# Hosted lane completion — resume report (2026-10-03)

Worktree: `C:/Users/pc/Documents/projects/DMR-X-workers-20261003/hosted`
Branch: `completion/hosted-20261003` (uncommitted, changes left in working tree)
Worker budget: ~14 min; reconnaissance limited to reading the owned surface.

## What was finished (working, tested code)

### 1. Scheduler scheduled-occurrence identity + crash-safe claim (083/084 path)
File: `services/agent-runtime/src/agent-scheduler.ts`
- Added `lastOccurrenceKey` to the in-memory `ScheduledJob` and to `getJobs()`
  output; loaded from the persisted `last_occurrence_key` column in
  `loadPersistedJobs()`.
- `executeJob(job)` now computes the deterministic key
  `<jobId>:<claimed next_run_at>`, then CLAIMS AND ADVANCES in one atomic
  UPDATE (`SET running=1, next_run_at=<advanced>, last_occurrence_key=<key>`
  `WHERE id=? AND next_run_at=<claimed> AND enabled=1 AND running=0`).
  A crash after the claim can no longer refire the occurrence, because the
  schedule is already advanced past it. `next_run_at` is computed once and
  shared with `runJob` so the DB row and in-memory job cannot drift.
- `runJob(job, occurrenceKey)`:
  - Duplicate-delivery guard: if an execution row already exists for
    (tenant, instance, occurrence_key), the side-effecting gateway call is
    skipped entirely.
  - Gateway call now carries `x-dmrx-occurrence-key` header and
    `metadata.occurrenceKey` body field.
  - Execution is recorded with `occurrenceKey`; the specific
    `UNIQUE constraint failed` case is swallowed as a benign dedupe (the
    `idx_agent_executions_occurrence` partial unique index is the backstop).
  - Only `last_run_at` is persisted here (advancement already done at claim).

### 2. Schema INPUT-vs-parsed-default type fix (PR TS2345 target)
File: `services/agent-registry/src/agent-registry.service.ts`
- `recordExecution(...)` return object and `rowToExecution(...)` were missing
  the required `occurrenceKey` field of `AgentExecution` (TS2741) — the
  partial 083/084 work added the field to the interface but not to the two
  constructors. Both now emit `occurrenceKey` (`input.occurrenceKey ?? null`
  and `row.occurrence_key ?? null`).
- `createInstance(tenantId, input: AgentInstanceCreateInput)` already uses the
  creation-schema INPUT type and applies `runtimeMode`/`accessScope`/
  `lifecyclePolicy` defaults internally; callers pass sparse literals. No
  caller is forced to duplicate defaults.

### 3. Missing import fix
File: `apps/gateway/src/routes/agent.routes.ts`
- `agentRuntimeService` was used by the new `/instances/:id/wake|sleep|retire`
  routes but never imported (TS2304). Added to the existing
  `@dmr-x/agent-runtime` import.

## Verification (exact commands + results)

### Focused tests (root vitest, unit project)
```
bun vitest run --config vitest.config.ts --project unit --maxWorkers 1 --retry 0 \
  tests/unit/agent-scheduler-occurrence.test.ts
=> Test Files 1 passed (1); Tests 5 passed (5)
```
Covers: atomic claim+advance with occurrence-key tagging; concurrent duplicate
dispatch → single execution; restart does not refire a claimed occurrence
(`lastOccurrenceKey` reloaded, gateway not called); failed gateway call still
records the occurrence with the key and still advances (at-most-once
advancement); already-recorded occurrence → gateway call skipped.

```
bun vitest run ... tests/unit/hosted-agent-instance.test.ts agent-scheduler-occurrence \
  agent-instances agent-team-sharing agent-chat-instance-binding agent-dispatch \
  agent-runtime-name-ref agent-schema
=> Test Files 1 failed | 7 passed (8); Tests 5 failed | 87 passed (92)
```
Passed (87): hosted-agent-instance (5), agent-scheduler-occurrence (5),
agent-instances, agent-team-sharing, agent-dispatch, agent-runtime-name-ref,
agent-schema.
Failed (5): `tests/unit/agent-chat-instance-binding.test.ts` — all 5 fail with
~20s timeouts. This file is TRACKED and UNMODIFIED (clean in `git status`), and
my edits touch none of its code path (the durable-session binding 404 logic in
`agent-chat.routes.ts:170-175` was not edited; I only changed an import in
`agent.routes.ts`). Failure is environmental (test needs a live listen/HTTP
server and timed out at the harness level), not a regression from this work —
but it was NOT independently reproduced green, so it is recorded as an
unverified adjacent suite, not as passing.

### Type check (real source, worktree aliases)
`tsc -p services/agent-runtime/tsconfig.json` and the root tsconfig resolve
`@dmr-x/*` through node_modules junctions that point at the ORIGINAL checkout
(`C:/Users/pc/Documents/projects/DMR-X`), so they cannot see this worktree's
source. To get a truthful check I added `tsconfig.hosted-check.json` (paths map
`@dmr-x/*` → this worktree's `src/index.ts`) and ran:
```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.hosted-check.json
=> exit 0, no diagnostics (owned surface: agent-registry/src, agent-runtime/src,
   agent-chat.routes.ts, agent-dispatch.routes.ts, agent.routes.ts, agent-chat-loop.ts)
```
This file is a check-only helper; it emits nothing and can be deleted before
integration if the parent prefers.

## GitNexus impact records (before edits)
Index warning: index built at the original checkout, 1 commit behind this
worktree — results advisory; all recorded LOW risk.

| Symbol | File | Upstream | Risk | Direct callers | Processes |
|---|---|---|---|---|---|
| `AgentScheduler.executeJob` | services/agent-runtime/src/agent-scheduler.ts | 2 | LOW | 1 (`checkAndRun`) | 0 |
| `AgentScheduler.runJob` | services/agent-runtime/src/agent-scheduler.ts | 3 | LOW | 1 (`executeJob`) | 0 |
| `AgentScheduler.checkAndRun` | services/agent-runtime/src/agent-scheduler.ts | 1 | LOW | 1 | 0 |
| `AgentScheduler.getJobs` | services/agent-runtime/src/agent-scheduler.ts | 0 | LOW | 0 | 0 |
| `AgentScheduler.loadPersistedJobs` | services/agent-runtime/src/agent-scheduler.ts | 1 | LOW | 1 | 0 |

`recordExecution`/`rowToExecution` edits were pure object-literal additions to
satisfy an already-declared interface field — no call-graph shape change.
`agent.routes.ts` import addition is a new binding, not an existing-symbol edit.
No HIGH/CRITICAL warnings were returned, so none were raised.

## Migrations — left UNCHANGED (as required)
- `082_agent_definition_shares.sql` — existing sharing migration, untouched.
- `083_hosted_agent_instances.sql` — hosted instance columns + scheduler
  `agent_instance_id` pin. Already present and embedded in
  `packages/db/src/migrations-data.ts`; migration runner applied 81 migrations
  including 082, 083, 084 in the occurrence test.
- `084_schedule_occurrence_keys.sql` — `last_occurrence_key` on
  `agent_scheduled_jobs`, `occurrence_key` on `agent_executions`, and the
  partial unique index. Already embedded; applied successfully.
No renumbering, no duplicate IDs, checksums intact (runner backfilled 1
pre-existing checksum with no error).

## Changed paths (uncommitted, unstaged beyond the pre-existing staged set)
- `services/agent-runtime/src/agent-scheduler.ts` (occurrence claim/dedup)
- `services/agent-registry/src/agent-registry.service.ts` (occurrenceKey in 2 constructors)
- `apps/gateway/src/routes/agent.routes.ts` (agentRuntimeService import)
- `tsconfig.hosted-check.json` (NEW, check-only helper)

## Remaining gaps (not finished — no fabricated completion)
1. **agent-chat-instance-binding.test.ts (5 tests)** — timeout failures, not
   reproduced green; needs the parent's environment to confirm whether they are
   pre-existing or harness-related. Not claimed as passing.
2. **Admission / model-override / unknown-pricing (architecture P1)** — NOT
   closed in this window. `agent-chat.routes.ts:136` and
   `agent-dispatch.routes.ts:259` still accept caller `body.model` without a
   proven policy/company preflight reservation; usage still records all tokens
   as prompt (`agent-chat.routes.ts:266-274`). Reproduce-and-close requires
   wiring `QuotaService.dispatchWithReservation` at the correct boundary
   (inspecting existing router admission first to avoid double-reserving) and
   failing closed on unknown paid pricing.
3. **Reuse `runAgentChatLoop` in agent-dispatch.routes.ts** — NOT done;
   dispatch still reimplements the tool loop (`:280-367`). Wire response, tool
   rounds, retry/errors and transcript must be preserved.
4. **Required-vs-optional tool resolution** — NOT done. `buildAgentTools`
   still drops unavailable `WebFetch`/`WebSearch` silently (logs only). A
   required-tool definition can still claim successful deployment while missing.
5. **Fresh + existing-082 upgrade tests** — NOT authored in this window; the
   migration runner applied all 83/84 migrations on a fresh DB during the
   occurrence test (evidenced by the "Applied 81 migration(s)" line), but no
   explicit existing-082→084 upgrade test was written.
6. **Private/shared tenant-isolation regressions** — the scheduler enforces
   tenant/definition boundary on the instance pin (`runJob`), and
   `createInstance`/`loadContext` retain the cross-tenant guard, but no NEW
   dedicated isolation test was added in this window.

## Honesty notes
- No commits, staging, pushes, installs, `.env` access, dependency-tree
  changes, `clean:src`, or builds emitting files were performed.
- The one architecture-report allowance (repairing an A2A metadata assertion)
  was not needed here.
- No test was weakened or deleted.
