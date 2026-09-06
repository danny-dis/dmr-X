# DMR-X Roadmap

## Product boundary

DMR-X is a fully independent, general-purpose AI **model router and gateway**.

It does not depend on ATHENA, ARGUS, SMS/Sovereign Mind, Ghost Factory, or any other project. Those systems may consume DMR-X through its public interfaces, but DMR-X remains independently deployable and useful on its own.

The core question DMR-X answers is:

> Given an AI request and its constraints, what model/provider should serve it, through which execution path, with the best quality, reliability, latency, cost, and privacy characteristics?

The MCP server, A2A surface, and Agent Runtime are supporting interfaces/runtime capabilities around that independent AI gateway. They must not turn DMR-X into an application-level sovereign orchestrator.

---

## 1. Model-routing intelligence — highest priority

### Current foundation

DMR-X already has a substantial routing pipeline including task classification, capability filtering, model resolution, provider preferences, health filtering, rate/quota controls, policy checks, cost/latency scoring, Thompson Sampling, and fallback behavior.

### Target improvements

- Build a **first-class capability ontology** for models and modalities.
- Represent each request as a structured requirement vector: task type, complexity, capabilities, modality, context size, reasoning level, structured-output/tool-use requirements, latency, budget, privacy, locality, and reliability constraints.
- Match requests against model capabilities rather than relying primarily on model/provider metadata.
- Add a declarative **routing policy language** for deterministic customer/application policies.
- Make routing decisions **explainable**: selected candidate, scores, constraints, rejected candidates, and fallback reasoning.
- Add task/model/provider-specific reliability distributions rather than binary provider health.
- Track TTFT, tokens/sec, total latency, stream failure, retry behavior, and timeout distributions.
- Support multi-objective routing: quality, quality/$, latency, reliability, privacy, locality, or custom weighted objectives.

## 2. Closed-loop learning

Create the complete feedback loop:

`request -> classify -> route -> execute -> evaluate -> attribute outcome -> update routing intelligence -> route better`

Required capabilities:

- outcome evaluation
- correctness/completeness scoring
- structured-output validity
- tool-use correctness
- user/application feedback
- model/provider/task attribution
- contextual bandits beyond a single global reward
- per-task-family performance profiles
- automatic promotion/demotion of routing candidates
- regression detection
- exploration/exploitation controls

Thompson Sampling remains a useful selector, but it should become one component of a broader learned routing system rather than the whole learning layer.

## 3. Privacy-aware routing

Make privacy a first-class routing constraint, not merely a generic middleware feature.

- Classify data/request sensitivity.
- Support fail-closed local/private-only routing.
- Support PII detection, reversible tokenization/redaction, and controlled reconstruction where explicitly configured.
- Track provider deployment/trust characteristics.
- Prevent privacy constraints from being bypassed by direct-selection shortcuts or fallback paths.
- Make privacy decisions visible in routing explanations and audit logs.

## 4. Model/provider lifecycle intelligence

DMR-X should be able to continuously understand its available model universe.

- Discover/register models and providers.
- Maintain versioned model metadata and capabilities.
- Track context limits, modalities, pricing, deployment type, hardware requirements, and availability.
- Benchmark new models automatically.
- Run task-specific tournaments.
- Maintain rankings by task/capability rather than one global leaderboard.
- Automatically introduce, quarantine, promote, or demote candidates based on evidence.

## 5. MCP — current role and roadmap

DMR-X already exposes its AI capabilities through an MCP server and supports stdio, SSE, and Streamable HTTP transports. It can also aggregate external MCP servers and re-expose their tools, with tool search, RBAC, guardrails, templates/presets, audit controls, and tool invocation policy support.

### MCP improvements

1. **Make MCP tool semantics explicit**
   - Correct read-only/destructive/idempotent/open-world annotations.
   - Stable schemas and versioned tool contracts.
   - Explicit timeout, retry, and side-effect metadata.

2. **Tool discovery and selection**
   - Capability-aware semantic discovery.
   - Search tools by task requirements, not just name/description.
   - Rank tools using reliability, latency, cost, trust, and historical success.
   - Avoid loading hundreds of tool definitions into model context unnecessarily.

