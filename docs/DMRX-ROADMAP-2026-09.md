# DMR-X Build Roadmap — September 2026

This is the execution roadmap derived from the current implementation, architecture review and September 2026 ecosystem research.

## Product north star

Make DMR-X the best **independent AI execution layer** for applications, developers, coding agents and agent ecosystems:

- one gateway;
- intelligent model/provider selection;
- explicit cost/privacy/latency/quality controls;
- free/cheap inference optimization;
- optional isolated agent execution;
- standards-first MCP/A2A;
- local-first/self-hosted operation.

## P0 — Routing correctness and differentiation

### 1. Capability ontology

Build a normalized ontology for:

- reasoning
- coding
- mathematics
- research
- tool use
- structured output
- long context
- vision
- audio
- video
- embeddings
- reranking
- speech
- multilingual capability
- agentic behavior

**Acceptance:** a route can explain which required capabilities matched the selected model.

### 2. Request Requirement Vector

Convert each request into structured requirements and hard constraints.

**Acceptance:** route preview returns a machine-readable requirement vector and constraint set.

### 3. Declarative routing policy engine

Support deterministic policy rules for tenant/application/user/task.

Examples:

```text
privacy == sensitive -> local_only
budget == 0 -> free_only
latency < 500ms -> latency_optimized
quality >= high -> quality_optimized
coding && complexity >= high -> coding_specialist
```

**Acceptance:** hard constraints cannot be bypassed by fallback or direct model selection.

### 4. Routing Decision Trace

Persist a compact explainable trace for each route.

### 5. Reliability intelligence

Replace binary health with distributions for:

- TTFT
- total latency
- tokens/sec
- timeout rate
- HTTP failure rate
- rate-limit rate
- stream interruption
- task-specific success

### 6. Privacy/PII routing

Build first-class:

- sensitivity classification;
- local/private-only constraints;
- reversible tokenization/redaction;
- controlled reconstruction;
- provider trust classification;
- egress policy;
- fail-closed behavior.

## P0 — Inference economics

### 7. Cost engine

Implement:

- exact/estimated cost;
- budget reservation;
- concurrent spend protection;
- per-request/per-agent/per-tenant caps;
- budget reconciliation;
- spend forecasting.

### 8. Free-tier allocator

Implement:

- free-only routing;
- free-first routing;
- quota-aware provider selection;
- free-provider load balancing;
- exhaustion prediction;
- rate-limit avoidance;
- paid fallback only when policy permits.

### 9. Quality-per-dollar routing

Make `quality_per_dollar` a first-class objective using task-specific quality evidence rather than a static model intelligence rank.

### 10. Coding-agent integration pack

Document and test DMR-X as a backend for:

- Claude Code;
- Codex-compatible clients;
- OpenAI-compatible clients;
- Anthropic-compatible clients;
- Gemini-compatible clients;
- IDE agents;
- CI agents.

The integration must not require DMR-X to own or understand the client's orchestration logic.

## P1 — Self-improving routing

### 11. Outcome evaluation

HTTP success is not task success.

Add evaluators for:

- correctness
- completeness
- structured-output validity
- tool correctness
- test results
- user feedback
- application-defined success

### 12. Outcome attribution

Attribute performance to:

`model + provider + version + task + context + modality + policy`

### 13. Contextual routing learning

Move beyond a single global Thompson Sampling score.

Use contextual bandits/learned ranking where justified, with explicit exploration budgets and regression protection.

### 14. Model tournaments

Run repeatable task suites and maintain rankings by capability/task family.

### 15. Automatic promotion/demotion

Models/providers move through:

`discovered -> validated -> benchmarked -> eligible -> production -> degraded -> quarantined -> retired`

Promotion must require evidence; demotion must have rollback protection.

## P1 — Agent Runtime

### 16. Formal lifecycle

Implement registered/provisioned/ready/running/paused/draining/stopped/retired states.

### 17. Ephemeral agents

Support temporary agents with:

- TTL;
- isolated workspace;
- scoped credentials;
- tool allowlist;
- network policy;
- model policy;
- cost budget;
- resource budget;
- automatic destruction.

