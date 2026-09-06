# DMR-X A2A Integration

**Status:** Canonical A2A integration specification  
**Updated:** 2026-09-06  
**Target:** A2A v1.x

## Role

A2A is DMR-X's interoperability surface for communication with **independent agents**.

A2A does not replace the DMR-X Gateway and does not become an internal orchestration brain.

- **MCP:** agent ↔ tools/resources
- **A2A:** agent ↔ independent agents
- **DMR-X Gateway:** request ↔ model/provider
- **DMR-X Runtime:** execution of agents

The official A2A project describes the protocol as an open standard for agent interoperability, task management, messages, artifacts, streaming and discovery. A2A v1.0 is the current stable protocol generation. https://a2a-protocol.org/latest/

## DMR-X A2A role

DMR-X may expose an A2A Agent Card describing capabilities such as:

- AI inference
- delegated agent execution
- supported modalities
- supported task types
- available interfaces
- artifact capabilities

External agents may submit tasks to DMR-X. DMR-X may route the task to the Runtime or Gateway according to the task type and caller authorization.

## Task lifecycle

Implement a durable lifecycle compatible with the supported A2A version, including terminal-state protection and cancellation semantics.

The implementation should support:

- task creation
- task status
- messages
- artifacts
- streaming
- push notifications where configured
- cancellation
- multi-turn context
- failure reporting
- authentication/authorization

## Idempotency

Every externally submitted task should support an idempotency mechanism.

Duplicate requests must not unintentionally create duplicate expensive agent executions.

Persist:

- caller identity
- idempotency key
- task ID
- request hash
- execution ID
- terminal result

## Distributed execution

A2A tasks must be safe across multiple DMR-X instances.

Required mechanisms:

- durable task state;
- worker lease;
- heartbeat;
- ownership expiration;
- atomic claim;
- retry policy;
- duplicate-dispatch protection;
- cancellation propagation.

## Agent identity

Use strong identities for external agents. Authorization should be capability-scoped and tenant-aware.

Agent Cards should be versioned and validated. Where the deployment requires stronger authenticity, support signed Agent Cards and verification.

Do not expose internal credentials or sensitive implementation details in public Agent Cards.

## Artifacts

Large artifacts should not be embedded indefinitely in task payloads.

Use artifact references with:

- content hash
- MIME type
- size
- expiration
- access policy
- provenance

Artifact downloads must remain tenant/authorization scoped.

## Routing bridge

A2A dispatch should ultimately enter the normal DMR-X execution path:

`A2A -> authorization -> task admission -> Runtime/Gateway -> DMR-X routing -> provider -> result -> A2A artifact/message`

Do not create a separate provider-routing implementation inside A2A.

## Observability

Trace:

`external agent -> A2A task -> runtime/gateway -> router -> provider -> result`

Expose, subject to privacy policy:

- task latency
- queue time
- retries
- route decision ID
- provider/model
- token usage
- cost
- execution status
- failure reason

## Conformance

Build automated tests for:

- Agent Card discovery
- version negotiation
- authentication
- authorization failures
- message send
- streaming
- task state transitions
- cancellation
- push notifications
- artifacts
- malformed requests
- duplicate requests
- timeout/failure behavior
- multi-instance failover

Run compatibility tests against independent A2A implementations where practical.

## Security requirements

- HTTPS by default for remote deployments;
- authentication before task admission;
- tenant isolation;
- capability-scoped authorization;
- request size limits;
- artifact limits;
- rate limits;
- SSRF/egress protection for any callback/push endpoint;
- audit logging;
- replay protection;
- secret isolation.

## Non-goals

A2A must not:

- implement ATHENA's lattice;
- grant permissions that the caller does not have;
- bypass DMR-X policy;
- duplicate the model router;
- become an internal workflow scheduler.

## Roadmap

### P0

- A2A v1.x compatibility/conformance suite;
- Agent Card versioning;
- idempotency;
- authentication/authorization hardening;
- distributed task ownership;
- artifact references;
- end-to-end tracing.

### P1

- signed Agent Cards;
- robust push notification handling;
- multi-instance failover;
- artifact store;
- interoperability test matrix.

### P2

- advanced agent reputation/trust scoring;
- cross-instance federation;
- richer capability negotiation.
