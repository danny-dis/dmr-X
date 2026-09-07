# DMR-X Gateway Implementation & Hardening Plan

**Status:** Canonical implementation plan
**Date:** 2026-09-06
**Scope:** `apps/gateway`

## 1. Objective

Turn the existing DMR-X gateway into a production-grade, low-latency AI data plane without replacing its existing capabilities.

The gateway should be boring on the hot path and powerful around it:

```text
Client
  ↓
Transport/API compatibility
  ↓
Authentication + authorization
  ↓
Request normalization
  ↓
Policy/admission
  ↓
Deterministic routing
  ↓
Capacity reservation
  ↓
Provider execution
  ↓
Streaming/response
  ↓
Telemetry + outcome
```

Expensive control-plane work must not block the request path.

## 2. Current-state assessment

The gateway is already substantial. It has a dedicated server, adapter initialization, middleware, security headers, health endpoints, telemetry hooks, OAuth refresh, utilities, converters, services and a broad route surface. Existing routes include OpenAI-style chat, Anthropic compatibility, agents, agent dispatch, agentic APIs, A2A proxying, audio, administration and routing/bandit functionality.

The main architectural risks are not lack of capability but excessive responsibility and file concentration. Large route/server modules should be decomposed around stable interfaces and domain services.

Do **not** rebuild the gateway. Refactor around the existing contracts and preserve compatibility.

## 3. Target architecture

Separate the gateway into two planes.

### Data plane

Must remain synchronous, deterministic and fast:

- HTTP/SSE transport
- authentication
- authorization
- request validation
- normalization
- request identity
- policy evaluation
- admission
- routing decision consumption
- quota reservation
- provider execution
- streaming
- cancellation
- response conversion
- minimal telemetry emission

### Control plane

Runs asynchronously or out of process:

- provider/model discovery
- rate catalog refresh
- benchmark jobs
- routing model training
- provider health analysis
- quota learning
- analytics
- configuration management
- admin operations
- experimentation

The data plane consumes immutable/versioned snapshots from the control plane.

## 4. P0 — Request lifecycle contract

Define one canonical internal request envelope regardless of API protocol.

```ts
interface DmrxRequest {
  requestId: string
  traceId: string
  tenantId?: string
  principalId?: string
  protocol: 'openai' | 'anthropic' | 'a2a' | 'dmrx'
  operation: string
  messages?: Message[]
  modelIntent?: ModelIntent
  capabilities: CapabilityRequirement[]
  policy: InferencePolicy
  stream: boolean
  tokenBudget: TokenBudget
  metadata: Record<string, unknown>
  deadlineAt?: number
}
```

Every provider attempt receives an immutable attempt record:

```text
request_id
attempt_id
route_id
reservation_id
provider_attempt_id
```

This makes retries and fallbacks reconstructable.

## 5. P0 — Gateway hot path

The hot path should become:

```text
parse → authenticate → authorize → normalize → validate
→ deadline → policy → admission → route snapshot
→ reserve → execute → stream → reconcile → emit outcome
```

No synchronous benchmark calls, provider discovery, large catalog queries, analytics aggregation or LLM reasoning.

Cache frequently used immutable data in memory and update it atomically by snapshot replacement.

## 6. P0 — Provider execution interface

Create a strict executor contract:

```ts
interface ProviderExecutor {
  execute(ctx: ExecutionContext): Promise<ProviderResult>
  stream(ctx: ExecutionContext): AsyncIterable<ProviderChunk>
  cancel?(ctx: CancellationContext): Promise<void>
}
```

Provider adapters own protocol differences. The gateway owns lifecycle semantics.

Normalize provider outcomes into typed categories:

- success
- invalid_request
- authentication_failure
- authorization_failure
- capability_mismatch
- quota_exhausted
- rate_limited
- overloaded
- timeout
- transport_failure
- provider_error
- stream_failure
- cancelled

Do not use HTTP status alone to make routing decisions.

## 7. P0 — Streaming as a first-class subsystem

Implement:

- TTFT measurement
- chunk timestamps
- backpressure
- client disconnect propagation
- upstream cancellation
- stream deadline
- partial-output tracking
- usage reconciliation
- quota reconciliation
- stream failure classification
- safe fallback rules

Never automatically restart a generation after partial output unless the protocol/request explicitly supports safe continuation.

## 8. P0 — Free-only economic safety

Integrate the Free Inference Control Plane.

`free_only` must be a hard constraint:

```text
candidate.pricingPolicy allows zero-cost
AND
candidate.freeEligibility is valid
AND
capacity reservation succeeds
```

A generic upstream router must never be allowed to silently turn `free_only` into paid execution.

`free_first` is different and requires explicit paid-fallback configuration.

## 9. P0 — Capacity reservation before execution

The gateway must ask the quota subsystem for a reservation before sending the provider request.

Reservation contains:

- provider
- account/project/key scope
- model
- estimated input tokens
- reserved output tokens
- concurrency slot
- relevant request-window units
- expiry/lease

After execution:

- reconcile actual usage;
- release unused output reservation;
- record observed headers;
- update provider state.

