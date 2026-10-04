# DMR-X completion architecture review

Date: 2026-10-03
Scope: read-only review of gateway/router/runtime/MCP/A2A boundaries, Playground-to-agent handoff, admission/accounting, lifecycle, and reuse opportunities.
Review tree: `C:/Users/pc/Documents/projects/DMR-X-workers-20261003/architecture`
Source baseline: worker HEAD `e09aff3`, preserving parent baseline `55513fb` plus the isolated production-readiness checkpoint.

## Constraints and method

No source files, configuration, dependencies, credentials, or services were changed. No commit, package installation, inference call, build, or test run was performed. Only this report was written.

Evidence used:

- Direct source inspection in the worker tree.
- Existing gate, runtime, protocol, roadmap, and UI/runtime plan reports.
- GitNexus query/context against the indexed `dmr-X` repository. The index was current for `55513fb` (15,219 symbols, 37,249 relationships, 300 processes), while the worker checkpoint is one preservation commit ahead; conclusions below were checked against the worker source where relevant.

GitNexus flows queried:

- Gateway/chat/router/adapter/response/streaming.
- Playground/agent runtime/MCP tool execution/cancellation.
- MCP HTTP initialization/session/auth/tool catalog.
- Quota reservation/admission/usage reconciliation.
- A2A proxy/task/peer authentication.

Key contexts captured:

- `Router.route` has direct callers across chat, Anthropic, Gemini, tools, agent dispatch, agentic, audio, image, OCR, moderation, and route-decision paths; it calls `routeSimple`, `routeComposite`, and `isComplexPrompt`.
- `createServer` is called by gateway `main` and wires the adapter registry and route boundary.
- `chatRoutes` is a large route-level orchestration boundary with provider preference, quality target, cost filter, streaming, and response conversion concerns.
- `startStreamableHTTP` creates the MCP server and starts session sweeping; the previous implementation was session-oriented.
- `QuotaService.dispatchWithReservation` composes reservation, commit, and release, but the reviewed agent paths do not consistently enter that admission boundary.
- `a2aProxyRoutes` uses configuration, sidecar calls, and `validateBaseUrlForSSRF`; the peer-probe fix is present in the checkpoint.

## Executive findings

The current checkpoint closes several previously reported boundary defects: agent chat/resume now checks persisted instance and definition identity; MCP HTTP Origin/auth hardening is covered by focused evidence; MCP credential request context uses async-local state; and the A2A peer probe pins validated DNS, disables redirects, caps response size, and closes its dispatcher. Those are not repeated as open bugs.

The remaining production blockers are ownership and admission semantics, not a need for a new framework. The highest-value path is to reuse existing gateway/router/store primitives rather than add another runtime or billing layer.

## Ranked real bugs and feature gaps

Severity/effort: P0/P1/P2; effort is relative small/medium/large.

### P0 — A2A task ownership is still not enforced

Evidence: `services/mcp-server/src/a2a/task-manager.ts`, `services/mcp-server/src/a2a/jsonrpc.ts`, `services/mcp-server/src/a2a/persistence.ts` and the production gate at `reports/production-2026-09-28-gate.md:67-72`.

Tasks remain process-global and task operations are keyed by task ID. The current checkpoint authenticates the HTTP boundary, but authentication alone does not bind a task to the principal/company that created it. `tasks/get`, `tasks/list`, `tasks/cancel`, resubscription, and push-config operations need immutable owner/principal fields and owner-scoped lookups. A caller who learns another task ID must not be able to read, cancel, or attach delivery to it.

Disposition: release blocker. Reuse the existing authenticated principal/tenant context and add owner fields to the existing task store; do not create a second identity system.

Acceptance: key A cannot list/get/cancel/resubscribe/configure a task created by key B; same-key operations continue to work; legacy task rows fail closed or receive an explicit migration owner policy.

### P0 — A2A push notification delivery remains an SSRF and credential-egress risk

Evidence: `services/mcp-server/src/a2a/jsonrpc.ts` accepts caller-supplied push URLs; `services/mcp-server/src/a2a/persistence.ts` performs delivery; prior protocol audit `reports/production-2026-09-28-protocol-audit.md:28-43`.

The peer-card probe fix does not protect webhook delivery. Delivery still needs scheme/IP validation, DNS-rebinding protection, redirect control, and a decision about whether caller-supplied authorization material may be forwarded. Validate at registration and again at delivery because DNS can change between those events.

Disposition: release blocker for externally reachable A2A. Reuse `apps/gateway/src/routes/admin-ssrf.ts` validation concepts and the pinned-dispatcher pattern from the fixed peer probe.