### 18. Strong isolation

Add container and microVM backends in addition to the existing lightweight process/workspace isolation.

### 19. Durable execution

Add checkpointing, leases, heartbeats, idempotency, resume and cancellation.

### 20. Resource-aware scheduling

Schedule on CPU/RAM/GPU/browser/provider concurrency and monetary budget, not merely task readiness.

### 21. Skill promotion pipeline

Auto-captured skills must be tested before production use.

`captured -> candidate -> regression tested -> approved -> production`

### 22. Portable agents

Export/import agent packages without secrets.

## P1 — MCP 2026

### 23. Current MCP conformance

Target the 2026-07-28 specification and test stateless remote operation, discovery, authorization, cache hints, Tasks and extensions where implemented.

### 24. Capability-aware tool discovery

Do not expose all tools by default. Search/rank by task capability, reliability, latency, cost, trust and policy.

### 25. Tool security

Add tool identity, provenance, side-effect metadata, credential isolation, SSRF controls, input/output validation and prompt-injection isolation.

### 26. MCP gateway reliability

Circuit breakers, reconnect, quotas, concurrency, timeouts and per-tool health.

## P1 — A2A v1.x

### 27. Conformance

Validate Agent Cards, task lifecycle, streaming, artifacts, auth, cancellation and errors against current A2A v1.x.

### 28. Distributed task ownership

Use leases/heartbeats/atomic claims to prevent duplicate execution across DMR-X instances.

### 29. Idempotency and replay safety

Persist request/task idempotency and reject unsafe duplicates.

### 30. Artifact subsystem

Content-addressed artifact storage with hashes, MIME/type checks, access control and expiration.

## P2 — Performance and scale

### 31. Semantic cache

Tenant/privacy/freshness-aware caching.

### 32. Streaming optimization

Measure and optimize TTFT, tokens/sec, connection reuse, stream recovery and backpressure.

### 33. Adaptive concurrency

Automatically adjust provider concurrency from latency/error/rate-limit feedback.

### 34. Distributed deployment

Keep routing state, budgets, provider health and runtime ownership consistent across replicas.

### 35. Chaos and load testing

Test:

- provider outage;
- partial stream failure;
- rate-limit storms;
- free-tier exhaustion;
- model removal;
- worker failure;
- network partitions;
- duplicate A2A delivery;
- MCP upstream failure;
- large agent fleets.

## P2 — Model/provider lifecycle automation

### 36. Discovery

Discover provider/model metadata from configured sources and local deployments.

### 37. Benchmark automation

Automatically benchmark newly discovered models on relevant task suites.

### 38. Deployment-aware selection

Track locality, hardware, quantization, context limits and deployment trust.

### 39. Candidate quarantine

A new/changed model must not immediately become eligible for high-impact traffic.

## P3 — Federation

Federate independent DMR-X instances without turning federation into a shared sovereign memory system.

Use cases:

- home DMR-X + cloud DMR-X;
- team instances;
- regional inference;
- disaster recovery;
- workload spillover.

## What not to build

Do not add:

- ATHENA lattice logic;
- SMS dependency;
- sovereign memory ownership;
- application-specific governance;
- a second model router inside Agent Runtime;
- proprietary replacements for MCP/A2A where standards already solve the problem.

## Release gates

### Gateway production gate

- routing policy tests;
- privacy fail-closed tests;
- budget reservation tests;
- provider outage tests;
- route-trace correctness;
- streaming tests;
- multi-tenant isolation tests.

### Runtime production gate

- isolation tests;
- lifecycle tests;
- cancellation tests;
- checkpoint/resume tests;
- resource enforcement tests;
- ephemeral-agent destruction tests;
- secret leakage tests.

### MCP production gate

- current-spec conformance;
- authorization tests;
- tool injection tests;
- upstream failure tests;
- provenance tests.

### A2A production gate

- v1.x conformance;
- idempotency tests;
- task ownership/failover tests;
- artifact integrity tests;
- authentication tests.

## Final architecture rule

`DMR-X = Gateway + Adaptive Router + Optional Agent Runtime + Standards Interfaces`

It is independent infrastructure that other systems can consume.