This prevents concurrent requests from stampeding the same free bucket.

## 10. P0 — Deadline and cancellation propagation

Every request gets an absolute deadline.

The deadline propagates through:

```text
client → gateway → scheduler → provider adapter → HTTP client → stream
```

Cancellation must release quota reservations and concurrency slots.

Never leave orphaned reservations after client disconnects.

## 11. P0 — Retry and fallback engine

Create a central retry policy instead of provider-specific ad-hoc retry behavior.

Rules:

- honor Retry-After;
- classify rate limits by dimension where possible;
- don't retry deterministic invalid requests;
- don't repeatedly retry an exhausted free provider;
- enforce attempt budgets;
- account for request deadline;
- prefer a newly selected eligible provider after a quota failure;
- preserve idempotency;
- distinguish pre-response and post-stream failures.

The retry engine consumes typed failure signals from provider adapters and updates the scheduler state.

## 12. P0 — Authentication/authorization boundary

Separate:

- identity
- tenant
- principal
- roles
- capabilities
- provider credentials
- request policy

Provider secrets must never appear in logs, telemetry, errors or client-visible responses.

Admin routes require explicit administrative authorization and should not share implicit privileges with inference routes.

## 13. P0 — Security hardening

Perform a gateway-specific security review covering:

- SSRF
- request smuggling
- header injection
- oversized bodies
- decompression bombs
- malicious streaming clients
- prompt/request metadata leakage
- provider credential leakage
- admin endpoint exposure
- CORS
- CSRF where browser credentials are involved
- WebSocket/SSE abuse
- path traversal
- URL allowlisting
- DNS rebinding
- internal-network access
- tenant isolation

Maintain strict outbound provider allowlists and prevent user-controlled URLs from reaching arbitrary internal services.

## 14. P1 — Route decomposition

Large route files should be split by responsibility, not merely by line count.

Recommended layers:

```text
routes/
  protocol/
  inference/
  agents/
  admin/
  compatibility/

application/
  inference-service
  agent-service
  routing-service
  health-service

transport/
  http
  sse
  error-mapper

execution/
  provider-executor
  stream-executor
  cancellation

policy/
  authz
  inference-policy
  capability-policy

admission/
  quota
  reservations
  concurrency
```

Routes should mostly parse input, invoke an application service and map the response.

## 15. P1 — Protocol compatibility

Treat protocol compatibility as an explicit product boundary.

Maintain golden compatibility tests for:

- OpenAI chat completions
- OpenAI responses where supported
- Anthropic messages
- streaming/SSE
- tool calls
- structured output
- multimodal requests
- usage reporting
- errors
- model listing

Do not let provider-specific behavior leak into protocol responses.

## 16. P1 — Observability

Every request should produce structured lifecycle events:

```text
request.accepted
request.normalized
policy.evaluated
route.selected
reservation.created
provider.started
provider.first_token
provider.completed
provider.failed
fallback.started
reservation.reconciled
request.completed
```

Track:

- p50/p95/p99 gateway overhead
- TTFT
- completion latency
- provider latency
- queue/admission delay
- route-selection latency
- reservation latency
- error classes
- retries
- fallback rate
- stream interruption rate
- cancellation rate
- free/paid selection
- paid leakage

The gateway's own overhead should be measurable independently from provider latency.

## 17. P1 — Performance architecture

Target a negligible gateway overhead relative to provider latency.

Rules:

- avoid blocking CPU work on the event loop;
- avoid synchronous disk access on hot paths;
- reuse HTTP/TLS connections;
- configure connection pools per provider;
- use keep-alive;
- bound concurrent outbound connections;
- avoid repeated JSON transformations;
- avoid repeated tokenization when cached metadata is available;
- use immutable snapshots for routing/catalog state;
- sample high-volume traces while retaining complete error traces;
- stream without buffering entire generations.

Benchmark gateway-only latency separately from end-to-end inference latency.

## 18. P1 — Provider connection management

Implement a common outbound transport layer with:

- connection pooling
- keep-alive
- per-provider connection limits
- DNS/cache policy
- timeouts for connect/header/body
- TLS configuration
- proxy support where configured
- circuit breakers
- provider bulkheads
- cancellation

Do not let one degraded provider consume all gateway sockets or event-loop resources.

## 19. P1 — Multi-instance correctness

The gateway must work correctly when multiple instances share traffic.

Shared state required for correctness:

- reservations
- idempotency
- distributed concurrency limits
- provider cooldowns
- tenant quotas

Local state may be used for:

- read-only routing snapshots
- prediction caches
- metrics aggregation
- short-lived performance hints

Use SQLite for local/single-node deployments and provide a shared Redis/Valkey-backed implementation for distributed deployments.

## 20. P1 — Backpressure

Backpressure must exist at several levels:

```text
client
 ↓
gateway admission
 ↓
provider/model bulkhead
 ↓
connection pool
 ↓
provider
```

When capacity disappears, reject or defer early instead of accepting unlimited work and timing out later.

Expose machine-readable overload responses and retry hints.