Acceptance: reject file/loopback/RFC1918/link-local/metadata/IPv4-mapped destinations, reject or revalidate redirects, pin the approved address, and never send secrets to a rejected target.

### P1 — MCP current-protocol claim is not supported by the implementation evidence

Evidence: `services/mcp-server/src/index.ts`, `services/mcp-server/src/session-runtime.ts`, `reports/production-2026-09-28-gate.md:74-78`, and `reports/production-2026-09-28-protocol-audit.md:61-78`.

The implementation is session-oriented and the prior live check observed legacy initialize/list success (332 tools) but a stateless request failed with `Server not initialized`. That is a compatibility surface, not proof of current stateless Streamable HTTP conformance. Either implement a separately explicit current mode and test it, or advertise only the legacy mode actually supported.

Disposition: release blocker only if current MCP protocol support is advertised; otherwise downgrade to a documented compatibility limitation.

Acceptance: independent client checks cover stateless POST, Origin rejection, protocol headers, notification semantics, and unsupported methods. Documentation and agent card/configuration match the tested version.

### P1 — A2A version negotiation is not implemented consistently with its advertised interface

Evidence: `services/mcp-server/src/a2a/agent-card.ts`, `services/mcp-server/src/a2a/handler.ts`, `services/mcp-server/src/a2a/jsonrpc.ts`, protocol audit `:80-96`.

The agent card advertises 1.0 while retaining legacy 0.3 fields, but request dispatch does not select behavior from `A2A-Version` or return a version-not-supported error. This creates a false-success path where clients request one version and receive mixed semantics.

Disposition: release blocker for the 1.0 claim; otherwise advertise only the supported legacy contract.

Acceptance: explicit 1.0, missing/empty legacy-compatible, query-parameter, and unsupported-version tests; serialization and errors follow the selected version.

### P1 — Agent model override and spend admission are still caller-controlled/post-hoc

Evidence: current `apps/gateway/src/routes/agent-chat.routes.ts:135-138` selects `body.model` before policy resolution; `:266-274` records all accumulated tokens as input and output as zero; current `apps/gateway/src/routes/agent-dispatch.routes.ts:257-260` also accepts `body.model`. `services/agent-runtime/src/agent-runtime.ts:414-452` computes cost only when provider pricing resolves and otherwise records zero. The runtime audit documents the same gap at `reports/production-2026-09-28-runtime-audit.md:61-71`.

An agent caller can request an expensive model and large token budget without a demonstrated preflight company reservation. Missing/alias pricing can turn real provider spend into a zero-cost execution record. The body-level loop budget is not company-wide admission control.

Disposition: release blocker for paid/company workloads; not required for a strictly local free-only deployment.

Acceptance: policy-authorized overrides only; finite server-side cap independent of client input; reserve before routing through existing quota/budget primitives; settle actual prompt/completion usage; fail closed when paid pricing or admission is unknown; test alias and missing-pricing cases.

### P1 — Agent cancellation does not abort the active provider request

Evidence: `apps/gateway/src/routes/agentic.routes.ts` keeps cancellation controllers in process-local state and checks them between turns; its `routeWithTimeout` creates a separate timeout controller. `services/agent-runtime/src/lifecycle.ts` likewise has no provider cancellation hook. Runtime audit `:50-59` records the same separation.

Cancelling a streaming conversation can leave the current provider call running until completion or the independent timeout. Restart loses the cancellation state. This is wasted spend and makes the API's cancellation result misleading.

Disposition: release blocker for consequential/paid runs. Reuse one composed `AbortSignal` for conversation cancellation plus per-turn deadline and pass it through `Router.route` to the adapter.

Acceptance: a test provider rejects when the received signal aborts; cancel terminates the active turn, persists terminal cancelled status, and resume/restart cannot silently restart a cancelled turn.

### P1 — Lifecycle idle and absolute TTL timers are incorrect and process-local

Evidence: `services/agent-runtime/src/lifecycle.ts:63-165`.

`transition(..., 'idle')` checkpoints but does not schedule `idleTimeoutMs`. `recordActivity()` reschedules a timer for a fresh full `maxTtlMs`, so activity near the absolute deadline can defer enforcement past the configured TTL. Budget exhaustion only transitions to `terminating`; it does not perform the terminal cleanup path. All lifecycle maps/timers disappear on restart.

Disposition: release blocker for documented lifecycle guarantees; optional for an explicitly best-effort ephemeral mode.

Acceptance: next deadline is the minimum absolute and idle deadline; budget/expiry invokes one idempotent cancellation/termination path; persisted session state is reconciled after restart or documentation removes durability claims.

### P1 — Scheduled execution is at-least-once despite the at-most-once wording