3. **Tool execution safety**
   - Per-client/tenant tool permissions.
   - Strong input/output schema validation.
   - Side-effect classification and confirmation requirements.
   - SSRF/egress controls for remote MCP endpoints.
   - Secret isolation and credential scoping.
   - Better prompt-injection defenses around tool results.

4. **MCP gateway quality**
   - Connection health and circuit breakers for upstream MCP servers.
   - Per-server quotas and concurrency limits.
   - Automatic reconnection with bounded backoff.
   - Version/capability negotiation.
   - Better upstream error normalization.
   - Observability per MCP server/tool/call.

5. **MCP federation/aggregation**
   - Keep external MCP aggregation optional.
   - Namespace collisions must be deterministic.
   - Preserve provenance: source server, tool version, and call chain.
   - Support graceful degradation when an upstream MCP server disappears.

The principle is: **MCP is an interface into DMR-X's capabilities and an optional gateway to external tools; it is not DMR-X's internal orchestration brain.**

## 6. A2A — current role and roadmap

DMR-X already has A2A Agent Card generation/validation, supported interfaces, skills, task management, persistence, streaming/push-related support, JSON-RPC dispatch, cancellation, multi-turn context handling, and gateway dispatch.

### Current strengths

- Agent Cards advertise capabilities and skills.
- The A2A endpoint is separated from the server root.
- Task states and terminal-state behavior are guarded.
- Tasks are persisted and bounded.
- Multi-turn context is reconstructed.
- Dispatch has timeouts and failure mapping.
- Late results cannot resurrect canceled/terminal tasks.

### A2A improvements

1. **Treat A2A as an interoperability protocol, not an internal scheduler.**
   DMR-X should expose an AI gateway/agent capability to external agents while remaining independent of ATHENA/ARGUS.

2. **Complete protocol conformance testing.**
   - Test current A2A versions and interoperability against independent clients/servers.
   - Validate Agent Cards against the exact supported specification version.
   - Test JSON-RPC error semantics, task lifecycle, streaming, push notifications, artifacts, auth, and cancellation.

3. **Durable distributed task state.**
   - Current task management has persistence, but live coordination is still process-local in important places.
   - Add safe multi-instance ownership/locking or a durable coordination mechanism when horizontally scaling.
   - Prevent duplicate dispatch after failover.

4. **Idempotency and delivery guarantees.**
   - Request/task idempotency keys.
   - Duplicate message detection.
   - Explicit at-least-once/exactly-once semantics where applicable.
   - Replay-safe dispatch.

5. **Authentication and authorization.**
   - Strong per-agent identity.
   - OAuth/mTLS/API-key options as appropriate.
   - Agent-to-agent authorization policies.
   - Capability-scoped permissions.
   - Signed Agent Cards where required.

6. **Artifact handling.**
   - Large artifacts should not live directly in task payloads.
   - Content-addressed storage/object references.
   - Integrity hashes.
   - MIME/type/size validation.
   - Expiration and access control.

7. **Observability.**
   - Trace an A2A task from inbound agent -> DMR-X routing -> provider -> response.
   - Expose task latency, retries, routing decision, provider/model, and final outcome.

## 7. Agent Runtime — current role and roadmap

The Agent Runtime is a reusable execution environment for specialized agents. It is intentionally independent of ATHENA and ARGUS: either system can consume the same runtime without becoming the owner of the other system's agents.

The current runtime already includes agent execution, scheduling, persistent sessions, agentic sessions, skill loading, transcript-based skill capture, subagent delegation, data-access auditing, jobs, job boards, dependency scheduling/planning, job orchestration, and a Receptionist workflow for matching/assigning agents.

### Improvements

1. **Separate reusable runtime from sovereign orchestration.**
   Keep the runtime responsible for executing an agent, managing its session, skills, tools, lifecycle, and local job state. Do not make ATHENA-specific governance assumptions part of the runtime.

2. **Agent lifecycle manager.**
   Formal lifecycle:
   `registered -> provisioned -> ready -> running -> paused -> draining -> stopped -> retired`

