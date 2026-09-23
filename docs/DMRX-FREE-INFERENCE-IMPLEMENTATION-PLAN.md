# DMR-X Free Inference Implementation Plan

**Status:** Implementation blueprint
**Date:** 2026-09-06
**Target:** Production-grade `free_only` / `free_first` inference across heterogeneous providers

## 0. Objective

Turn DMR-X's existing router, quota, adapters, fallback and telemetry into a single adaptive free-inference control plane.

The implementation is successful when an application can send one OpenAI-compatible request to DMR-X and DMR-X handles provider selection, quota admission, pacing, retries, failover, streaming safety and continuous learning without provider-specific application code.

The product promise is:

> **Free inference should feel like one reliable pool even though the underlying providers are not reliable, uniform or static.**

## 1. Non-negotiable invariants

1. `free_only` can never select a paid route.
2. Unknown/stale free capacity is never interpreted as unlimited capacity.
3. Provider limits are modeled at their real scope: account, project, organization, key, model, endpoint or upstream.
4. Admission reserves capacity before dispatch.
5. A 429 updates the correct quota dimension and does not automatically blacklist unrelated models.
6. `Retry-After` is honored.
7. Retries are bounded and budgeted.
8. Multiple gateway replicas cannot stampede the same capacity bucket.
9. Actual usage reconciles reservations.
10. Streaming is never blindly replayed after partial output.
11. Provider catalog data has provenance and freshness.
12. Observed behavior can override optimistic published assumptions, but cannot silently manufacture a larger paid/free entitlement.
13. Provider terms and anti-abuse controls are respected; legitimate credentials may be pooled, but DMR-X must not evade quotas through identity abuse.

## 2. Implementation phases

### Phase 1 — Establish the canonical quota domain

**Deliverables**

- Replace scalar quota assumptions with dimensioned `QuotaDimension` records.
- Add explicit scope: `account | organization | project | key | model | endpoint | upstream`.
- Add replenishment model: `fixed_window | sliding_window | token_bucket | unknown`.
- Add quota state: `available | exhausted | unknown | stale | probing | cooling_down`.
- Add confidence and observation timestamps.
- Add reset timestamps per dimension.
- Preserve compatibility with current SQLite schema during migration.

**Tests**

- Multiple simultaneous dimensions.
- Different scopes on the same provider.
- Unknown and stale states.
- Clock skew.
- Fixed-window versus token-bucket calculations.

### Phase 2 — Build the capacity reservation engine

**Deliverables**

Create a `CapacityManager` between candidate selection and provider execution.

Flow:

```text
candidate
  → estimate demand
  → validate every quota dimension
  → atomic reservation
  → dispatch
  → reconcile actual usage
  → release unused reservation
```

Reservation object:

```ts
interface CapacityReservation {
  id: string;
  candidateId: string;
  dimensions: ReservationDimension[];
  expiresAt: number;
  status: 'reserved' | 'committed' | 'released' | 'expired';
}
```

Token reservation should normally use `estimatedInputTokens + maxOutputTokens`, with provider-specific adjustments where the provider documents different accounting.

**Tests**

- Concurrent requests cannot oversubscribe.
- Failed requests release reservations.
- Canceled requests release reservations.
- Expired leases recover capacity.
- Actual usage lower than reservation returns excess capacity.

### Phase 3 — Distributed admission control

**Deliverables**

Add an abstraction:

```text
CapacityStore
├── SQLiteCapacityStore      # local-first/single node
├── RedisCapacityStore       # multi-instance
└── InMemoryCapacityStore    # tests/ephemeral
```

The local predictor may be optimistic for ranking, but the authoritative reservation operation must be atomic.

**Tests**

Run N concurrent gateway processes against one quota bucket and prove that admitted demand never exceeds the configured reservation policy.

### Phase 4 — Provider quota adapters

Implement a typed adapter contract:

```ts
interface ProviderQuotaAdapter {
  identifyScope(response, request): QuotaScope[];
  parseHeaders(headers): QuotaObservation[];
  classifyError(error): QuotaEvent;
  estimateDemand(request): DemandVector;
  getCatalogPolicy(provider, model): CatalogPolicy;
  getFreeEligibility(provider, model, account): Eligibility;
}
```

Initial adapters:

1. Google Gemini
2. Groq
3. Cerebras
4. SambaNova
5. OpenRouter
6. Mistral
7. Cohere
8. Cloudflare Workers AI
9. Hugging Face Inference Providers
10. NVIDIA NIM

Generic OpenAI-style header parsing remains a fallback, not the source of truth.

### Phase 5 — Free-provider catalog service

Create a versioned catalog containing:

```text
provider
model
endpoint
plan
free eligibility
published limits
quota dimensions
scope
reset/replenishment
headers
capabilities
context limits
pricing
source URLs
source verification timestamp
catalog revision
confidence
```

