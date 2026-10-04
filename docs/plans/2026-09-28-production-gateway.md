# DMR-X Production Gateway Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make DMR-X a dependable, tenant-safe single entry point for company inference, tools and agent execution, with an explicitly bounded free-only service.

**Architecture:** Retain the existing Bun/TypeScript gateway, router, durable stores and optional MCP/A2A sidecar. Centralize identity, policy, admission and audit at trust boundaries; reuse existing mechanisms rather than add another orchestration framework. A single customer-facing HTTPS origin may front multiple internal processes, but forwarding must preserve authenticated identity and streaming semantics.

**Tech Stack:** Existing Bun 1.3.14 / TypeScript / Fastify / React / SQLite workspace, Vitest and current MCP SDK. No new application framework, database migration or external service is assumed by this plan.

## Starting evidence — 28 September 2026

- Checkout `plan/ui-agent-runtime-v2`, HEAD `55513fb`, initially clean. Recent changes include quota reservations, free-only dispatch/fallback guards, bounded 429 handling, architecture/runtime slices, UI accessibility and dependency updates.
- Daily gateway `127.0.0.1:47113`: health and subsystem health return 200. MCP/A2A sidecar `127.0.0.1:47114` is running. They were not restarted or reconfigured for this audit.
- Gateway/free admission baseline: **64 tests passed in six files**. Some auth tests duplicate extracted logic, so this does not prove actual middleware end-to-end behavior.
- Gateway, agent-runtime, MCP server and MCP client TypeScript checks passed before changes.
- Real free-only sample: **16/18 functional checks passed**. Agentic 6/6; coding 6/6; smart 4/6 (wrong arithmetic from a selected model; a 30-second provider deadline). All three streams passed existing scorers. A single small sample is not an availability SLO or proof of accounting correctness.
- Legacy MCP initialize/list succeeds, exposing 332 tools. Current stateless MCP request returns `Server not initialized`; invalid Origin returns 400 rather than 403. A2A advertises 1.0 but `ListTasks` returns method-not-found. Legacy task listing returns tasks without authentication on the current local setup; source inspection additionally finds dispatch before the configured sidecar auth gate.
- Sol source audits are in `reports/production-2026-09-28-{protocol,runtime}-audit.md`; their broader findings need individual reproductions. Do not mark all findings verified merely because the audit says so.
- GitNexus incremental rebuild failed on inconsistent FTS state. Subsequent graph impact results contained corrupt/unrelated callers; critical warnings were surfaced. A forced rebuild is a tooling recovery, not application verification.

## Research decisions

1. **One gateway means one contract, not one giant process.** Teams need scoped, revocable application keys, model/tool permissions and attributable budgets. Existing gateway products expose virtual keys and per-key/team budget controls; these are useful onboarding expectations, not instructions to clone every enterprise feature.[5][6]
2. **MCP versions must be explicit.** The 2026-07-28 transport removed protocol sessions/GET streams and requires per-request version metadata with header/body agreement. Keep legacy clients working via tested version negotiation; do not equate an old initialize handshake with current compliance.[1][4]
3. **Authenticate every transport before dispatch.** MCP HTTP authorization has a standard OAuth resource-server flow; STDIO uses environment credentials. If DMR-X only supports static bearer keys for a deployment, say so rather than claim interoperable OAuth authorization.[2]
4. **A2A is not tool calling with a different URL.** Its normative task/message schemas, versioned methods, ownership and terminal-state semantics must be tested with an independent client. Advertising 1.0 while serving only legacy method names is not acceptable.[3]
5. **Free is a policy constraint, not unlimited capacity.** OpenRouter documents account-wide free-request caps; extra keys/accounts do not create independent capacity. Other providers require their own live quota and data-use checks. Never promise company availability from catalog size or silently fall back to paid usage.[7]

## Release scope and YAGNI

Initial release target: one company per tenant, separate application/service keys, existing provider adapters, inference/stream/tools, a bounded runtime, and explicitly versioned MCP/A2A. Add no new marketplace, federation layer, billing engine, bandit scheme, microservice split or database backend until a measured requirement demands it. Do not delete working features merely because they are optional; isolate and label unverified ones.

### Task 1 — Agent-instance conversation binding (first repair slice)

**Objective:** Prevent one deployed agent from inheriting another agent's persisted conversation within the same tenant.