3. **Stronger isolation.**
   - Per-agent filesystem/workspace boundaries.
   - Process/container/microVM isolation options.
   - Browser-profile isolation.
   - Credential isolation.
   - Network/egress policy.
   - Resource limits.

4. **Resource controls.**
   - CPU/RAM/GPU limits.
   - Concurrency.
   - Per-agent budgets.
   - Timeouts.
   - Backpressure.
   - Fair scheduling.

5. **Durability and recovery.**
   - Checkpoint running sessions.
   - Resume after process/node failure.
   - Explicit retry semantics.
   - Lease/heartbeat model for distributed workers.

6. **Skills as versioned capabilities.**
   - Skill manifests.
   - Versioning and compatibility.
   - Dependency graph.
   - Trust/signing.
   - Automated regression testing for captured skills.
   - Safe promotion from discovered skill -> validated skill.

7. **Agent evaluation.**
   Every runtime execution should be measurable for success, quality, cost, latency, tool efficiency, and failure reason.

8. **Agent package portability.**
   A specialized agent should be exportable/importable as a portable definition containing its identity, skills, required capabilities, tools, policies, resource requirements, and runtime constraints.

9. **Runtime vs model routing boundary.**
   The runtime requests model inference from DMR-X; it should not duplicate the model/provider routing system. DMR-X remains the independent model gateway.

## 8. Semantic cache and performance

- Add safe semantic caching for eligible requests.
- Cache embeddings/reranking/model metadata where useful.
- Cache only within explicit tenant/privacy boundaries.
- Support freshness/TTL and invalidation policies.
- Optimize TTFT and streaming paths.

## 9. Security and trust

- Credential vault/rotation for provider keys.
- Strong tenant isolation.
- Request signing where appropriate.
- Data-loss prevention controls.
- Egress policies.
- Prompt-injection and tool-result isolation.
- Immutable/security-grade audit trails.
- Provider/model trust scoring.
- Supply-chain verification for adapters/plugins.

## 10. Reliability and scale

- Circuit breakers.
- Bulkheads.
- Adaptive concurrency.
- Queue/backpressure controls.
- Per-provider connection pools.
- Distributed rate limiting for multi-instance deployments.
- Graceful degradation.
- Chaos/failure testing.
- Load testing with realistic streaming workloads.
- Horizontal scaling without routing-state inconsistencies.

## 11. Explainability and operator experience

Every important routing decision should be inspectable:

- request classification
- required capabilities
- constraints
- candidates considered
- candidates rejected and why
- scores
- selected model/provider
- fallback path
- actual latency/cost
- outcome/evaluation

The UI should expose this as a **Routing Decision Trace**, not merely a final model name.

---

## Architectural rule

DMR-X should become exceptional at **AI execution selection and delivery**, not become ATHENA.

The stable boundary is:

`Application/Agent -> DMR-X -> optimal model/provider -> response`

and, when using the runtime:

`Application -> DMR-X Agent Runtime -> DMR-X model gateway -> model/provider`

ATHENA, ARGUS, Ghost Factory, and unrelated third-party applications can all consume these interfaces independently.

No dependency on SMS is required or assumed.

---

## Priority order

### P0 — Routing intelligence
1. Capability-aware routing
2. Routing policy language
3. Explainable routing traces
4. Privacy-aware routing
5. Provider/model reliability intelligence

### P1 — Self-improving router
6. Outcome evaluation
7. Attribution
8. Task-specific learning
9. Automated tournaments
10. Automatic candidate promotion/demotion

### P1 — MCP/A2A production hardening
11. MCP tool semantics/security/health
12. A2A conformance/interoperability suite
13. Durable distributed A2A state
14. Idempotency and delivery guarantees

### P1 — Agent Runtime hardening
15. Lifecycle manager
16. Isolation/resource controls
17. Durable recovery
18. Versioned skill system
19. Agent evaluation and portability

### P2 — Platform optimization
20. Semantic caching
21. Advanced streaming intelligence
22. Model lifecycle automation
23. Federation
24. Chaos/load testing

This roadmap deliberately keeps DMR-X independent while allowing it to serve as a common AI gateway/runtime capability for many unrelated systems.
