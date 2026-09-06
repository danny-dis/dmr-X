# DMR-X — Product & Architecture Canonical

**Status:** Canonical design document  
**Updated:** 2026-09-06

## 1. Product definition

DMR-X is an **independent AI execution platform** centered on three capabilities:

1. **Model Gateway** — one stable API for heterogeneous AI providers and modalities.
2. **Adaptive Model Router** — deterministic constraints plus learned performance intelligence to choose the best execution path for each request.
3. **Agent Runtime** — optional reusable infrastructure for running isolated, temporary or persistent agents that obtain inference through DMR-X.

DMR-X is useful without ATHENA, ARGUS, SMS, Ghost Factory, or any other project.

### Product promise

> Give any application, developer, coding agent, or agent platform one AI endpoint and let DMR-X determine the best model/provider/execution path for the requested quality, cost, latency, reliability, privacy, locality, and capability constraints.

The product should be evaluated as a **universal AI gateway/router/runtime**, not as a second sovereign orchestrator.

## 2. Architectural boundaries

### DMR-X owns

- AI request normalization.
- Model/provider discovery and registry.
- Capability matching.
- Routing policies and constraints.
- Cost/latency/quality/reliability optimization.
- Privacy-aware model selection and optional redaction/tokenization.
- Provider execution, retries and fallbacks.
- Routing telemetry and outcome attribution.
- Model/provider benchmarking and lifecycle intelligence.
- MCP access to DMR-X capabilities.
- A2A interoperability for independent agents.
- Optional agent execution through the Agent Runtime.

### DMR-X does not own

- Sovereign governance.
- Application-level business decisions.
- ATHENA's lattice.
- SMS/Sovereign Mind memory.
- ARGUS intelligence policy.
- Ghost Factory software-factory governance.

External systems can use DMR-X, but DMR-X must not acquire dependencies on them.

## 3. Core execution paths

### Plain inference

`Application / IDE / Coding Agent -> DMR-X Gateway -> Router -> Provider -> Response`

### Agent runtime

`Application / Agent -> DMR-X Runtime -> Agent sandbox -> DMR-X Gateway -> Model/Provider -> Result`

### External agent interoperability

`Agent A -> A2A -> DMR-X Agent Surface -> DMR-X Runtime/Gateway -> Result`

### Tool interoperability

`Agent -> MCP -> DMR-X MCP -> DMR-X capability/tool -> Result`

MCP and A2A are interfaces. They are not the DMR-X decision brain.

## 4. Universal routing model

Every request should become a structured **Request Requirement Vector** containing, where available:

- task family
- complexity estimate
- required capabilities
- modalities
- context size
- reasoning requirement
- tool/function-calling requirement
- structured-output requirement
- language requirements
- quality target
- latency target
- TTFT target
- budget/cost target
- privacy class
- data residency/locality
- provider trust constraints
- reliability target
- availability requirements
- streaming requirements
- user/application preference
- tenant policy

Every candidate model/provider should expose a corresponding **Capability & Execution Profile**:

- supported modalities
- context limits
- reasoning/coding/tool capabilities
- structured-output behavior
- pricing
- free-tier eligibility and remaining budget where known
- deployment location
- privacy/trust classification
- hardware requirements
- concurrency limits
- rate limits
- historical latency
- TTFT/tokens-per-second
- error/timeout/stream failure rates
- task-specific quality
- model/version lineage

Routing becomes constrained optimization rather than a single static score.

## 5. Routing pipeline

1. Authenticate and identify tenant/application/user.
2. Normalize wire format into DMR-X's internal request model.
3. Detect modality and extract requirements.
4. Classify task and estimate complexity.
5. Apply hard policy constraints.
6. Apply privacy/data-residency constraints.
7. Filter by capability compatibility.
8. Filter unavailable, unhealthy or budget-exhausted candidates.
9. Generate candidate set.
10. Score candidates against the active objective.
11. Select using deterministic policy plus learned routing intelligence.
12. Execute through provider adapter.
13. Stream/return normalized result in the requested wire format.
14. Record telemetry, actual cost and reliability outcome.
15. Evaluate outcome when an evaluator/feedback signal is available.
16. Attribute outcome to model/provider/task/context and update routing intelligence.

## 6. Routing objectives

DMR-X should support explicit objectives rather than one universal ranking:

- `best_quality`
- `best_quality_per_dollar`
- `lowest_cost`
- `lowest_latency`
- `highest_reliability`
- `local_only`
- `private_only`
- `free_first`
- `free_only`
- `balanced`
- custom weighted objective

Hard constraints always override optimization preferences.

## 7. Free and cheap inference

Free-tier routing is a first-class product capability, not a demo feature.

Users should be able to request:

- free only
- free preferred
- cheapest acceptable
- quality-per-dollar
- local/free before paid
- maximum monthly spend
- per-task spend ceiling

The router should understand provider/model free quotas where observable, distribute traffic across eligible free providers, respect rate limits, avoid thrashing exhausted providers, and fall back according to policy.

### Runtime cost optimization

An agent can be created with a runtime policy such as:

