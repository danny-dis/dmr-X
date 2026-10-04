# DMR-X Hosted Agent Platform v1

Date: 2026-10-03

## Why this slice

DMR-X already had an agent registry, durable conversation sessions, a persisted scheduler, an MCP aggregation registry, and an agentic dispatch surface. The missing product boundary was a durable hosted agent instance: a reusable identity that survives gateway restarts while compute only runs when work arrives.

Current industry patterns reinforce that split. Vercel eve treats each agent as a durable workflow/session and separates the agent harness from sandboxed compute. Cloudflare's current Agents + Workflows guidance similarly separates a long-lived agent identity from durable run-to-completion workflows, with persisted steps, retries, sleep, and event wakeups.

## Implemented

- Agent instances now have durable `runtimeMode`: `persistent` or `ephemeral`.
- Agent instances now have durable `accessScope`: `shared` or `private`.
- Agent instances now persist an explicit lifecycle: `ready`, `running`, `paused`, `draining`, `stopped`, or `retired`, plus the existing provisioning states.
- Lifecycle policy is persisted with independent TTL, idle-timeout, and budget controls. Persistent instances default to no TTL/idle expiry; ephemeral instances retain the previous 30-minute / 5-minute / $1-style bounds.
- Gateway endpoints expose runtime state and allow wake, sleep, configuration changes, and retirement without deleting the identity.
- Chat turns wake a ready identity and park it back to ready when the turn ends. Durable conversation state remains in SQLite.
- Name/intent discovery only resolves `shared` instances. Private instances remain directly addressable by exact instance id.
- The MCP agent discovery tools now query only shared instances.
- The intent dispatcher now only selects shared instances.
- Scheduled jobs persist an `agentInstanceId` and reuse one persistent private instance across fires instead of spawning a new instance every run.

## API shape

`POST /v1/agents/:id/deploy` now accepts:

```json
{
  "runtimeMode": "persistent",
  "accessScope": "shared",
  "lifecyclePolicy": {
    "maxTtlMs": null,
    "idleTimeoutMs": null,
    "maxBudgetCents": null
  }
}
```

Runtime control:

- `GET /v1/agents/instances/:id/runtime`
- `PUT /v1/agents/instances/:id/runtime`
- `POST /v1/agents/instances/:id/wake`
- `POST /v1/agents/instances/:id/sleep`
- `POST /v1/agents/instances/:id/retire`

`POST /v1/agents/:instanceId/chat` continues to be the main execution interface.

## Product semantics

An agent definition is the blueprint. An agent instance is the hosted identity. A conversation is durable state attached to an instance. A run is compute.

```text
definition
   |
   +--> persistent instance A ---> many conversations / runs
   +--> persistent instance B ---> private personal session
   +--> ephemeral instance C ----> short-lived subagent work
```

DMR-X remains the gateway and runtime host. It does not become the business agent or add a second model router.

## Research references

- Vercel eve: https://vercel.com/blog/introducing-eve
- Vercel eve overview: https://vercel.com/eve
- Cloudflare durable AI agents: https://developers.cloudflare.com/workflows/get-started/durable-agents/
- Cloudflare Agents + Workflows: https://developers.cloudflare.com/agents/concepts/workflows/

## Next slices

1. Add actor-level ACLs so `private` and `shared` can be enforced between users inside the same tenant, not only between discovery and exact-id access.
2. Add a durable event/wakeup inbox so a persistent instance can subscribe to webhooks, MCP events, and A2A messages without creating a new application process.
3. Add worker/sandbox leases for long-running tool execution; keep the hosted identity in SQLite while compute can move between local process, container, microVM, or another worker.
4. Add an explicit session/channel binding so a personal or group agent can keep one durable conversation across Web, MCP, A2A, and API surfaces.
5. Add an optional workflow backend for multi-step jobs that need step-level retry/idempotency beyond the current request/session loop.