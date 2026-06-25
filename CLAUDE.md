# DMR-X — Project Instructions

## Session Start

1. `cd` to this directory.
2. Run `npx -y gitnexus@latest status`. If status reports `stale`
   or `missing`, run `npx -y gitnexus@latest analyze` before
   answering any question or making any change.
3. Honor the global code-intelligence rules in your local opencode
   config (`INSTRUCTIONS.md`) for all impact, detect_changes, query,
   context, and rename work.
4. If launching opencode from a fresh shell, prefer the `dmr` wrapper
   (on PATH) which guarantees a refresh of the index.

## Build / Commit Workflow

- Before editing any function, class, or method → run `gitnexus_impact`
  first and surface the blast radius to the user.
- Before any commit → run `gitnexus_detect_changes` and confirm only
  the expected symbols/flows are touched.
- For renames / extractions / moves → use `gitnexus_rename`, never
  find-and-replace.

## What This Is

DMR-X is a universal AI routing and orchestration platform. A single Fastify gateway accepts requests in OpenAI, Anthropic, and Gemini wire formats, routes them through a multi-stage pipeline to select the best provider, and returns responses in the original format. SQLite for persistence, Bun as primary runtime, zero external dependencies.

## Runtime

- **Primary:** Bun 1.0+ — use `bun run` for all scripts
- **Also works:** Node.js 18+ (but Bun is preferred)
- **Package manager:** Bun (see `package.json` `packageManager` field)
- **Monorepo:** npm workspaces managed by Turbo

## Key Commands

```bash
bun install              # Install dependencies
bun run dev:gateway      # Start gateway dev server (:3000)
bun run dev:ui           # Start UI dev server (Vite at :4200)
bun run build            # Build all packages + UI
bun run start            # Start production gateway
bun run test             # Run unit tests (vitest)
bun run lint             # Lint all packages
```

**Note:** `bun --watch` works correctly with sql.js (fixed since v0.2.0). Use `bun run dev:gateway` for local dev.

**Build quirk:** `turbo build` can fail on Windows. Build each package individually with `bun run build` if needed.

## Project Structure

| Path | What It Is |
|------|-----------|
| `apps/gateway/src/server.ts` | Fastify server setup, plugin registration, route mounting |
| `apps/gateway/src/main.ts` | Entry point — init SQLite, start server |
| `apps/gateway/src/routes/` | Route handlers (chat, admin, models, anthropic, gemini, etc.) |
| `apps/gateway/src/middleware/` | Auth, request-id, rate limiting |
| `apps/gateway/src/converters/` | Wire format ↔ UnifiedRequest converters |
| `apps/ui/src/pages/` | React pages (Dashboard, Providers, Models, Tenants, Settings, etc.) |
| `packages/core/src/` | Shared types (UnifiedRequest, UnifiedResponse, provider types) |
| `packages/db/src/` | SQLite client, migrations, cache |
| `packages/utils/src/` | Logging (pino), retries, streams, crypto, errors |
| `packages/cli/src/` | CLI tool commands (init, add-provider, status, test) |
| `services/adapters/src/` | Provider adapters (openai, anthropic, ollama, generic-openai, etc.) |
| `services/router/src/` | Routing pipeline, classifier, fallback, bandit |
| `services/mcp-server/src/` | MCP tool server (tools.ts has tool definitions) |
| `tests/unit/` | Unit test suites (41 files) |

## Coding Conventions

- **TypeScript ESM** — all packages use `"type": "module"`, import with `.js` extensions in relative imports
- **No `.ts` extensions in imports** — TypeScript resolves `.js` to `.ts` automatically
- **Stale `.js` in source** — Bun resolves `.js` before `.ts`. If you see stale `.js`/`.d.ts`/`.js.map` files alongside `.ts` source, they are build artifacts that should be deleted. They cause the runtime to execute old code.
- **Package barrels** — each package exports from `src/index.ts`
- **No `@ts-nocheck`** — fix type errors properly
- **Zod schemas** — use Zod for input validation on admin endpoints
- **Parameterized SQL** — never interpolate user input into SQL strings
- **`?? null` for nullable** — sql.js rejects `undefined` bindings; use `?? null` for nullable columns, `?? 0` for NOT NULL DEFAULT columns

