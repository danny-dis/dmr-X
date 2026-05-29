# Architecture

DMR-X is a TypeScript npm-workspace monorepo. The gateway is the runtime entry point, the router owns model selection, adapters isolate provider I/O, and shared packages keep request/response contracts consistent.

## Request Flow

1. `apps/gateway/src/main.ts` initializes SQLite and starts Fastify.
2. `apps/gateway/src/server.ts` registers adapters, loads provider candidates, starts health checks, attaches auth/request-id middleware, and mounts routes.
3. Route handlers convert OpenAI/Anthropic-style payloads into `UnifiedRequest`.
4. `services/router` classifies the task, filters candidates, scores cost/latency/quality, applies policies/quotas/rate limits, and creates a fallback plan.
5. The gateway adapter executor calls the selected provider adapter.
6. Responses are converted back to the requested wire format.

## Package Boundaries

- `packages/core`: shared types only.
- `packages/db`: persistence primitives and migrations.
- `packages/utils`: cross-cutting helpers.
- `services/adapters`: provider-specific I/O.
- `services/router`: selection and fallback logic.
- `services/*`: domain services used by the gateway and admin UI.

## UI

`apps/ui` is a Vite React application. Its production build outputs to `apps/gateway/public`, which the gateway serves as a static SPA.

## MCP

`services/mcp-server` wraps DMR-X routing in MCP tools and supports stdio, SSE, and streamable HTTP transports.
