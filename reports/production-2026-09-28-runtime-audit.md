# DMR-X agent runtime / company gateway production audit

Date: 2026-09-28
Scope: `services/agent-runtime`, gateway agent routes, tenant/key/budget boundaries, lifecycle/restart/cancel/resource controls.
Mode: read-only audit; this report is the only file written.

## Verdict

Not production-ready for company workloads. This is a bounded source audit, not a live-provider certification. The durable SQLite session work is meaningful, but mocks/unit coverage cannot establish production readiness and the blockers below remain in execution isolation and lifecycle enforcement.

GitNexus note: status was checked twice and remained stale (`indexed 322afe4`, current `55513fb`) while the parent refresh was pending. Per instruction, this worker did not query the stale graph and did not reindex.

## Confirmed / strongly evidenced blockers (maximum 5)

### 1. Tenant-local conversation IDs are not bound to the addressed agent instance

Evidence:
- `apps/gateway/src/routes/agent-chat.routes.ts:129-133` loads and tenant-checks the requested instance.
- `apps/gateway/src/routes/agent-chat.routes.ts:168-174` then loads a persisted session solely by `(tenant.id, conversationId)` and appends messages without checking `persisted.agentInstanceId` against `context.instanceId`.
- The resume path repeats this: context load at `apps/gateway/src/routes/agent-chat.routes.ts:415-419`, session load at `:420-424`, with no instance/definition binding check.
- The store does persist both ownership fields (`services/agent-runtime/src/agent-session.store.ts:63-77`) and tenant-scopes `get` (`:239-245`), so the missing comparison is directly fixable.

Impact/reproduction: within one tenant, create a session under agent A using a caller-chosen `conversationId`, then call agent B's `/chat` or `/resume` route with the same ID. Agent B receives A's transcript/state. This crosses agent policy, prompt, tool, and confidentiality boundaries even though it does not cross tenants.

Minimal fix: after loading a persisted row, reject unless `persisted.agentInstanceId === context.instanceId` (and, defensively, persisted definition matches the current definition). Add unit route tests for chat and resume returning 404/409 on cross-instance reuse.

### 2. The formal lifecycle resource limits are in-memory and its expiry timer does not enforce the documented idle/absolute limits correctly

Evidence:
- All lifecycle state and timers are process-local maps: `services/agent-runtime/src/lifecycle.ts:63-65`.
- Spawn schedules one timer (`:67-78`). Transitioning to idle only checkpoints (`:81-98`); it does not schedule the configured `idleTimeoutMs`.
- Activity reschedules expiry (`:101-112`), but `scheduleExpiry` always waits `maxTtlMs` from the latest scheduling point (`:155-164`) while absolute TTL is calculated from `createdAt` (`:118-124`). Activity near the TTL can therefore defer the next check by another full TTL.
- Budget exhaustion only transitions to `terminating` (`:107-109`); it does not complete termination or cancel active work.

Impact/reproduction: use fake timers, spawn with `maxTtlMs=1000`, advance 900 ms, call `recordActivity`, then advance past 1000 ms from creation; the session remains until the newly scheduled full-TTL timer runs. Separately transition to idle with a short `idleTimeoutMs`; no idle timer is scheduled. A gateway restart loses this manager entirely.

Minimal fix: schedule the next deadline as `min(createdAt + maxTtlMs, idleSince + idleTimeoutMs)` rather than a fresh full TTL; on budget/expiry invoke a single terminal cleanup/cancel path. Either persist lifecycle rows or remove production claims and derive lifecycle from the already durable session store.

### 3. Scheduled runs can execute twice after a process crash, contrary to the stated at-most-once guarantee

Evidence:
- Startup explicitly resets persisted `running=1` rows after a crash: `services/agent-runtime/src/agent-scheduler.ts:273-281`.
- Claiming uses `next_run_at` plus `running=0`: `:321-341`.
- `next_run_at` is advanced only after the external gateway call and execution recording complete: `:395-450`.

Impact/reproduction: crash after the gateway accepted/executed the chat request but before lines 439-450 advance the schedule. On restart, `running` is cleared while the old `next_run_at` is still due, so the job is claimed and executed again. This can duplicate emails, writes, or billable calls.

Minimal fix: persist a run occurrence/idempotency key and advance/claim the occurrence transactionally before external execution; pass that key through execution recording/tool side effects. Label the current semantics at-least-once until downstream idempotency is enforced.

### 4. Cancellation is process-local and is not wired to abort the active provider request

