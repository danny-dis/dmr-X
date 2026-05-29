# DMR-X

Universal AI routing and orchestration platform for OpenAI-compatible, Anthropic-compatible, multimodal, and MCP workflows.

## What It Does

DMR-X runs a Fastify gateway that accepts AI requests, classifies the task, selects the best available provider/model, executes with fallback, and exposes admin/UI surfaces for providers, models, quotas, routing, billing, telemetry, and policy controls.

## Architecture

This is an npm workspace TypeScript monorepo:

- `apps/gateway`: HTTP API gateway and static UI host.
- `apps/ui`: React/Vite admin console.
- `packages/core`: shared request, response, routing, modality, provider, and error types.
- `packages/db`: SQLite client, cache, and migrations.
- `packages/utils`: logging, retries, streams, tools, state, and errors.
- `services/adapters`: provider adapter interface and concrete adapters.
- `services/router`: task classifier, routing pipeline, fallback, sticky sessions, and decomposition.
- `services/registry`, `quota`, `policy`, `billing`, `benchmark`, `telemetry`: platform services.
- `services/mcp-server`, `services/mcp-client`: MCP integration.
- `tests`: unit tests and opt-in e2e connectivity tests.

## Prerequisites

- Node.js 18 or newer.
- npm 10 or newer.
- Windows PowerShell, cmd, Bash, or another shell capable of running npm scripts.

## Installation

```bash
npm install
cp .env.example .env
```

Set at least one provider key in `.env`, or use local/free providers such as Ollama where available.

## Configuration

All supported environment variables are documented in `.env.example` and `docs/CONFIGURATION.md`.

Important defaults:

- `PORT=3000`
- `DMRX_LOCAL_MODE=true` for local single-user development
- `DMRX_FREE_TIER_STRATEGY=none`
- `VITE_API_BASE=` for same-origin UI API calls

## Usage

```bash
npm run dev          # run workspace dev tasks
npm run dev:gateway  # gateway only
npm run dev:ui       # UI only
npm run build        # production build
npm run start        # start built gateway
npm run test         # unit/default tests
```

E2E connectivity tests are opt-in because they require a running gateway:

```bash
DMRX_RUN_E2E=true npm run test -- tests/e2e/connectivity.test.ts
```

## API Reference

Gateway endpoints include:

- `GET /health`, `/healthz`, `/ready`, `/livez`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/messages`
- `POST /v1/images/generations`
- `POST /v1/embeddings`
- `POST /v1/audio/*`
- `POST /v1/tools/execute`
- `POST /v1/tools/loop`
- `POST /v1/agentic/chat`
- `GET/POST/PUT /v1/admin/*`

The MCP server exposes `dmrx_chat`, `dmrx_generate_image`, `dmrx_embed`, `dmrx_transcribe`, `dmrx_speak`, `dmrx_rerank`, `dmrx_models`, and `dmrx_status`.

## Testing

```bash
npm run test
```

Current default coverage focuses on routing pipeline behavior, classifiers, Anthropic conversion/streaming, utility stream helpers, tool orchestration, memory cache, HTTP errors, SQLite client behavior, and meta-model resolution.

## Contributing

- Branch names: `feature/<topic>`, `fix/<topic>`, `refactor/<topic>`, `docs/<topic>`.
- Run `npm run test` and `npm run build` before opening a PR.
- Keep generated files out of source folders; build outputs belong in `dist/` or `apps/gateway/public/`.
- Prefer behavior-preserving refactors and small commits by phase.
- Follow existing TypeScript ESM style and package boundaries.

## License

No license is currently declared. Add a `LICENSE` file before public distribution.