Catalog lifecycle:

```text
discovered → verified → active → observed → reconciled → stale → reverified
```

Add a scheduled catalog verification job. Changes should be represented as revisions and surfaced to operators.

**Critical behavior:** if provider documentation disappears or becomes ambiguous, reduce confidence and do not infer unlimited capacity.

### Phase 6 — Candidate eligibility engine

Create a deterministic eligibility filter before ranking:

```text
policy
  ↓
free eligibility
  ↓
capability compatibility
  ↓
quota availability
  ↓
context/output capacity
  ↓
health/bulkhead
  ↓
reservation
  ↓
rank
```

Policies:

- `free_only`
- `free_first`
- `paid_only`
- `configured_pool`

`free_only` must be an economic hard constraint.

### Phase 7 — Adaptive scheduler

Ranking must optimize successful completion rather than static model preference.

Maintain contextual signals for:

```text
provider × model × task × context class × time-of-day
```

Candidate score should combine:

- capability fit
- observed quality
- success probability
- current capacity confidence
- predicted latency
- congestion
- quota scarcity
- historical fallback probability

Use decayed observations so the scheduler adapts to changing provider behavior.

Do not use one permanent global model score.

### Phase 8 — Adaptive concurrency and bulkheads

Each provider/model/key gets an adaptive concurrency controller.

Behavior:

- increase slowly after healthy windows;
- decrease rapidly after 429/5xx/timeout/latency spikes;
- isolate a sick provider from healthy providers;
- maintain a minimum reserve where possible;
- avoid opening more work than known capacity can absorb.

Use per-provider and per-model bulkheads so one failing free provider cannot consume all scheduler concurrency.

### Phase 9 — Retry and failover engine

Build a structured failure taxonomy:

```text
retryable:
  rate_limited
  provider_overloaded
  timeout
  transient_transport
  transient_5xx

conditionally_retryable:
  stream_interrupted

non_retryable:
  invalid_request
  unsupported_model
  unsupported_capability
  policy_rejected
  invalid_credentials
  paid_only_model_under_free_only
```

For 429:

1. inspect Retry-After;
2. identify dimension;
3. update quota state;
4. cool down affected scope;
5. choose another eligible candidate;
6. only wait when no viable candidate exists.

Never perform an identical immediate retry against the same exhausted bucket.

### Phase 10 — Streaming reliability

Streaming must have its own execution policy:

- reserve expected output before opening stream;
- track TTFT;
- reconcile actual output continuously where safe;
- classify disconnects separately;
- retry only when the request is idempotent or continuation-safe;
- expose partial-stream status to the caller rather than silently duplicating text.

### Phase 11 — Learning system

Every execution emits a structured event:

```text
request_started
candidate_selected
reservation_created
provider_started
first_token
provider_completed
reservation_reconciled
rate_limit_observed
provider_failed
fallback_selected
request_completed
```

Derived metrics:

- success probability
- quota prediction error
- 429 probability
- timeout probability
- p50/p95/p99 TTFT
- p50/p95/p99 completion latency
- throughput
- stream interruption rate
- fallback success rate
- provider concentration
- free capacity utilization

Use exponentially decayed estimates and confidence intervals rather than raw counters alone.

### Phase 12 — Safe exploration

The router needs to learn providers it currently underuses, but exploration must not destabilize production.

Use a bounded exploration budget:

- small probe requests;
- never consume the final safe capacity reserve;
- reduce exploration during congestion;
- compare observed quality and reliability to current winners;
- promote providers only after sufficient evidence.

### Phase 13 — Observability/control plane

Expose a dashboard/API with:

```text
FREE POOL HEALTH
├── providers healthy/degraded/down
├── available free capacity
├── quota resets
├── 429 rate
├── success rate
├── p95 latency
├── current concurrency
├── active reservations
├── provider concentration
└── catalog freshness
```

A routing trace should explain:

```text
why candidate A was rejected
why candidate B won
what quota was reserved
what provider returned
why fallback happened
what DMR-X learned
```

This is essential for debugging and user trust.

## 3. Test strategy

### Unit tests

- quota arithmetic
- token estimation
- header parsers
- error classification
- reset calculation
- reservation lifecycle
- free eligibility
- ranking
- retry budgets

### Contract tests

For each provider adapter:

- documented headers
- successful response
- 429
- Retry-After
- daily exhaustion
- token exhaustion
- invalid model
- model unavailable

### Load tests

Simulate:

- one provider
- three providers
- 10+ providers
- 1,000 concurrent requests
- synchronized bursts
- daily quota exhaustion
- token exhaustion
- provider outage
- partial streaming failures

### Chaos tests

Inject:

