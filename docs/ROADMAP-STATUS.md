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
- **Cluster scorer / multi-binding catalog / training pipeline** — 🔲 Planned (not confirmed in current tree).
- **Versioned A/B routing** — ✅ **Shipped** (router has versioned A/B strategies: least-busy, usage-based, latency-based, tag-based).

## MCP server (`services/mcp-server`)

- **Tools (stdio / SSE / HTTP)** — ✅ **Shipped**, **40+ tools** (routing, generation, context/memory,
  filesystem, skills, presets, templates, tool search). See `docs/MCP.md`.
- **A2A (Agent2Agent) agent cards** — ✅ **Shipped.**
- **RBAC engine** — ✅ **Shipped** (`DMRX_RBAC_ENABLED`).
- **Guardrails (PII redaction, content filtering)** — ✅ **Shipped** (`DMRX_GUARDRAILS_*`).
- **Audit logging** — ✅ **Shipped** (`DMRX_AUDIT_*`).
- **Federation** — ✅ **Shipped** (`DMRX_FEDERATION_*`).
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
- Migration count: **45 SQL migrations**. Test count: **54 unit test files** (50+ suites).