Evidence: `services/agent-runtime/src/agent-scheduler.ts:273-281` resets `running` after restart; `:321-350` claims with a CAS; `:395-450` advances `next_run_at` only after external gateway execution and recording. Runtime audit `:39-48` gives the crash window.

A crash after the gateway accepts the request but before schedule advancement causes the same occurrence to run again. The process-local `running` flag and database CAS prevent concurrent claims, not crash duplicates.

Disposition: release blocker for external side effects; otherwise document at-least-once semantics.

Acceptance: persist an occurrence/idempotency key, claim/advance the occurrence before external work, pass the key into execution/tool side effects, and test crash recovery. Do not promise exactly-once where downstream systems cannot honor idempotency.

### P1 — Explicitly requested agent tools can disappear without a capability-level failure

Evidence: current `apps/gateway/src/routes/agent-chat.routes.ts:46-95` resolves requested names from the gateway registry and skips missing names. The code now logs missing names, but the route continues with the resolvable subset. Its own comment identifies 16 of 17 restricted agents requesting `WebFetch`/`WebSearch` while neither is registered.

This is an actual feature failure for agents whose contract requires web access: the agent runs and can answer from model priors without the requested capability. Logging is useful observability, not feature completion.

Disposition: release blocker for agents whose definition requires a missing tool; optional warning for intentionally best-effort definitions.

Acceptance: distinguish required from optional tools; fail deployment or invocation for missing required tools; expose the resolved/missing catalog to the caller; wire an existing MCP-backed web tool only after policy and egress controls are in place.

### P2 — Playground-to-agent-to-MCP handoff is only partially unified

Evidence: GitNexus query found UI Playground state and `MCPToolAdapter`, but the gateway agent routes (`agent-chat.routes.ts`, `agent-dispatch.routes.ts`) independently construct tool definitions from `tools.routes.ts`. `services/mcp-client/src/adapter.ts` is a separate outbound execution path. The UI/runtime plan explicitly requires real typed query layers and a usable handoff (`docs/plans/DMRX_UI_AGENT_RUNTIME_V2_PLAN.md:1-7`).

The architecture has the pieces, but there is no single typed handoff contract proving that a Playground-selected agent, model policy, conversation, and MCP tool scope are carried unchanged into runtime execution. This leaves room for UI-selected tools/models to be silently narrowed or bypassed by route-local defaults.

Disposition: release feature gap for the requested product workflow; not a reason to rewrite MCP.

Acceptance: one contract test starts from the Playground request, resolves the deployed instance, preserves policy/conversation identity, returns the effective MCP tool catalog, executes one policy-safe tool, and records the same run/trace identifiers.

## Feature-preserving reuse opportunities

Ranked by impact/effort; these are bounded extractions, not broad refactors.

1. High impact / medium effort — use `runAgentChatLoop` as the sole agent turn engine. `agent-chat.routes.ts` already calls it, while `agent-dispatch.routes.ts:280-367` reimplements model/tool rounds, retries, tool execution, and round limits. Route dispatch should resolve an instance/context and invoke the shared loop. Acceptance: identical tool-call transcript, error, budget, and response behavior for chat and dispatch.

2. High impact / medium effort — create one `PrincipalContext` resolver for MCP HTTP, A2A, and protocol session operations. Reuse the current `auth-runtime.ts`, `http-security.ts`, tenant-key handling, and request-local credential context. Acceptance: every non-public transport reaches the same principal resolver before task/session/tool dispatch; public agent-card discovery remains explicitly separate.

3. High impact / medium effort — extract a shared safe outbound HTTP connector. Reuse `admin-ssrf.ts` validation and the fixed A2A peer-probe pinned dispatcher for A2A webhook delivery, peer probes, and any future external MCP callback. Acceptance: one test matrix covers DNS pinning, redirects, private ranges, body limits, timeout, and dispatcher cleanup.

4. High impact / medium effort — route agent admission through existing quota primitives. `QuotaService.dispatchWithReservation` already has reserve/commit/release semantics; agent chat/dispatch currently record after the call. Add a small adapter from agent usage to the existing reservation dimensions rather than a new billing service. Acceptance: rejected admission makes no provider call; success commits measured usage; failure releases or settles according to the existing contract.

5. High impact / small effort — centralize composed deadlines/cancellation. Put conversation abort plus per-turn timeout in one helper and pass its signal through router/adapters. Acceptance: cancellation, timeout, client disconnect, and provider abort are distinguishable and idempotent.

