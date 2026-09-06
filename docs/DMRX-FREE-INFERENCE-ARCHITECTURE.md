# DMR-X Free Inference Control Plane

**Status:** Canonical design addition
**Date:** 2026-09-06

## Purpose

Free inference is one of DMR-X's founding use cases. The goal is not merely to expose a list of free models. DMR-X must make a pool of unstable, heterogeneous, quota-constrained free providers behave as one reliable inference substrate.

A free route is considered healthy only when DMR-X can continuously answer:

- Is this provider/model/key eligible for this request?
- How much request and token capacity is actually available?
- When will each exhausted dimension recover?
- Is the provider currently accepting traffic, or merely documented as available?
- Is the model capable enough for this task?
- What is the probability that the request will complete successfully?
- Which alternative can take over without losing the request semantics?

## Core principle

**Never route on advertised free-tier availability alone. Route on live capacity + learned reliability + task fitness.**

Provider documentation is seed data. Response headers, 429/403/5xx errors, latency, stream failures, and successful token usage continuously correct that seed data.

## Architecture

```text
                       ┌──────────────────────────┐
                       │ Provider Rate Catalog     │
                       │ published limits/pricing │
                       └────────────┬─────────────┘
                                    │ seed
                                    ▼
Request → Requirement Vector → Free Candidate Builder
                                    │
                  ┌─────────────────┼─────────────────┐
                  ▼                 ▼                 ▼
             live quota        health state       task quality
             + reservations    + congestion       + capability
                  └─────────────────┼─────────────────┘
                                    ▼
                         Capacity-Aware Scheduler
                                    │
                           admission / pacing
                                    ▼
                         Provider execution pool
                                    │
                   ┌────────────────┼────────────────┐
                   ▼                ▼                ▼
                headers           errors           outcome
                   └────────────────┼────────────────┘
                                    ▼
                       telemetry → learning → catalog
```

## 1. Provider account, key and model are separate capacity domains

A provider may enforce limits at different scopes. DMR-X must represent them explicitly:

- account/organization
- project
- API key
- provider/model
- model family
- endpoint
- IP/network where applicable
- concurrent requests
- RPM/RPH/RPD
- TPM/TPH/TPD
- input tokens per minute
- output tokens per minute
- audio seconds or modality-specific units
- spend/credit balance

Do not collapse these into one `rpm` field.

## 2. Capacity is a vector, not a number

Each candidate owns a capacity state:

```text
capacity = {
  requests: { minute, hour, day },
  tokens:   { inputMinute, outputMinute, minute, hour, day },
  concurrency,
  credits,
  resetAtByDimension,
  confidence,
  observedAt
}
```

A request is admissible only if all required dimensions have sufficient estimated capacity.

For token-limited providers, reserve capacity using the request's estimated input tokens plus its configured maximum output tokens. Release unused reservation after the actual response is known.

This matters because providers such as Cerebras explicitly rate-limit against estimated token consumption and recommend setting `max_completion_tokens` appropriately.

## 3. Reservations prevent free-tier stampedes

Before execution:

1. estimate request and output token demand;
2. reserve capacity atomically;
3. admit the request only if the reservation succeeds;
4. otherwise immediately consider another candidate;
5. reconcile reservation with actual usage after completion.

This prevents 20 concurrent requests from all observing the same remaining quota and simultaneously selecting it.

Reservations must have short leases and be released on timeout/cancellation.

## 4. Distributed admission control

The current quota service contains useful persistence and tracking, but in-memory counters cannot be the authoritative admission mechanism once DMR-X has multiple gateway instances.

The production design is:

- local fast-path state for prediction;
- shared atomic counters for reservations;
- durable provider/key cooldown state;
- request-id idempotency;
- clock-skew-safe reset calculations;
- per-provider bulkheads;
- per-model bulkheads;
- per-key bulkheads.

SQLite remains suitable for single-node/local-first deployments. Redis/Valkey or another shared atomic store should be supported for multi-instance deployments.