```text
objective: quality_per_dollar
budget: $0.00
fallback: paid_if_explicitly_allowed
model_policy: free_first
max_runtime: 10m
```

The runtime then requests inference through DMR-X. It does **not** implement a second model router.

This enables cheap delegated work for users of DMR-X, coding agents, applications and external agent systems.

## 8. Coding-agent integration

DMR-X must be designed as a drop-in AI backend for coding environments.

Target clients include:

- Claude Code
- Codex and compatible coding-agent clients
- OpenAI-compatible SDKs
- Anthropic-compatible SDKs
- Gemini-compatible clients
- custom IDE agents
- CI/CD agents
- autonomous software agents

The integration goal is minimal client modification: a user points the client at DMR-X and retains the client's normal request format while DMR-X performs routing.

Where a client cannot use a generic endpoint directly, provide documented adapters/configuration and CLI helpers rather than coupling DMR-X to the client internals.

## 9. Agent Runtime

The runtime is reusable execution infrastructure.

It should support:

- persistent agents
- ephemeral agents
- task-scoped agents
- subagents
- scheduled agents
- isolated workspaces
- isolated browser profiles
- scoped credentials
- network/egress policies
- CPU/RAM/GPU budgets
- timeouts and TTLs
- checkpoint/resume
- cancellation
- retries
- artifact production
- evaluation
- portable agent packages

### Ephemeral-agent contract

A temporary agent should have:

- immutable identity
- explicit parent/request provenance
- capability allowlist
- tool allowlist
- workspace
- credentials with minimum scope
- network policy
- model policy
- cost budget
- time budget
- termination policy
- audit trail

At TTL expiry or successful completion, its execution environment should be destroyed while required artifacts and audit records are retained according to policy.

## 10. Security boundary

The runtime can execute work; it cannot grant authorization that the calling application does not possess.

For an ecosystem such as ATHENA:

`ATHENA governance -> approved task -> DMR-X Runtime -> execution`

If governance rejects the underlying action, the runtime must not provide a bypass.

For an ordinary DMR-X user, the user's application/tenant policy is the authority.

## 11. Self-improving router

The long-term routing loop is:

`request -> requirements -> candidates -> route -> execute -> evaluate -> attribute -> learn -> improved route`

Learning must be scoped by context. A model that is excellent at code generation should not automatically receive a global quality boost for unrelated tasks.

Maintain performance profiles for combinations such as:

`model x provider x task_family x context_class x modality x policy_class`

Use exploration/exploitation controls so DMR-X can discover better routes without destabilizing production traffic.

## 12. Routing Decision Trace

Every route should be explainable to an authorized operator.

A trace should contain:

- normalized request ID
- tenant/application
- task classification
- inferred requirements
- hard constraints
- candidate set
- rejection reasons
- candidate scores
- selected route
- fallback plan
- provider/model version
- expected cost/latency
- actual cost/latency
- retry history
- privacy decision
- evaluation/outcome
- policy version

Do not expose secrets or sensitive prompt contents in traces by default.

## 13. Reliability architecture

Build for failure as a normal operating condition:

- per-provider circuit breakers
- bulkheads
- adaptive concurrency
- bounded retries
- retry budgets
- exponential backoff with jitter
- provider-specific timeout profiles
- streaming interruption recovery where safe
- hedged requests only when economically and semantically justified
- graceful degradation
- distributed rate limiting for multi-instance deployments
- durable queueing for eligible asynchronous work

## 14. Caching

Caching should be explicit and policy-aware.

Candidate layers:

- model metadata cache
- provider health cache
- tokenization cache
- embeddings cache
- deterministic response cache
- semantic response cache
- tool-result cache

Semantic response caching must enforce tenant, privacy, freshness, tool-state and authorization boundaries.

## 15. Model lifecycle

The model registry should become an intelligence system rather than a static catalog.

Lifecycle:

`discovered -> registered -> validated -> benchmarked -> eligible -> production -> monitored -> promoted/demoted -> quarantined/retired`

Model records should preserve version history and benchmark lineage.

## 16. Product surfaces

### Gateway
Stable APIs and streaming.

### CLI
Configuration, diagnostics, route preview, benchmarks, provider management and local development.

### Admin UI
Providers, models, policies, quotas, routing traces, benchmarks, runtime jobs, MCP servers, A2A tasks and billing.

### MCP
Expose DMR-X capabilities and optionally aggregate external tools.

### A2A
Expose DMR-X as an interoperable agent/service and accept delegated tasks from independent agents.

### Runtime
Create and execute agents under explicit resource and security policies.

## 17. Non-goals

DMR-X should not become:

- a replacement for ATHENA
- a global memory system
- a sovereign agent governance system
- a general-purpose personal assistant
- a software factory
- a universal business workflow engine

It can provide primitives those systems consume.

## 18. Definition of success

DMR-X is successful when a developer can install it, point existing AI clients at it, configure providers and policies, and immediately obtain better **cost, reliability, privacy, latency or quality** than manually choosing a single provider — while optionally using the same platform to run isolated agents and connect external agents/tools.