## 21. P1 — Idempotency

Support request idempotency where semantics permit.

Idempotency records should distinguish:

- request accepted
- provider started
- provider completed
- provider partially streamed
- final response committed

Never replay an unsafe generation merely because the transport failed.

## 22. P1 — Health model

Replace simplistic up/down health with:

```text
healthy
congested
degraded
cooling_down
unavailable
probing
```

Health should be provider/model/key scoped.

Health signals include latency, 429s, 5xx, transport failures, stream failures and quota exhaustion.

## 23. P1 — Control-plane snapshots

The gateway should consume versioned snapshots containing:

- model catalog
- provider catalog
- free eligibility
- pricing
- capabilities
- rate policies
- routing weights
- provider health
- learned performance

Snapshot updates must be atomic. A request should never observe half of one configuration and half of another.

## 24. P1 — Error contract

Create a stable DMR-X error envelope containing:

```text
error.code
error.type
error.message
request_id
retryable
retry_after
provider_agnostic metadata
```

Never expose provider secrets or unnecessary upstream internals.

Map internal errors to OpenAI/Anthropic/A2A-compatible responses at the protocol boundary.

## 25. P2 — Advanced routing acceleration

Once the deterministic scheduler is stable:

- contextual provider scoring
- learned success probability
- learned latency prediction
- quota scarcity prediction
- time-of-day patterns
- task/model affinity
- bounded exploration

The LLM must not be required for ordinary routing.

## 26. P2 — Edge/local deployment modes

Support three operating profiles:

### Local

Single process/node, SQLite, local provider keys.

### Self-hosted cluster

Multiple gateway instances, shared Redis/Valkey, centralized telemetry/control plane.

### Managed/large deployment

Stateless gateways behind a load balancer, shared distributed admission, independently scalable control plane and provider execution pools.

The same request contract must work in all three.

## 27. Testing strategy

### Unit tests

- normalization
- policy
- authz
- error classification
- retry policy
- quota reservations
- cancellation
- stream lifecycle
- protocol conversion

### Integration tests

- each provider adapter
- headers and quota parsing
- OpenAI compatibility
- Anthropic compatibility
- streaming
- fallback
- Redis/Valkey distributed reservation

### Contract tests

Provider behavior snapshots should detect API changes.

### Load tests

Measure:

- 1, 10, 100, 1k, 10k concurrent requests
- mixed streaming/non-streaming
- many small vs few large requests
- provider outage
- provider 429 storm
- Redis latency
- gateway restart

### Chaos tests

Inject:

- 429
- 403
- 500
- timeout
- DNS failure
- connection reset
- mid-stream disconnect
- stale quota data
- control-plane outage
- shared-state outage

## 28. Acceptance criteria

The gateway work is complete when:

1. Existing public API contracts remain compatible.
2. Gateway overhead is measured independently and remains low under load.
3. Free-only requests cannot select paid routes.
4. Quota is reserved before provider execution.
5. Concurrent gateways cannot stampede a shared free quota bucket.
6. Retry-After is respected.
7. Rate-limit failures update the correct provider/model/key state.
8. Provider failures trigger typed fallback rather than blind retries.
9. Streaming cancellation releases resources promptly.
10. Partial streams are never silently duplicated.
11. Provider credentials cannot appear in client-visible data or telemetry.
12. One provider cannot exhaust global gateway resources.
13. Control-plane failure does not unnecessarily take down the data plane when a valid snapshot exists.
14. Gateway restart does not corrupt durable quota/reservation state.
15. Protocol compatibility has automated golden tests.
16. Load and chaos tests demonstrate predictable degradation.

## 29. Implementation order

### Phase A — Safety and contracts

- request envelope
- attempt identity
- error taxonomy
- deadlines/cancellation
- auth boundary
- provider executor interface

### Phase B — Reliability

- reservation integration
- retry/fallback engine
- streaming lifecycle
- provider bulkheads
- connection management
- backpressure

### Phase C — Performance

- route decomposition
- hot-path snapshots
- connection pooling
- benchmark gateway overhead
- eliminate blocking work

### Phase D — Distributed gateway

- Redis/Valkey reservations
- idempotency
- shared cooldowns
- multi-instance tests

### Phase E — Intelligence

- learned provider reliability
- contextual routing
- quota prediction
- bounded exploration

### Phase F — Certification

- compatibility suite
- load suite
- chaos suite
- security review
- free-only economic audit

## 30. Definition of done

DMR-X's gateway should become a **thin, deterministic, protocol-compatible AI data plane**. It should not need to know how to reason about a task or how to manually manage every provider. Its job is to safely move a request from client to the best currently admissible execution path and return the result with minimal overhead.

The gateway is therefore considered complete before moving to the Agent Runtime when:

```text
API compatibility       ✓
security boundary       ✓
streaming               ✓
quotas/reservations      ✓
retry/fallback           ✓
backpressure             ✓
distributed correctness   ✓
observability            ✓
load/chaos testing       ✓
free-only guarantee      ✓
```

Only then should DMR-X move its implementation focus to the Agent Runtime.