## 5. Never retry blindly

A 429 is not one condition. DMR-X should classify it into:

- request-per-minute exhaustion;
- token-per-minute exhaustion;
- daily request exhaustion;
- daily token exhaustion;
- concurrency exhaustion;
- provider overload;
- account/project quota exhaustion;
- unknown rate-limit condition.

Honor `Retry-After` whenever supplied. Otherwise derive the earliest safe retry from the affected quota dimension. If another eligible candidate exists, fail over instead of sleeping the entire request path.

Do not retry errors that are deterministic for the selected route, such as unsupported capability, invalid model, malformed request, policy rejection, or known free-tier prohibition.

## 6. Retry budgets

Each request receives a retry budget rather than an unlimited retry loop.

Suggested defaults:

- max provider attempts: 3
- max total elapsed routing overhead: 5 seconds for interactive requests
- max same-provider attempts: 1 after a 429
- max retries after transport failure: 2
- max retries after stream failure: 1 unless provider supports safe continuation

The policy is workload-dependent. Long-running asynchronous jobs may receive larger budgets.

## 7. Free routing objectives

`free_only` means **never incur a paid charge**. This must be enforced at the candidate-policy layer, not by hoping a provider's generic router chooses a free model.

`free_first` means free candidates are preferred but paid fallback is permitted only if explicitly configured.

`free_first` must not mean "hammer the cheapest free model until it fails." It means optimize expected successful completion subject to zero-cost preference.

A useful ranking objective is:

```text
expected_value =
  task_quality
  × success_probability
  × capability_fit
  × capacity_confidence
  ─────────────────────────────────────────
  expected_latency + congestion_penalty
```

Then apply free/paid policy as a hard constraint or lexicographic preference.

## 8. Provider health is continuous

Track:

- success rate
- 429 rate
- 403/credit failures
- 5xx rate
- connection failures
- timeout rate
- stream interruption rate
- TTFT p50/p95/p99
- completion latency p50/p95/p99
- output throughput
- observed capacity
- quota prediction error
- model-specific failure rate
- task-specific success rate

Use exponentially decayed windows so old incidents lose influence.

A provider can therefore be:

`healthy → congested → degraded → cooling-down → unavailable → probing → healthy`

rather than simply up/down.

## 9. Exploration without destabilizing production

The router should periodically probe alternatives, but probes must be tiny and budget-aware.

Use contextual exploration for:

`model × provider × task × context class × time-of-day`

Exploration should never consume the last safe quota of a provider needed by active work.

Successful probes increase confidence; failed probes create temporary penalties.

## 10. Key rotation is not quota multiplication

Multiple user-owned keys can legitimately provide independent capacity when the provider permits it. DMR-X must never bypass provider limits, terms, anti-abuse controls, or account restrictions by manufacturing identities or rotating keys to evade enforcement.

Key rotation exists for:

- legitimate multiple credentials;
- independent tenant budgets;
- credential lifecycle management;
- provider-approved capacity pools.

## 11. Free-provider registry

Every provider/model record should contain:

```text
provider
model
endpoint
pricing
freeEligibility
freeTierType
limitDimensions
limitScope
publishedLimits
headerSchema
errorSchema
retryAfterSupport
resetSemantics
contextLimit
capabilities
privacy/data-policy metadata
sourceURLs
sourceLastVerified
observedAt
confidence
status
```

`sourceLastVerified` and `observedAt` are mandatory. A rate limit without freshness metadata is unsafe routing data.

## 12. Learning provider rates

DMR-X should learn from three evidence classes:

### A. Documentation evidence

Official provider documentation seeds expected limits, pricing, headers, reset semantics and eligibility.

### B. Response evidence

Every response updates the observed state from headers, status codes, retry-after, usage and latency.

### C. Behavioral evidence

The router infers hidden capacity from repeated observations. For example, if a provider claims 30 RPM but returns 429 after a burst of 18 requests because of token pressure, DMR-X should learn that request count alone is not the active bottleneck.