**Files:**
- Modify: `apps/gateway/src/routes/agent-chat.routes.ts`
- Test: `tests/unit/agent-chat-instance-binding.test.ts`

1. Build Fastify route tests: seed/mock a persisted session belonging to instance A; address instance B with the same conversation ID through chat and resume.
2. Run `bun vitest run --project unit --maxWorkers 1 tests/unit/agent-chat-instance-binding.test.ts`; require a behavioral failure before patching.
3. Reject ownership mismatch before adding messages, resolving tools or starting a provider call. Check definition binding where defined. Return a non-disclosing 404.
4. Prove same-instance continuation remains valid and stored state is unchanged on rejection.
5. Run related agent session/routes tests and gateway typecheck. Review the exact diff; no automatic commit or live restart.

### Task 2 — Peer discovery SSRF (first repair slice)

**Objective:** Use the already validated DNS address during the actual outbound connection.

**Files:**
- Modify: `apps/gateway/src/routes/a2a-proxy.routes.ts`
- Test: `tests/unit/a2a-peer-probe-security.test.ts`

1. Add a failing route regression showing the returned DNS lookup is discarded and redirects are followed.
2. Use native `node:http`/`node:https` requests with lookup pinned to the validated IP; never follow redirects. Bound card bodies to 1 MiB and destroy rejected responses. A real Bun probe found the built-in Undici shim did not honor the proposed dispatcher and lacked its expected cleanup method, so the initial mocked-only implementation was replaced.
3. Run the focused test, valid-card success and error tests, plus gateway typecheck.
4. Independently review that no fallback reintroduces an unpinned fetch.

### Task 3 — MCP request identity and HTTP boundary (first repair slice)

**Objective:** Prevent concurrent calls from borrowing the last request's gateway key; reject untrusted browser Origins before any protocol dispatch.

**Files:**
- Modify: `services/mcp-server/src/tenant-key.ts`, `services/mcp-server/src/index.ts`
- Create/test: focused request-context and HTTP-boundary tests under `tests/unit/`
- Create only if needed: a small `services/mcp-server/src/http-security.ts` shared by both HTTP transports

1. Add an interleaved async regression: suspend request A, run request B, resume A; each resolver must retain its own headers and no request header may survive outside its request scope.
2. Use `AsyncLocalStorage.run`, not a process-global last-request slot; pass explicit headers where already available.
3. Add real local HTTP tests for missing/allowed/invalid Origin and for A2A auth-before-dispatch. Deny restricted MCP keys access to unscoped A2A execution until policy translation exists.
4. Keep discovery/public health exceptions explicit. Wire the same small guard into both SSE and Streamable HTTP listeners.
5. Run existing tenant-key/tool-restriction tests, new regressions, and MCP typecheck. Verify with a fresh isolated listener, not the unchanged daily process.

### Task 4 — Complete A2A ownership and safe webhooks (release blocker)

**Files:** `services/mcp-server/src/a2a/{handler,jsonrpc,task-manager,persistence,dispatch}.ts` and focused new tests.

1. Reproduce unauthorized and cross-principal get/list/cancel/resubscribe/push-config calls over real HTTP.
2. Resolve an authenticated immutable principal, persist task ownership and scope *all* operations including legacy REST shims. A caller-supplied key string or task ID is not proof of identity.
3. Validate webhook URLs both at registration and delivery; pin DNS, block private/link-local destinations and redirects. Reuse a safe egress primitive only if dependency direction permits it; otherwise keep a small local policy module.
4. Test restart rehydration and ownership retention. Until green, do not expose a shared A2A sidecar to unrelated companies.

### Task 5 — Protocol conformance (release blocker)

**Files:** MCP HTTP transport in `services/mcp-server/src/index.ts`; A2A card/handler/RPC/types; independent conformance fixtures.

1. Pin supported versions in documentation and tests. Withdraw unsupported advertisements or implement the complete advertised schema/method set—aliases alone are not 1.0 conformance.
2. MCP: current no-session POST, version negotiation, header/body mismatch, cancellation, Origin, legacy coexistence, restricted tool catalog and authenticated calls with an independent SDK client.[4]
3. A2A: `SendMessage`, `GetTask`, `ListTasks` pagination (including terminal empty token), cancel, streams, unsupported-version errors and capability-gated operations using normative schemas.[3]
4. Exercise each claimed optional capability; hide unsupported controls/capabilities rather than fabricate successful responses.

