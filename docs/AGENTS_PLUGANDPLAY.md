# Plug & Play: external agents

Connect any MCP client (Claude Code, Cursor, Continue, etc.) to DMR-X's
`dmrx_*` tools and `dmrx_agent_*` subagent tools without code changes.

## 1. Two environment variables (minimal setup)

The MCP server reads these (see `services/mcp-server/src/index.ts` and
`services/mcp-server/src/tenant-key.ts`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `DMRX_GATEWAY_URL` | `http://localhost:3000` | Base URL of the running DMR-X gateway. |
| `DMRX_MCP_AGENT_API_KEY` | _(none)_ | Bearer key (tenant API key) sent to the gateway. |

Minimal run:

```bash
DMRX_GATEWAY_URL=http://localhost:3000 \
DMRX_MCP_AGENT_API_KEY=<tenant-api-key> \
bun run services/mcp-server
```

## 2. Provisioning and key resolution

The server resolves the gateway key per request in this order
(`resolveGatewayKey()` in `services/mcp-server/src/tenant-key.ts`):

1. Per-client `X-DMR-Tenant-Key` header.
2. `DMRX_MCP_AGENT_API_KEY` env var.
3. Best-effort auto-provisioned key.

### 2.1 Zero-config auto-provisioning

If you do not set `DMRX_MCP_AGENT_API_KEY`, the server tries to auto-provision
a dedicated tenant + API key via the gateway admin API (`POST /admin/tenants`,
`POST /admin/api-keys`) as long as `DMRX_ADMIN_API_KEY` is set. Otherwise it
logs a warning and continues with no key; downstream calls report
"agent key not configured".

### 2.2 Per-client key via header

An external MCP client may pass its own tenant key per request:

```
X-DMR-Tenant-Key: <client-tenant-key>
```

This gives each client its own isolated gateway tenant out of the same MCP
server process.

## 3. Tenant isolation

All tool calls are scoped by the resolved tenant key:

- Subagent dispatch routes through `/v1/agents` / `/v1/agentic/dispatch` with the
  resolved bearer key.
- A2A task handler (`/a2a/tasks/send`) forwards to the same dispatcher.
- Skills/templates/presets listed by an MCP client use the resolved tenant.
- Auto-provisioned fallback still isolates by tenant; missing keys still fail
  with a clear error instead of silently sharing state.

## 4. Durable sessions

Transport-backed sessions are tracked and cleaned up automatically
(`services/mcp-server/src/index.ts`):

- SSE sessions are keyed by `Mcp-Session-Id` and swept after idle timeout.
- Streamable HTTP sessions are keyed by `mcp-session-id` / transport session
  id, also swept after idle timeout.
- `DMRX_MCP_SESSION_TIMEOUT_MS` controls how long an idle session lives
  before cleanup.

A2A tasks can carry a `sessionId`, and `A2ATaskManager` tracks many tasks per
session so you can resume or list related work.

For agent chat state, use the durable context tools:

- `dmrx_context_save` — save conversation context with ID and optional TTL.
- `dmrx_context_load` — reload saved context by ID.
- `dmrx_context_list` — list contexts for the tenant/user.
- `dmrx_context_summarize` — summarize a saved conversation.
- `dmrx_context_compress` — compress a saved conversation while preserving meaning.

## 5. Skills

Skills are available through the skills import/list endpoints and tool templates/presets.

### 5.1 Skills CRUD / discovery

- `dmrx_list_skills` — list skills imported into DMR-X via the gateway
  (`GET /v1/skills`) with optional search, tag filter, and limit.
- `dmrx_import_repo` — import agents and skills from a GitHub repository into
  DMR-X via the gateway (`POST /v1/agents/import`, `POST /v1/skills/import`).
  Returns imported counts plus any errors.

### 5.2 Tool templates and presets

- `dmrx_template_list` — list saved tool call templates for the tenant.
- `dmrx_template_get` — get a template by ID.
- `dmrx_template_create` — create a reusable multi-step tool workflow.
- `dmrx_template_update` — update an existing template.
- `dmrx_template_delete` — soft delete a template.
- `dmrx_template_execute` — execute a template, passing outputs between steps.
- `dmrx_preset_list` / `get` / `create` / `update` / `delete` — manage
  per-tool default parameters and forced overrides for the tenant.

## 6. Subagents and A2A

### 6.1 Subagents (`dmrx_agent_*`)

DMR-X exposes each defined subagent as a dynamic MCP tool named
`dmrx_agent_<slug>` (see `services/mcp-server/src/server.ts`).

- On startup and then every 60s, the server fetches agent definitions from
  `GET /v1/agents` using the resolved tenant key.
- Each definition is registered as `dmrx_agent_<name>` with schema:
  `task: string`, `run?: boolean`.
- Calls are dispatched through `POST /v1/agentic/dispatch` and return the
  subagent result, including content, model, and usage.
- Stale subagent tools are unregistered and new ones are added live without
  restarting the MCP server.

Clients can discover available subagents by listing tools; subagent names come
directly from the gateway registry filtered by tenant.

### 6.2 A2A / federation

A2A is opt-in and served on the same HTTP port when enabled.

- `GET /.well-known/agent.json` — agent card discovery.
- `POST /a2a/tasks/send` — send a task; bridges A2A callers into the
  DMR-X subagent fleet via `/v1/agentic/dispatch`.
- `POST /a2a/tasks/get` — get task status.
- `POST /a2a/tasks/cancel` — cancel a task.
- `GET /a2a/tasks/{taskId}` — RESTful task lookup.

Federation adds multi-instance sharing via static peers, mDNS, or Consul. It
discovers remote tools and can proxy them into the local tool surface.

## 7. Evaluation, guardrails, and audit

### 7.1 Tool invocation policy / approval gates

The `ToolInvocationPolicyEngine` evaluates every tool call against tenant and
global policies stored in the database (`tool_invocation_policies`). Policies
support:

- `allow` / `deny` / `require_approval`
- wildcard tool matching and JSON-encoded input conditions
- priority ordering, tenant-specific and global fallback

Policy evaluations are logged to `tool_policy_audit_log` for review.

### 7.2 Guardrails

Guardrails run at multiple layers:

- Input validation (`InputValidator`) detects prompt injection, shell execution,
  path traversal, base64 encoded payloads, SQLi, and role confusion attempts
  before a tool runs.
- Response sanitization (`GuardrailsEngine`) redacts PII such as SSNs, credit
  card numbers, emails, phone numbers, IP addresses, and cloud/provider tokens.
- Content filtering against blocked keywords.

### 7.3 RBAC

RBAC is optional and configured via `DMRX_RBAC_ENABLED` / `rbac.enabled`. When
enabled, tool handlers check authorization before execution. Audit events are
emitted for approved, denied, and blocklisted invocations.

### 7.4 Audit logging

Audit logging captures tool invocations, RBAC decisions, policy evaluations,
and input validation results. Configuration includes:

- `audit.enabled`
- `audit.retentionDays`
- `audit.includeBodies`

### 7.5 Telemetry

The MCP server starts a telemetry service alongside routing for metrics and
tracing. Prometheus metrics and OTLP traces are available and help with
observability of executions, routing decisions, and upstream health.

## 8. Transports

The same process can serve any supported transport; choose with
`DMRX_MCP_TRANSPORT`.

### 8.1 stdio (default)

Plain stdio MCP. This is the mode for Claude Code, Cursor, and Continue. No
network ports are required.

### 8.2 SSE

`DMRX_MCP_TRANSPORT=sse`

Endpoints on the bound HTTP port:

- `GET /sse` — open an SSE session; auth via `DMRX_MCP_API_KEY`.
- `POST /messages?sessionId=...` — send messages for an existing session.
- `GET /health` — health and live session count.
- `GET /tools` — list current tools with `allowedTools` restriction.
- `GET /metrics` — Prometheus metrics.

### 8.3 HTTP / Streamable HTTP

`DMRX_MCP_TRANSPORT=http`

Endpoints on the bound HTTP port:

- `POST /mcp` — streamable HTTP MCP endpoint; client passes
  `Authorization: Bearer <key>` and `Mcp-Session-Id` for resume.
- `GET /health`, `GET /tools`, `GET /metrics` — same as SSE.

SSE and HTTP transports enforce `checkAuth()` using:

- `DMRX_MCP_API_KEY` / `DMRX_MCP_API_KEYS_CONFIG`
- per-key `allowedTools` restrictions
- timing-safe comparison

Production requires `DMRX_MCP_API_KEY`; stdio mode relies on local auth.

## 9. External MCP aggregation

Use `externalMcpClient` / `DMRX_MCP_CLIENT_SERVERS` to attach other MCP
servers. Their tools are re-exposed with a `<serverId>__<toolName>` namespace
and participate in tool search and RBAC/flags like native tools. The server
also auto-probes upstreams and reconnects dropped servers.

Example:

```bash
DMRX_MCP_CLIENT_SERVERS='[{"id":"github","name":"GitHub","transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github"]}]' \
DMRX_MCP_AGENT_API_KEY=<tenant-api-key> \
node services/mcp-server/dist/index.js
```

## 10. Quick-start examples

### 10.1 stdio zero-config

```bash
DMRX_GATEWAY_URL=http://localhost:3000 \
bun run services/mcp-server
```

### 10.2 stdio with explicit tenant isolation

```bash
DMRX_GATEWAY_URL=http://localhost:3000 \
DMRX_MCP_AGENT_API_KEY=<tenant-api-key> \
bun run services/mcp-server
```

### 10.3 HTTP with auth

```bash
DMRX_GATEWAY_URL=http://localhost:3000 \
DMRX_MCP_AGENT_API_KEY=<tenant-api-key> \
DMRX_MCP_TRANSPORT=http \
DMRX_MCP_API_KEY=<mcp-bearer-key> \
bun run services/mcp-server
```

Point your MCP client at `http://localhost:47114/mcp`, sending
`Authorization: Bearer <mcp-bearer-key>` and `Mcp-Session-Id` on resume.

## 11. Summary of the workflow

1. Start the DMR-X gateway and create/assign a tenant API key.
2. Start `services/mcp-server` with `DMRX_GATEWAY_URL` and the tenant key.
3. Connect an external MCP client to stdio or HTTP/SSE.
4. The client sees `dmrx_*` tools and `dmrx_agent_*` subagent tools.
5. Calls resolve tenant isolation per request/header, audit and guardrails are
   enforced, and durable context / A2A sessions can be resumed.
