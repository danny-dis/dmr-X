# DMR-X MCP Fabric — 2026 Architecture

Status: implementation target / architecture contract
Updated: 2026-10-03
Protocol target: MCP 2026-07-28, with explicit legacy compatibility

## Purpose

DMR-X should treat MCP as an interoperability fabric, not merely as another tool API.

A deployment has two MCP faces:
1. Northbound MCP server: agents connect once to DMR-X.
2. Southbound MCP client fabric: DMR-X connects to many MCP servers and manages discovery, policy, health, credentials and execution.

Target topology:

Agent / Host -> one MCP connection -> DMR-X -> many MCP servers

DMR-X remains protocol-agnostic. MCP is one interoperability surface alongside HTTP/OpenAI-compatible APIs, A2A, local execution and future transports.

## What exists today

The repository already contains substantial MCP infrastructure:
- services/mcp-server exposes DMR-X routing and multimodal capabilities.
- services/mcp-client connects to external MCP servers.
- STDIO, legacy SSE and Streamable HTTP client transports are represented.
- External tools can be re-exposed through DMR-X using serverId__toolName namespacing.
- External calls have timeouts, retries, circuit breakers and reconnection.
- Tool schemas are validated before proxy execution.
- DMR-X has tool search, RBAC, guardrails, audit hooks, rate limiting and policy engines.
- MCP OAuth routes, A2A, federation, resources and prompts exist in the MCP server package.

The current shape is therefore a strong gateway foundation, but it is not yet a complete 2026 MCP fabric.

## 2026 protocol implications

### Stateless protocol core

MCP 2026-07-28 removes the old initialize/initialized session model from the modern protocol core. Requests carry their own protocol/client metadata, allowing ordinary stateless HTTP infrastructure and round-robin routing.

DMR-X should make stateless modern Streamable HTTP the primary remote architecture and avoid making sticky sessions a prerequisite.

### Routable headers

Modern MCP exposes method and tool/resource/prompt name information through HTTP headers. DMR-X can use these for routing, rate limiting, tenant accounting, authorization and metrics without parsing request bodies just to select a route.

### Cacheable discovery

Modern list/read results carry cache hints. DMR-X should cache tools, prompts and resources according to the upstream TTL and cache scope rather than using unconditional caches.

### Tasks

Long-running tools can be represented as durable Tasks. DMR-X should use this for large research jobs, media generation, long code execution, data processing and agent-runtime work. Task identifiers must be unguessable and scoped; do not create a cross-tenant task enumeration API.

### Multi-round-trip requests

Modern MCP moves server-to-client interaction into in-band multi-round-trip results. DMR-X should preserve these semantics rather than recreating the deprecated server-initiated request channel.

## Northbound MCP server

Expose a deliberately small, stable DMR-X surface:
- routed inference
- model/provider discovery
- route preview and decision traces
- multimodal inference
- capability/tool search
- selected agent-runtime operations
- job/task inspection
- skill discovery
- authorized administrative capabilities

Do not automatically flood tools/list with every upstream tool. Large installations need progressive disclosure.

## Southbound MCP client fabric

Every upstream server should have explicit metadata for:
- identity and provenance
- transport and endpoint/process
- credentials and tenant binding
- tool/resource/prompt policy
- timeout, retry and rate limits
- trust classification
- health and protocol compatibility

Support STDIO for local servers, Streamable HTTP for modern remote servers and legacy SSE only as a compatibility path.

## Tool identity and collisions

Tool names are not globally unique. DMR-X must never silently select one backend when several expose the same name.

Canonical external references are serverId__toolName, for example:
- github__search_code
- gitlab__search_code
- filesystem__read_file

An unqualified tool name is valid only when exactly one connected server exposes it.

The MCP client registry now preserves collisions, resolves canonical namespaced references, and refuses ambiguous unqualified resolution.

## Tool metadata

Preserve upstream description, input schema, output schema and annotations together with server identity and provenance.

Normalize useful routing/policy metadata such as readOnly, destructive, idempotent, openWorld, network access, data sensitivity, required scopes, approval requirement and retry safety.

Tool annotations are hints, not security guarantees. Treat untrusted upstream annotations pessimistically.

## Capability-aware discovery

Use this flow:

task -> capability search -> candidate tools -> policy filter -> trust/health filter -> rank -> expose minimal schemas -> call

Ranking should consider semantic relevance, schema compatibility, capability fit, historical success, latency, cost, availability, trust, tenant policy, locality and privacy.

This makes MCP tools first-class DMR-X capabilities rather than a flat bag of functions.

## Security boundary

Every MCP call must pass through normal DMR-X controls:

authentication -> authorization/RBAC -> tool policy -> schema validation -> injection/untrusted-content checks -> PII/DLP -> network/egress policy -> execution -> output inspection -> audit

Rules:
- MCP must never bypass tenant authorization.
- Upstream annotations are untrusted hints.
- Remote-server configuration must be protected against SSRF.
- Credentials stay isolated per upstream server.
- Tool results are untrusted data and may contain prompt injection.
- Destructive operations require policy evaluation.
- Retries must respect idempotency and uncertain outcomes.

## Reliability

Measure reliability at both server and tool level:
- availability
- latency distribution
- error and timeout rate
- retry rate
- circuit state
- policy denials
- schema/output validation failures

A healthy MCP server does not imply that every tool it exposes is healthy.

## Federation

A DMR-X node may consume another DMR-X node as an MCP peer. Federation must preserve provenance and authorization boundaries; speaking MCP does not make a remote DMR-X equivalent to a local trusted process.

## DMR-X + AETHER

AETHER can sit around the MCP boundary as the adversarial-content and prompt-injection defense layer. DMR-X should remain responsible for capability management, routing, credentials, quotas and execution policy.

Recommended boundary:

downstream client -> AETHER -> DMR-X -> policy/router -> upstream MCP

## DMR-X + A2A

MCP and A2A remain separate. MCP provides tools/resources/prompts and capability interoperability; A2A provides independent agent-to-agent task interoperability. DMR-X can bridge them without making either protocol its internal control plane.

## Roadmap

### P0
- modern stateless Streamable HTTP server path
- modern client version negotiation
- discovery and cache TTL support
- authorization hardening
- cancellation and bounded concurrency
- collision-safe tool registry
- per-server tool allowlists enforced at dispatch
- preserve tool output schemas and annotations
- stale-tool removal during refresh
- conformance and interoperability tests

### P1
- unified capability registry
- semantic tool discovery and ranking
- per-tool health
- capability provenance
- tool quality learning
- progressive tool disclosure
- dynamic upstream registration
- distributed catalog cache

### P2
- Tasks-backed long-running calls
- federation-aware routing
- load balancing
- cross-node capability cache
- policy-aware failover
- tool-result isolation
- MCP Skills integration
- MCP Apps where useful

## Design principle

DMR-X should not become an MCP proxy. It should become an AI capability gateway in which MCP is one major interoperability fabric.

A model, MCP tool, specialist model, local service, agent or other execution backend should all participate in the same DMR-X capability and routing model without forcing the internal architecture to depend on one protocol.