### Task 6 — Runtime deadlines, cancellation and crash semantics

**Files:** `services/agent-runtime/src/{lifecycle,agent-scheduler,agent-runtime}.ts`, `apps/gateway/src/routes/agentic.routes.ts`, session stores and relevant tests.

1. Fake-clock regressions for absolute TTL, idle timeout and budget exhaustion. Next timer fires at the earliest remaining deadline, not a fresh full TTL after activity.
2. Link conversation cancellation to the active router AbortSignal; prove a blocked provider call aborts immediately and persists cancelled state.
3. Crash/restart tests around scheduled dispatch acceptance. Persist occurrence identity and downstream idempotency; describe execution as at-least-once until side effects are safely deduplicated.
4. Verify tenant/agent model policy and pre-dispatch budget reservation with real route tests. Reconcile actual input/output usage; missing pricing must not silently authorize paid work.

### Task 7 — Company onboarding and operations

**Files:** `docs/DEPLOYMENT.md`, `docs/CONFIGURATION.md`, a concise company quickstart, existing tenant/key admin routes, deployment manifests as required by failed tests.

1. Fresh managed-mode/non-local-mode staging: reject missing/bogus keys; create company tenant, least-privilege service key, approved provider/model policies and finite budgets; verify key revocation.
2. Give developers a base URL and scoped key, with tested OpenAI/Anthropic/Gemini examples. Do not distribute master/provider keys to applications.
3. Publish a single HTTPS origin mapping inference, MCP and A2A paths to internal processes. Protect admin/metrics, preserve auth and request IDs, disable proxy SSE buffering, enforce body/time limits. Do not expose the sidecar directly as a workaround for broken gateway integration.
4. Provide one verified create/deploy/chat/resume/cancel agent recipe. Add an onboarding smoke test that records real pass/fail results.
5. Exercise encrypted backup/restore, upgrade/rollback, graceful drain and quota persistence. SQLite WAL alone does not prove multi-host HA; support one writer deployment until measured topology tests pass.

### Task 8 — Reliable free-only service

**Files:** existing router/quota suites; `scripts/production-free-baseline.py`; provider configuration (only after explicit review).

1. Preserve hard free-only constraints across direct selection, aliases, sticky sessions, cache, retries, streaming and hedging. Existing quota/budget fixes should be reused.
2. Maintain eligibility from credentials, provider health, capabilities, context and current quotas; distinguish free-priced models from a free account's finite shared allowance.
3. Test account-level exhaustion, concurrent admission, cooldown, bounded attempts/deadlines, correct Retry-After and recovery. Return actionable 429/503 rather than paid fallback.
4. Repeat deterministic live JSON/reasoning/coding/tools/context/stream samples at different quota states; record routed model, latency, usage and failures. Investigate model-quality failures using a larger sample, not weight changes tailored to one arithmetic question.
5. Company production uses either measured free capacity with explicit degraded-service expectations or an opt-in paid/local capacity policy. Never silently spend when the free pool is exhausted.[7]

## Final acceptance gates

- Every advertised feature has a deterministic regression plus a real staged integration test; skipped/mocked tests are labeled.
- Two companies cannot access each other's models/policies/sessions/tasks/artifacts/tool credentials or quota reservations.
- SDK conformance for every advertised MCP/A2A version.
- Inference and agent calls obey company budgets and free-only policies before dispatch, including concurrent requests.
- Restart, cancellation, backup/restore and overload behave as documented.
- Load/soak thresholds and an availability/latency SLO are agreed and measured; no invented performance numbers.
- Full relevant tests/typechecks/security checks pass; unsupported features are explicitly excluded rather than marked complete.

**Release decision now: HOLD.** The research and initial fixes are not a certificate that every feature works. The final execution report must state which slices are actually green and which blockers remain.

## Sources

[1] https://modelcontextprotocol.io/specification/latest/basic/transports
[2] https://modelcontextprotocol.io/specification/latest/basic/authorization
[3] https://a2a-protocol.org/v1.0.0/specification
[4] https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
[5] https://docs.litellm.ai/docs/proxy/virtual_keys
[6] https://docs.litellm.ai/docs/proxy/users
[7] https://openrouter.ai/docs/limits
