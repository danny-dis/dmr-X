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

## Deep research findings — MCP 2026-07-28

This section records the protocol-level findings that materially affect DMR-X rather than treating MCP as a generic JSON-RPC transport.

### 1. The modern MCP core is stateless

The 2026-07-28 specification removes the modern `initialize`/`initialized` handshake and `Mcp-Session-Id`. Each request carries the information needed to route it, while `server/discover` is an optional capability/version discovery RPC.

Implication for DMR-X:

- modern HTTP requests must be safe to send to any gateway instance;
- sticky-session routing must not be a correctness dependency;
- per-request tenant, client and protocol metadata must be retained;
- application state that really needs continuity should use explicit handles or the Tasks extension, not hidden MCP transport sessions;
- DMR-X can scale horizontally behind ordinary load balancers.

### 2. Header-based routing is a first-class gateway primitive

Modern Streamable HTTP requests expose `Mcp-Method`, `Mcp-Name`, and `MCP-Protocol-Version`. DMR-X should inspect and validate these before dispatch.

Use cases:

- method/tool routing;
- per-method rate limits;
- tenant/accounting dimensions;
- authorization decisions;
- observability labels;
- WAF/gateway rules;
- protocol-version compatibility.

The gateway should reject inconsistent or malformed routing metadata rather than trusting headers blindly.

### 3. server/discover becomes the modern negotiation point

The TypeScript SDK's 2026 types define `server/discover` as returning supported protocol versions, server capabilities, optional instructions, and cache hints.

DMR-X client behavior should therefore be:

1. connect to an upstream;
2. attempt modern discovery/version negotiation;
3. select a mutually supported protocol version;
4. fall back only when explicitly supported;
5. record the negotiated version and capabilities in the server registry;
6. invalidate the negotiated state when the upstream changes.

This is more robust than assuming one MCP version from configuration.

### 4. Discovery results are cacheable

Modern `tools/list`, `prompts/list`, `resources/list`, and `resources/read` results can carry `ttlMs` and `cacheScope`.

DMR-X should implement a capability catalog with:

- freshness deadline;
- cache scope;
- source server;
- negotiated protocol version;
- provenance;
- last successful refresh;
- refresh/error state;
- content hash/version when available.

The cache must respect the upstream's declared scope and TTL. A stale result may be used only under an explicit stale-read policy; it must never silently become permanent state.

### 5. Tasks are an extension, not a hidden session mechanism

The 2026 Tasks extension provides durable long-running work using task handles and operations such as `tasks/get`, `tasks/update`, and `tasks/cancel`. There is deliberately no `tasks/list` enumeration API.

DMR-X should map long-running routing/execution jobs to this model:

- return a task handle instead of holding a transport open;
- persist task state in a tenant-scoped task store;
- make task IDs high-entropy and unguessable;
- authorize every task operation;
- never expose cross-tenant task enumeration;
- support cancellation and bounded polling;
- record upstream execution provenance;
- make retries explicit because task creation may have already caused side effects.

Candidate workloads include long research jobs, code execution, media generation, large data transforms and DMR-X agent-runtime workers.

### 6. Multi-round-trip requests replace old server-to-client request flows

The 2026 protocol uses in-band multi-round-trip results such as `input_required`. This is important for confirmation, missing information and interactive operations without relying on a permanently open bidirectional session.

DMR-X should preserve the request state needed to continue a round trip while keeping the transport itself stateless. State handles must be short-lived, tenant-bound and integrity-protected.

Do not build new DMR-X features around deprecated server-initiated sampling/elicitation/root request channels.

### 7. Authorization is stricter

The 2026 release hardens MCP authorization around issuer validation and credential binding, and moves the ecosystem toward Client ID Metadata Documents (CIMD) instead of Dynamic Client Registration (DCR).

DMR-X should therefore separate:

- downstream client authentication;
- DMR-X authorization;
- upstream MCP authorization;
- credential storage/binding;
- tenant identity;
- tool-level authorization.

An upstream token must never accidentally be reused against another issuer. DMR-X should record issuer identity with credential material and reject issuer mismatches.

### 8. Deprecated protocol surfaces need an explicit compatibility boundary

The 2026 release deprecates:

- legacy HTTP+SSE transport;
- Roots;
- Sampling;
- Logging.

DMR-X may retain them for compatibility during migration, but new architecture and tests should target the modern equivalents. Compatibility code should be isolated so it cannot become the default design.

### 9. MCP Skills are useful for progressive disclosure

The stable MCP Skills extension allows servers to publish skills through `skills/list`, `skills/get` and resources.

This maps directly to DMR-X's future skill system:

