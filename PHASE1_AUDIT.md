# Phase 1 Audit

## Summary

DMR-X is a TypeScript/Node monorepo for universal AI routing and orchestration. The main runtime is a Fastify gateway (`apps/gateway`) that exposes OpenAI/Anthropic-compatible routes, loads provider adapters, initializes SQLite-backed services, and routes requests through `@dmr-x/router`. The repo also includes shared core types, database utilities, provider registry/quota/policy/billing/telemetry services, an MCP server/client, tests, and a React/Vite admin UI.

## Languages And Runtime

- TypeScript, TSX, SQL, CSS, Markdown, Docker/YAML.
- Node.js ESM workspaces via npm; root `packageManager` is `npm@10.0.0`.
- React/Vite UI in `apps/ui`.
- Fastify gateway in `apps/gateway`.
- SQLite via `sql.js` in `packages/db`.

## Entry Points

- Gateway: `apps/gateway/src/main.ts`, `apps/gateway/src/server.ts`.
- UI: `apps/ui/src/main.tsx`, `apps/ui/src/App.tsx`.
- CLI: `packages/cli/src/index.ts`.
- MCP server: `services/mcp-server/src/index.ts`.
- Package barrels: `packages/*/src/index.ts`, `services/*/src/index.ts`.
- Tests: root `vitest.config.ts`, `tests/unit/*.test.ts`, `tests/e2e/*.test.ts`.

## Directory Inventory

- `apps/gateway`: Fastify API gateway and route handlers.
- `apps/ui`: active React admin console.
- `packages/core`: shared domain types and schemas.
- `packages/db`: SQLite client, cache, and migration SQL.
- `packages/utils`: cross-cutting utilities for logging, retries, streams, tools, errors, and state.
- `services/adapters`: provider adapter abstractions and concrete adapters.
- `services/router`: task classification, routing pipeline, fallback, sticky sessions, and decomposition.
- `services/registry`, `quota`, `policy`, `billing`, `benchmark`, `telemetry`, `mcp-*`: platform services.
- `tests`: unit and e2e tests.
- `proto ui/app`: duplicate/prototype UI tree outside npm workspaces.
- `.claude/worktrees`: local agent worktrees, not product source.

## Findings Before Cleanup

- Generated TypeScript artifacts are committed beside source: 816 `.js`, `.d.ts`, and source-map files under `src`, tests, and config outputs. These are build outputs and create duplicate GitNexus symbols.
- Thirteen `tsconfig.tsbuildinfo` files are present under package/service folders.
- `proto ui/app` is an orphaned duplicate UI project. It is not included in root workspaces and duplicates `apps/ui` heavily: 79 identical source/config files, 13 divergent files, and several extra UI primitives.
- Root Vitest config scans `**/*.test.ts`, so it tries to walk generated agent worktrees and inaccessible parent paths on this machine. This prevents tests from starting.
- TypeScript unused checks reported unused imports/locals in gateway, router, and UI:
  - `apps/gateway/src/converters/anthropic-converter.ts`
  - `apps/gateway/src/middleware/auth.middleware.ts`
  - `apps/gateway/src/routes/agentic.routes.ts`
  - `apps/gateway/src/routes/anthropic.routes.ts`
  - `apps/gateway/src/routes/chat.routes.ts`
  - `apps/gateway/src/routes/embeddings.routes.ts`
  - `apps/gateway/src/routes/images.routes.ts`
  - `apps/gateway/src/routes/tools.routes.ts`
  - `apps/gateway/src/server.ts`
  - `services/router/src/decomposer/composite-executor.ts`
  - `services/router/src/decomposer/task-decomposer.ts`
  - `services/router/src/fallback/fallback-executor.ts`
  - `services/router/src/pipeline/pipeline.ts`
  - `services/router/src/router.service.ts`
  - `apps/ui/src/pages/Settings.tsx`
- No test files with zero assertions were found.
- No obvious commented-out code blocks, `console.*`, `debugger`, `TODO`, `FIXME`, `XXX`, or `HACK` markers were found in product source.
- Environment variables referenced in code but missing from `.env.example`: `DMRX_DATA_DIR`, `DMRX_UI_DIR`, `DMRX_FREE_TIER_STRATEGY`, `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `STABILITY_BASE_URL`, `VITE_API_BASE`.
- Secret scan found no obvious committed literal API keys/tokens/passwords outside examples and docs.

## GitNexus Notes

- The index was stale and was refreshed with `npx gitnexus analyze --force`.
- GitNexus CLI `query` still reports missing FTS indexes after rebuild, so audit exploration used direct file reads, TypeScript checks, `context`, `impact`, and `detect-changes`.
- `Router` upstream impact is HIGH: 4 direct dependents, 3 affected processes, and 4 modules. Router edits must stay behavior-preserving.

## Needs Human Review

- Whether `proto ui/app` contains any prototype-only UI primitives that should be ported into `apps/ui` before removal.
- Whether `bun.lock` and Bun scripts are intentionally supported despite root `packageManager` being npm.
- Existing dirty worktree changes predated this audit and already produce a CRITICAL GitNexus `detect-changes` result across 207 files/775 symbols.