Evidence:
- Agentic cancellation state is explicitly in-process: `apps/gateway/src/routes/agentic.routes.ts:80-89`.
- Streaming registers a conversation controller (`:408-411`) and checks it only between turns (`:426-430`).
- The active router call creates a different local controller solely for timeout and passes that signal (`:137-152`); it is not linked to the conversation cancellation controller.

Impact/reproduction: start a slow streaming provider turn and cancel the conversation. The loop can notice cancellation only after the provider call returns or reaches its independent 120-second timeout. Restart also erases cancellation state. Resource spend and side-effect latency continue after the caller believes the run is cancelled.

Minimal fix: compose the conversation cancel signal with the per-turn timeout signal and pass the combined signal to `router.route`; persist a cancelled terminal status and check it on resume/restart. Add a unit test with a router promise that rejects only when its received signal aborts.

### 5. Agent execution accepts caller-selected models while accounting is post-hoc and can record zero cost

Evidence:
- Agent chat directly prefers the request model over policy resolution: `apps/gateway/src/routes/agent-chat.routes.ts:135-138`; dispatch does the same at `apps/gateway/src/routes/agent-dispatch.routes.ts:257-260`.
- Dispatch allows `maxTokens` up to 1,000,000 (`apps/gateway/src/routes/agent-dispatch.routes.ts:21-38`) and has no request cost budget/admission field.
- Agent chat creates its execution record only after completion (`apps/gateway/src/routes/agent-chat.routes.ts:260-269`) and passes all accumulated tokens as input tokens, output tokens as `0`.
- Cost lookup is best-effort and remains zero when provider/model pricing cannot be resolved: `services/agent-runtime/src/agent-runtime.ts:411-449`; aliases such as `auto*` have no provider mapping (`:452-475`).

Impact/reproduction: submit an allowed agent chat/dispatch with an expensive explicit model and high token cap. There is no demonstrated preflight tenant/company reservation in these routes. For aliases or missing pricing, the stored charge can be zero even after successful spend; the body-level chat budget is loop-local, not company-wide admission control.

Minimal fix: reject arbitrary model overrides unless the key/role and agent policy allow them; perform tenant budget/quota reservation before routing and settle it from actual usage afterward. Require a finite server-side token/cost ceiling independent of client input, and fail closed when paid-model pricing/admission cannot be established.

## Existing strengths / recent progress actually observed

- Agent context lookup checks active status and tenant ownership (`services/agent-runtime/src/agent-runtime.ts:57-75`).
- Durable sessions are tenant-scoped in SQLite and support restart rehydration (`services/agent-runtime/src/agent-session.store.ts:5-23`, `:239-278`).
- Agent CRUD/deploy/analytics routes use explicit RBAC prehandlers and tenant checks (`apps/gateway/src/routes/agent.routes.ts:61-135`, `:188-307`).
- Scheduler has a concurrency cap and a database CAS claim (`services/agent-runtime/src/agent-scheduler.ts:131-145`, `:295-350`), though crash semantics remain at-least-once as above.
- Recent branch history shows the newest four commits concentrated on quota routing, dependency/telemetry, and UI accessibility; `git diff --name-only HEAD~4..HEAD` showed no `services/agent-runtime` or gateway agent-route changes. The last broad runtime/lifecycle work visible in history was `64edfdf`.

## Minimal company onboarding using existing endpoints

No new framework is needed:

1. Operator provisions one tenant/company and a scoped API key through the gateway's existing tenant/key administration path; keep one tenant per company security boundary and issue separate keys/roles for operators versus runtime callers.
2. With that key, create definitions using `POST /v1/agents` (or `POST /v1/agents/import` for existing agent markdown).
3. Deploy each approved definition with `POST /v1/agents/:id/deploy`; retain the returned instance ID.
4. Validate inventory with `GET /v1/agents` and `GET /v1/agents/instances`.
5. Invoke a fixed deployed instance using `POST /v1/agents/:instanceId/chat`; use a company-generated unique conversation ID and do not permit arbitrary model overrides until blocker 5 is fixed. Use `POST /v1/agentic/dispatch` only when intent-based selection is desired.
6. Operate through `POST /v1/instances/:id/pause` and `/resume`; inspect `/v1/instances/:id/executions`, `/stats`, and `/steps` for audit/usage.

Production onboarding gate: do not enable schedules or consequential tools until conversation-instance binding, cancellable execution, crash idempotency, and preflight company budget admission are fixed and exercised against a non-mock staging provider.

## Verification status

Targeted tests were not completed within this bounded worker's time window; no broad suite or live provider request was run. Findings above are source-confirmed and include minimal reproductions to turn into focused unit tests. No production-readiness claim is based on mocks.