- stale quota
- incorrect provider headers
- clock skew
- Redis unavailable
- provider 429 storm
- provider 503 storm
- slow responses
- dropped streams
- catalog source unavailable

### Economic safety tests

The strongest invariant test:

```text
free_only request
→ inspect every attempted route
→ assert paid route count == 0
```

Also test provider/model catalog changes that accidentally mark a paid model as free.

## 4. Rollout plan

### Stage A — shadow mode

Calculate free routes but do not change execution. Compare DMR-X decisions against current behavior.

### Stage B — advisory mode

Expose recommended free route and predicted quota without enforcing it.

### Stage C — free pool for internal workloads

Use the scheduler for low-risk workloads and collect reliability data.

### Stage D — default `free_first`

Make adaptive free routing the default only after success and latency targets are met.

### Stage E — `free_only` guarantee

Enable strict zero-paid enforcement with economic invariant tests.

### Stage F — continuous provider learning

Turn on scheduled catalog verification and automated observation-driven policy updates.

## 5. Suggested initial SLOs

These are engineering targets, not provider guarantees:

- free-only paid leakage: **0**
- avoidable duplicate retries after known 429: **0**
- reservation oversubscription: **0**
- routing decision p95: **<50 ms** excluding provider call
- quota state freshness for active candidates: **<30 s target** where live headers exist
- successful completion rate: **>99% for requests where at least one eligible provider has live capacity**, measured over sufficiently large workloads
- provider outage isolation: **<1 minute** to mark a repeatedly failing provider degraded

## 6. Provider-specific implementation notes

### Gemini

Model project-level quota. Do not treat API keys as independent capacity buckets when the provider applies project limits. Track RPM, input TPM and RPD separately.

### Groq

Consume live headers. Groq documents RPM, RPD, TPM, TPD and optional ITPM/OTPM. The first exhausted threshold wins.

### Cerebras

Model token-bucket replenishment. Reserve based on estimated input plus configured maximum completion because request acceptance can account for the maximum output budget.

### SambaNova

Track minute and daily request limits and daily token limits separately. Do not collapse daily headers into the minute bucket.

### OpenRouter

Model two layers: DMR-X → OpenRouter account/model → upstream provider. A downstream upstream-capacity failure should not automatically mean the user's OpenRouter account is exhausted.

### Cloudflare Workers AI

Track Neurons/day and model eligibility separately. Current documentation says the Free allocation is 10,000 Neurons/day and that some resource-intensive models require Workers Paid. Catalog must be refreshed because eligibility changes over time.

### Hugging Face

Treat the monthly free credit balance as an economic budget, not a request quota. Routed inference and custom provider keys have different billing semantics.

### NVIDIA NIM

Use account/model-specific live behavior where available. Published hosted limits are seed data, not a universal entitlement.

## 7. Files/code areas to create or modify

Expected implementation surface:

```text
services/quota/
  capacity-manager
  reservation-store
  quota-dimensions
  provider-adapters
  catalog
  learning

services/router/
  free-policy
  eligibility-engine
  scheduler
  concurrency-controller
  retry-failover
  routing-trace

packages/providers/
  provider-specific quota adapters

packages/types/
  quota/capacity/catalog contracts

services/telemetry/
  inference events
  provider health
  learning aggregates

tests/
  quota contracts
  provider contract suites
  scheduler simulations
  chaos/load/economic tests

docs/
  provider catalog
  architecture
  operations/runbook
```

Use the actual existing package structure as the source of truth during implementation; do not create duplicate abstractions where DMR-X already has an equivalent.

## 8. Definition of done

DMR-X is ready to claim production-grade free inference only when:

- at least 8 major free/free-credit provider integrations have contract tests;
- provider/model eligibility is catalog-driven;
- quota is dimensioned and scope-aware;
- capacity reservations are atomic;
- adaptive concurrency is active;
- retry/failover is failure-class aware;
- streaming has explicit safety semantics;
- observed limits continuously update routing state;
- catalog changes do not require a DMR-X release;
- routing traces explain every decision;
- load/chaos tests demonstrate recovery from provider outages and quota exhaustion;
- `free_only` has a tested zero-paid invariant;
- the system can measure whether each improvement actually increases successful free completions.

## 9. Research basis

The provider-rate baseline and primary source list are maintained in `DMRX-FREE-PROVIDER-RATE-CATALOG.md`. Current provider documentation confirms that free capacity is heterogeneous and dynamic; for example, Groq exposes multiple request/token dimensions and live rate-limit headers, while Cloudflare explicitly changes model-level free eligibility and provides a 10,000-Neuron daily free allocation. Hugging Face's free allocation is an economic monthly credit rather than a conventional RPM bucket. citeturn0search3turn0search2turn0search6turn0search0

The implementation therefore treats provider documentation as a versioned policy seed and live observations as the operational truth.