## Architecture Rules

- `packages/*` never depends on `services/*` or `apps/*`
- `services/*` never depends on `apps/*`
- `apps/gateway` is the only entry point that wires everything together
- Shared types live in `packages/core`, not duplicated across services
- Provider adapters implement the interface in `services/adapters/src/adapter.interface.ts`

## Database

- SQLite via `sql.js` (WebAssembly, no native deps)
- Data stored at `~/.dmr-x/data.db` (configurable via `DMRX_DATA_DIR`)
- Migrations in `packages/db/src/migrations/` run on startup
- **Debounced save** — 100ms window, `flush()` for shutdown
- **`CREATE TABLE IF NOT EXISTS`** — migration runner catches duplicate column errors gracefully

## Common Gotchas

- **Adapter UUID vs Name** — the router passes DB UUIDs to `adapterRegistry.get()` which is keyed by name. The registry resolves UUID → name internally.
- **HTTP 204 breaks `res.json()`** — DELETE endpoints return 204 No Content. The `request()` helper must check status before calling `.json()`.
- **`pino-pretty` crashes Bun** — disabled at runtime when Bun is detected.
- **Local mode** — `DMRX_LOCAL_MODE=true` skips tenant API key auth. Admin routes are open when LOCAL_MODE=true OR no admin key is set.
- **Turbo concurrency** — `turbo dev` fails at default concurrency 10 with 16 persistent tasks. Use `--concurrency=20`.
- **Meta-model fallback** — router throws 503 when meta-model resolution fails, never silently falls back to paid models.
- **Provider seeding** — autoRegister runs before provider loading at startup. Keyless providers (ollama, vllm, llamacpp) are re-activated at startup if health checker marked them unhealthy.

## Environment

Copy `.env.example` to `.env`. Key variables:

- `DMRX_LOCAL_MODE=true` — local dev, skip auth
- `DMRX_ADMIN_API_KEY` — admin route auth (required in production)
- `DMRX_ENCRYPTION_KEY` — AES-256-GCM key for provider key encryption
- `PORT=3000` — gateway port
- `VITE_API_BASE=` — empty for same-origin UI API calls

See `docs/CONFIGURATION.md` for the full reference.

## Testing

```bash
bun run test                                    # All unit tests
DMRX_RUN_E2E=true bun run test -- tests/e2e/   # E2E (requires running gateway)
```

Unit tests cover: routing pipeline, anthropic converter/stream, API contracts, auth middleware, task classifier, tool orchestrator, SQLite client, memory cache, crypto, meta-models, event streams, HTTP errors.

**Vitest issue on Windows + Node v24:** vitest/tinypool spawn fails with UNKNOWN. Use `npx tsc` directly for type checking instead.

## Documentation

When updating docs, keep them accurate to the actual codebase state. The authoritative docs are:

- `README.md` — project overview and quickstart
- `docs/ARCHITECTURE.md` — technical architecture
- `docs/API_USAGE_GUIDE.md` — API usage with SDK examples
- `docs/CONFIGURATION.md` — environment variable reference
- `docs/DEPLOYMENT.md` — deployment guide
- `docs/DISTRIBUTION.md` — binary packaging
- `docs/MCP.md` — MCP server documentation
- `docs/TESTING.md` — testing guide

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **dmr-X** (6080 symbols, 14520 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/dmr-X/context` | Codebase overview, check index freshness |
| `gitnexus://repo/dmr-X/clusters` | All functional areas |
| `gitnexus://repo/dmr-X/processes` | All execution flows |
| `gitnexus://repo/dmr-X/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