Observed limits must be confidence-scored rather than permanently overwriting published limits.

## 13. Free provider tiers are dynamic

Providers can remove free models, change quotas, move models to paid plans, or introduce capacity restrictions. DMR-X must therefore support catalog updates without code deployment.

The catalog updater should:

1. fetch official documentation on a schedule;
2. parse structured/provider-specific data where available;
3. compare with the previous snapshot;
4. create a catalog revision;
5. lower confidence when a source cannot be verified;
6. never silently turn an unknown limit into a guaranteed unlimited limit;
7. expose changes in the admin UI and routing trace.

Human review is appropriate for ambiguous documentation changes.

## 14. Provider-specific adapters

Do not force every provider into one header parser. Providers already expose materially different schemas.

Examples confirmed during September 2026 research:

- Groq exposes request/token limits and reset headers.
- Cerebras exposes daily request and per-minute token headers and uses token-bucket replenishment.
- SambaNova exposes per-minute and per-day request headers, including separate daily fields.
- Mistral uses minute-specific header names that differ from the generic OpenAI-style names.
- Cohere trial quotas use trial-endpoint headers.
- OpenRouter has its own free-model account quota and upstream provider throttling.

DMR-X should use typed provider quota adapters plus a generic fallback parser.

## 15. Important correction to the current implementation

The existing dynamic limit layer currently treats unknown quota values as available and uses a five-minute freshness window for observed key state. That is acceptable as a local optimistic hint but unsafe as the final free-tier admission decision.

The new design must distinguish:

- `known_available`
- `known_exhausted`
- `unknown`
- `stale`
- `probing`

For `free_only`, unknown/stale capacity must not be treated as unlimited. The scheduler should either obtain a fresh provider signal or use a conservative configured allowance.

## 16. Streaming reliability

Streaming requires different accounting:

- reserve the maximum expected output before opening the stream;
- start releasing unused reservation as actual output arrives where safe;
- record TTFT separately from total latency;
- classify mid-stream disconnects separately from pre-response failures;
- retry only when the caller can safely tolerate duplicate or partial output;
- never silently concatenate two independent generations unless the protocol supports a continuation contract.

## 17. Capacity-aware concurrency

Concurrency must be adaptive per provider/model/key.

Start below the observed safe concurrency, increase slowly after successful windows, and reduce aggressively after latency/429/5xx spikes.

This is especially important for free infrastructure because a provider can have a nominal RPM that is useless when simultaneous requests saturate shared capacity.

## 18. Multi-provider free pool

A robust free pool should deliberately mix providers with different failure modes rather than sending most traffic to one popular model.

Example pool classes:

- high-quality general
- fast general
- coding
- reasoning
- long-context
- multimodal
- embeddings
- safety/classification
- fallback/small

The scheduler should maintain a minimum viable reserve in each class where possible.

## 19. Provider selection example

```text
Request: coding task, free_only, streaming, max 8k output

1. Filter to coding-capable free candidates.
2. Remove candidates without tool/stream support.
3. Remove candidates with stale/exhausted required capacity.
4. Estimate input + 8k output reservation.
5. Penalize candidates with high current congestion.
6. Prefer high task-quality candidates.
7. Reserve capacity atomically.
8. Execute.
9. Reconcile actual usage.
10. Record outcome.
11. If failed, choose the next candidate using the updated state.
```

## 20. Definition of success

For a user configured with `free_only`, DMR-X should be able to sustain useful workloads across changing free providers without requiring the application to know provider-specific quotas.

The key product metric is not "number of free models." It is:

**successful free completions per user hour, at acceptable latency, without surprise paid usage.**

Secondary metrics:

- free completion success rate
- free request success rate
- 429 avoidance rate
- quota prediction accuracy
- fallback success rate
- p95 TTFT
- p95 completion latency
- free capacity utilization
- provider concentration
- paid leakage rate (target: zero under `free_only`)