`task -> capability search -> skill metadata -> load detailed instructions only when needed -> tool/model execution`

DMR-X should not inject every skill's full instructions into every model context. Skills should be discoverable, permissioned, versioned and provenance-aware.

### 10. Tool annotations are routing hints, not security controls

MCP tool annotations include hints such as:

- `readOnlyHint`
- `destructiveHint`
- `idempotentHint`
- `openWorldHint`

DMR-X may use these for ranking, retry decisions and approval UX, but they are not trustworthy security assertions.

Security policy must derive from DMR-X-owned policy plus trusted server registration. An untrusted upstream cannot make a destructive tool safe merely by setting `readOnlyHint=true`.

### 11. Gateway ecosystem confirms progressive aggregation

Current gateway implementations reinforce several design choices already made here: aggregate multiple upstream servers, namespace collisions, discover capabilities dynamically, route by capability metadata, and avoid presenting an unbounded flat tool catalog.

DMR-X should go further by making the aggregated catalog a policy-aware capability registry rather than merely a renamed list of upstream tools.

## DMR-X implementation gap analysis

The repository already depends on MCP SDK v2 packages and has both MCP server and client infrastructure. However, the current HTTP entry point still constructs sessionful `NodeStreamableHTTPServerTransport` instances with generated session IDs.

Therefore:

**Already implemented in this PR**
- collision-safe tool indexing;
- canonical `serverId__toolName` routing;
- dispatch-time per-server allowlists;
- output-schema and annotation preservation;
- stale tool removal during refresh;
- progressive-discovery architecture and capability registry design.

**Still required for full modern conformance**
- replace the northbound sessionful HTTP path with the SDK v2 `createMcpHandler` stateless entry;
- add explicit modern `server/discover` negotiation on the client side;
- process `Mcp-Method`, `Mcp-Name`, and `MCP-Protocol-Version`;
- implement TTL/cacheScope-aware capability caching;
- implement modern cancellation semantics;
- add MRTR/input-required handling;
- add Tasks as a first-class DMR-X job abstraction;
- harden OAuth/CIMD/issuer binding;
- add MCP Skills federation;
- add conformance tests against modern and legacy clients.

This distinction is intentional: this PR establishes the fabric and collision/policy foundation without pretending that the existing sessionful HTTP server is already a complete 2026 implementation.

## Proposed capability registry model

Each DMR-X capability should have a stable internal identity independent of MCP naming:

```
Capability
  id
  kind: model | tool | resource | prompt | skill | agent | service
  source
  sourceServerId
  upstreamName
  canonicalName
  protocol
  protocolVersion
  transport
  inputSchema
  outputSchema
  annotations
  trust
  policy
  tenantScope
  provenance
  health
  latency
  cost
  reliability
  cache
  lastSeen
```

MCP is then an adapter into this registry.

That lets the same router choose between:

- an MCP tool;
- an OpenAI-compatible model;
- a local model;
- a specialist OCR/audio/vision model;
- an HTTP API;
- an A2A agent;
- a DMR-X runtime worker.

The MCP protocol remains a transport/interoperability contract rather than becoming DMR-X's internal architecture.

## Recommended modern request path

```
Downstream Agent
      |
      v
DMR-X MCP Server (stateless)
      |
      +--> auth / tenant resolution
      +--> protocol + header validation
      +--> capability lookup
      +--> policy / RBAC
      +--> AETHER content safety boundary
      +--> route + health + cost selection
      +--> DMR-X capability registry
      |
      +--> MCP client -> upstream MCP
      +--> model adapter
      +--> A2A bridge
      +--> local/runtime worker
      |
      +--> result inspection / DLP
      +--> audit / telemetry
      v
Downstream Agent
```

For long-running work:

```
request -> policy -> create task -> execute asynchronously
         -> tasks/get / update / cancel
         -> result inspection -> completed/failed/cancelled
```

## Research sources

Primary protocol source:
- Model Context Protocol, "The 2026-07-28 Specification": https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Official TypeScript SDK v2: https://github.com/modelcontextprotocol/typescript-sdk
- 2026 protocol type definitions: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/core-internal/src/types/spec.types.2026-07-28.ts
- 2026 migration guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md
- Official gateway example: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/examples/gateway/server.ts
- MCP aggregation/gateway ecosystem reference: https://github.com/kuadrant/mcp-gateway

Research conclusion: DMR-X should target the 2026 stateless MCP architecture as its native northbound/southbound model, while keeping an isolated compatibility layer for older clients. The capability registry, policy engine, AETHER boundary and model/router layer remain DMR-X-owned concerns.