6. Medium impact / medium effort — make the existing MCP catalog the typed source for agent tool definitions and execution. Replace route-local “registered definitions” snapshots with a catalog object containing namespace, server, schema, required/optional policy, and executor. Acceptance: Playground, agent chat, dispatch, and MCP UI display the same effective catalog and scope.

7. Medium impact / medium effort — persist scheduler occurrence identity using the existing scheduled-job tables and execution records. Do not add a queue product. Acceptance: restart recovery produces one recorded occurrence ID and downstream tool calls receive it.

8. Medium impact / small effort — extract usage normalization before execution recording. All loop steps should emit prompt tokens, completion tokens, total tokens, provider/model, and cost evidence through one normalizer. Acceptance: multi-step totals reconcile; unknown pricing is visible as unknown/unadmitted, never silently zero for a paid run.

9. Medium impact / small effort — share request policy parsing across chat, agent, agentic, Anthropic, and Gemini routes. GitNexus shows many direct callers of `Router.route`; route-local handling of model, quality, cost, provider preferences, and streaming should produce one internal policy object while preserving wire-format converters.

## Acceptance matrix for unfinished work in current reports/trackers

| Area | Current evidence/status | Release disposition | Minimum acceptance |
|---|---|---|---|
| A2A HTTP auth/Origin and peer probe | Fixed in checkpoint; gate records focused MCP and peer evidence | Already solved; regression protect | Keep focused tests green; do not reopen wildcard trust |
| A2A task ownership | Still open in gate/protocol audit | Required for external A2A | Principal-bound CRUD/list/cancel/resubscribe/config tests |
| A2A webhook SSRF | Still open; peer probe fix does not cover delivery | Required for external A2A | Safe URL validation, pinning, redirect/body/secret tests |
| MCP stateless/current conformance | Legacy path observed; stateless request failed initialization | Required only if current version advertised | Independent client conformance or narrow claims |
| A2A 1.0 negotiation | Advertised but not selected/enforced | Required for 1.0 claim | Version matrix and normative error behavior |
| Agent instance/definition conversation binding | Fixed in checkpoint and gate | Already solved; regression protect | Cross-instance and cross-definition 404 tests |
| Agent model override/admission/settlement | Open in runtime audit and current routes | Required for paid/company workloads | Preflight reservation, policy, measured settlement |
| Agent cancellation/deadlines | Open; separate controller and bad lifecycle timer | Required for consequential runs | Abort propagation, absolute/idle deadline, terminal persistence |
| Scheduler crash idempotency | Open; current semantics are at-least-once | Required before external side effects | Occurrence key and crash-recovery test |
| Playground→agent→MCP handoff | Partially wired; no single verified contract | Required for the requested product workflow | End-to-end typed contract test without live inference |
| Missing WebFetch/WebSearch capability | Explicitly logged but still unavailable | Required for definitions that require it; otherwise optional | Required/optional tool semantics and effective catalog response |
| Cluster scorer routing | `cluster-scorer.ts` initialized but no callers; roadmap status says flag changes no routing | Optional backlog, not hidden release work | Either wire a tested strategy or mark scaffold explicitly |
| Federation request routing | `FederationRouter.routeRequest` has no callers | Optional backlog | Do not claim cross-instance request routing until a caller and test exist |
| Benchmark SLO alert | Roadmap marks planned | Optional backlog | Add only with a defined measured signal and alert test |
| MCP aggregator marketplace/catalog/UX | Historical market-gap document, not a correctness defect | Optional product backlog | Do not block gateway release; prioritize only after boundary/security gates |
| UI automated coverage | Roadmap reports no `apps/ui` tests | Quality gap; not a hidden feature requirement | Add focused contract/accessibility tests around changed handoff surfaces |

## What should not be treated as a release requirement

Do not make federation, marketplace, a new billing backend, a new queue, a new data store, or a full MCP rewrite prerequisites for this completion. The open blockers can be closed with the existing gateway, router, SQLite stores, MCP server/client, quota service, and adapter interfaces. The roadmap's disconnected cluster scorer and federation router are real status gaps, but they are separate optional features unless product scope explicitly enables them.

## Verification record

No tests/builds were run by this read-only worker, per instruction. Existing evidence sampled from the prior gate includes: 1,737 unit tests passed across 152 files before the final focused clarification; 15 focused MCP tests passed; 18/18 isolated HTTP assertions passed; the free-only live baseline passed 16/18 functional checks, with two `auto-smart` failures; and 332 tools were observed on the legacy MCP initialize/list path. These numbers support the distinction between exercised compatibility slices and the still-unproven ownership, admission, lifecycle, and protocol claims.

Exact artifact path: `C:/Users/pc/Documents/projects/DMR-X-workers-20261003/architecture/reports/completion-architecture-20261003.md`
