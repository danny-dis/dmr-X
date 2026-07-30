# DMR-X — Feature & Roadmap Status

> This document consolidates the former planning/verification docs
> (`AGENT-INTEGRATION-PLAN.md`, `WORKWEAVE-BORROW-PLAN.md`, `WIRING-VERIFICATION.md`,
> and `services/mcp-server/docs/PHASE3-FEATURES.md`) into a single status checklist.
>
> **Legend:** ✅ Shipped · 🟡 Partial / verify · 🔲 Planned / not wired.

## Agent integrations

- **Codex (OpenAI CLI)** — ✅ **Shipped.** Codex works by pointing `OPENAI_BASE_URL` at DMR-X's
  existing `POST /v1/chat/completions` (OpenAI format). No gateway changes required.
- **Antigravity (Google Cloud Code / `agy`)** —
  - Outbound `antigravity` adapter: ✅ **Shipped** (in `services/adapters`).
  - Inbound Cloud Code protocol (`/cloudcode/*`): ✅ **Shipped.** The Antigravity
    protocol paths contain a literal colon (e.g. `/v1internal:streamGenerateContent`);
    Fastify's router (find-my-way) hangs on `:` path params, so `cloudcode.routes.ts`
    registers a single wildcard route (`POST /v1internal*`) and dispatches on the raw
    URL. Registered in `server.ts`.

## workweave/router "borrow" plan

- **Semantic response cache** — ✅ **Shipped** (`services/cache` / `SemanticCacheService`).
- **Install CLI commands (`dmrx setup/off --claude|--opencode|--codex|--cursor`)** — ✅ **Shipped** (`packages/cli`).
- **Handover summarization** — ✅ **Shipped** (`services/router/src/handover/handover-summarizer.ts`).
- **STAY vs SWITCH planner** — ✅ **Shipped** (`services/router/src/planner/ev-planner.ts` +
  `sticky-session-handler.ts`, wired into `router.service`).
- **Cluster scorer / multi-binding catalog / training pipeline** — ⚠️ **Scaffolded but
  disconnected**. `services/router/src/cluster/cluster-scorer.ts` exists and is
  initialized at router boot, but `getClusterScorer()` has no callers and
  `pipeline.ts` has no `cluster` strategy branch — so `DMRX_CLUSTER_ROUTING_ENABLED`
  changes no routing behaviour, it only loads an ONNX session at startup.
- **Versioned A/B routing** — ✅ **Shipped** (router has versioned A/B strategies: least-busy, usage-based, latency-based, tag-based).

## MCP server (`services/mcp-server`)

- **Tools (stdio / SSE / HTTP)** — ✅ **Shipped**, **40+ tools** (routing, generation, context/memory,
  filesystem, skills, presets, templates, tool search). See `docs/MCP.md`.
- **A2A (Agent2Agent) agent cards** — ✅ **Shipped.**
- **RBAC engine** — ✅ **Shipped** (`DMRX_RBAC_ENABLED`).
- **Guardrails (PII redaction, content filtering)** — ✅ **Shipped** (`DMRX_GUARDRAILS_*`).
- **Audit logging** — ✅ **Shipped** (`DMRX_AUDIT_*`).
- **Federation** — ⚠️ **Partial** (`DMRX_FEDERATION_*`). Peer registration, health
  probing and benchmark sync are live. Cross-instance *request routing* is not:
  `services/federation/src/routing.ts` (`FederationRouter.routeRequest`) is exported
  but has no callers, so peers can be registered and shown healthy while no traffic
  can ever be routed to them.
- **Hybrid tool search (BM25 + semantic, RRF)** — ✅ **Shipped** (`services/tool-search`, `DMRX_TOOL_SEARCH_*`).

## Kubernetes / Operator (formerly "PHASE3-FEATURES")

- **Helm chart** — ✅ **Shipped** (`helm/dmr-x`).
- **Kubernetes Operator** — ✅ **Shipped** (`services/operator`).
- **Workflow engine (CRDs / Workflow API)** — ✅ **Shipped** (`services/operator`: `WorkflowSpec` +
  `generateWorkflowManifest()`; CRDs in `helm/`).

## Wiring verification

The gateway mounts all routes, adapters, and MCP tools in `apps/gateway/src/server.ts`.
The previous `WIRING-VERIFICATION.md` hard-coded `server.ts` line numbers that **drift as the file
changes** — treat it as historical. To re-verify, grep `server.ts` for `server.register(...)`
and confirm each plugin is mounted.

As of v0.5.7 the gateway exposes **200+ live routes**; `prompt.routes`, `cloudcode.routes`,
and all agent/MCP/federation routes are **registered** in `server.ts`.

## Quick facts

- Provider adapter count is **57+** (not 18). See `docs/AI_PROVIDER_REFERENCE.md`.
- Provider catalogs are *research snapshots* (mid-2026) — verify against upstream provider docs before use.
- Migration count: **63 SQL migrations**. Test count: **73 unit test files**, plus 4 E2E
  files that are skipped unless `DMRX_RUN_E2E=true` (CI never sets it). `apps/ui` has
  **no tests at all**.
