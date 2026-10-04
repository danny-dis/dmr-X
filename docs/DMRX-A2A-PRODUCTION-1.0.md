# DMR-X A2A Production Profile (A2A 1.0)

## Status

This document defines the production profile for DMR-X's A2A gateway.

The implementation targets A2A Protocol **1.0** and keeps 0.3 compatibility at the boundary. A2A 1.0 is the latest released protocol version.

## Security model

A2A task operations are authenticated at the HTTP boundary. Public Agent Card discovery remains unauthenticated; task creation, task reads, cancellation, streaming, push configuration, and extended-card access require authentication when production authentication is enabled.

DMR-X uses an out-of-band Bearer credential:

- `DMRX_A2A_API_KEY` — preferred A2A credential(s), comma separated.
- `DMRX_MCP_API_KEY` — fallback when an existing MCP credential should also authorize A2A.
- `DMRX_A2A_REQUIRE_AUTH=true` — explicitly require authentication.
- In `NODE_ENV=production`, authentication is required by default.

The credential is never placed in the Agent Card. The card advertises an A2A 1.0 HTTP Bearer security scheme.

### Tenant isolation

Each authenticated credential becomes an opaque principal. Tasks, task history, cancellation, push configuration, and context reconstruction are scoped to that principal.

A task owned by another principal is intentionally reported as not found rather than leaking that it exists.

### Rate limiting

A per-principal sliding minute bucket protects the A2A HTTP surface. Configure:

`DMRX_A2A_RATE_LIMIT=120`

This is an in-process limiter. Multi-replica deployments should additionally enforce a shared gateway/load-balancer rate limit.

## A2A 1.0 protocol handling

The HTTP boundary:

- serves `/.well-known/agent-card.json`;
- accepts `A2A-Version: 1.0` and 0.3 compatibility;
- rejects unsupported protocol versions;
- uses the A2A media type `application/a2a+json` for responses;
- supports JSON-RPC 2.0, streaming SSE, task polling, cancellation, resubscription and push notifications;
- bounds request bodies and JSON-RPC batch sizes;
- returns no response for JSON-RPC notifications;
- advertises only capabilities that are actually implemented.

The Agent Card declares the v1.0 `supportedInterfaces`, media types, skills, capabilities and security requirements. The legacy 0.3 fields remain only for compatibility.

## Durable task state

Production startup requires:

`DMRX_A2A_DB_PATH=/var/lib/dmrx/a2a.sqlite`

The service waits for SQLite initialization before publishing A2A traffic and refuses production startup if durable persistence cannot be initialized.

SQLite uses WAL, a busy timeout and full synchronous durability. This is a **single-instance durable store**, not a distributed task store. For multiple active DMR-X replicas, place A2A behind a single task-owning instance or implement a shared task-store backend before horizontally scaling task execution.

Task ownership survives restart through a separate persisted owner field. The task payload itself never contains the credential.

## Cancellation and deadlines

Every running A2A task receives an AbortController. `tasks/cancel` aborts the underlying DMR-X gateway request rather than only changing the visible task state.

Default dispatch deadlines:

- normal task: 60 seconds
- longer multi-turn task: 120 seconds
- override: `DMRX_A2A_TASK_TIMEOUT_MS`

A canceled task cannot be resurrected by a late gateway response.

## Push notification security

Push notification URLs are validated before storage and again before delivery.

Production rules:

- HTTPS is required.
- localhost and metadata endpoints are rejected.
- loopback, RFC1918/private, link-local, carrier-grade NAT and private IPv6 ranges are rejected.
- DNS is resolved and all returned addresses are checked.
- redirects are disabled.
- webhook requests have a 10-second deadline.
- transient failures are retried with bounded exponential backoff.
- 4xx responses are not retried.
- the A2A media type is used.
- task and event identifiers are sent so receivers can deduplicate.
- webhook credentials are never returned by the get-config operation.

This follows the A2A security guidance around SSRF, authenticated webhook calls, timeouts and duplicate delivery handling.

## Message retry behavior

A2A 1.0 leaves Send Message idempotency optional. DMR-X uses the A2A `messageId` as a local duplicate-detection key: retrying the same message for the same authenticated principal returns the existing task instead of starting a second execution.

This is deliberately not advertised as a new protocol capability. A future transport-level Idempotency-Key extension can be added without changing the task model.

## Operational requirements

Production deployments should additionally provide:

1. TLS termination and certificate validation at the edge.
2. A shared ingress rate limit for multi-replica deployments.
3. Structured request/task correlation IDs.
4. Centralized logs and metrics.
5. Health/readiness probes that include A2A persistence readiness.
6. Backup/restore for the A2A SQLite database.
7. Resource limits for CPU, memory, open connections and concurrent tasks.
8. Network egress controls as a second layer around webhook SSRF protection.
9. A shared task store before active-active horizontal scaling.

## Conformance test matrix

The A2A test suite for DMR-X should cover:

- public Agent Card discovery;
- v1.0 Agent Card schema and security declarations;
- A2A-Version negotiation;
- authenticated message/send;
- unauthorized task access;
- cross-principal task isolation;
- messageId retry deduplication;
- task cancellation aborting the downstream request;
- timeout -> failed task;
- terminal-state immutability;
- streaming state ordering;
- resubscribe to in-flight and terminal tasks;
- push configuration validation;
- SSRF/private-IP rejection;
- authenticated push delivery;
- retry/backoff behavior;
- persistence across restart;
- owner persistence across restart;
- malformed JSON and oversized requests;
- JSON-RPC batch limits;
- notification semantics;
- extended Agent Card capability enforcement.

## References

- A2A Protocol Specification 1.0: https://a2a-protocol.org/v1.0.0/specification/
- Official A2A GitHub specification: https://github.com/a2aproject/A2A/blob/main/docs/specification.md
- Official JavaScript SDK 1.0: https://github.com/a2aproject/a2a-js
