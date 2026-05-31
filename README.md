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
- `packages/cli`: CLI tool (`dmrx` command) for init, providers, status, and testing.
- `services/adapters`: provider adapter interface and concrete adapters.
- `services/router`: task classifier, routing pipeline, fallback, sticky sessions, and decomposition.
- `services/registry`, `quota`, `policy`, `billing`, `benchmark`, `telemetry`: platform services.
- `services/mcp-server`, `services/mcp-client`: MCP integration.
- `tests`: unit tests and opt-in e2e connectivity tests.

## Prerequisites

- [Bun](https://bun.sh) 1.0 or newer (primary runtime). Node.js 18+ also works but Bun is recommended.
- npm 10 or newer (for workspace management).
- Windows PowerShell, cmd, Bash, or another shell capable of running npm scripts.

## Installation

```bash
bun install
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
bun run dev          # run workspace dev tasks
bun run dev:gateway  # gateway only
bun run dev:ui       # UI only
bun run build        # production build
bun run start        # start built gateway
bun run test         # unit/default tests
```

E2E connectivity tests are opt-in because they require a running gateway:

```bash
DMRX_RUN_E2E=true bun run test -- tests/e2e/connectivity.test.ts
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
bun run test
```

Current default coverage focuses on routing pipeline behavior, classifiers, Anthropic conversion/streaming, utility stream helpers, tool orchestration, memory cache, HTTP errors, SQLite client behavior, and meta-model resolution.

## Contributing

- Branch names: `feature/<topic>`, `fix/<topic>`, `refactor/<topic>`, `docs/<topic>`.
- Run `bun run test` and `bun run build` before opening a PR.
- Keep generated files out of source folders; build outputs belong in `dist/` or `apps/gateway/public/`.
- Prefer behavior-preserving refactors and small commits by phase.
- Follow existing TypeScript ESM style and package boundaries.
- **All contributors must sign the [CLA](CLA.md) before contributions can be merged.**

## License

This project is licensed under the Business Source License 1.1 (BSL-1.1).

### Free Use Tier

This software is free for production use by organizations with **50 or fewer individual users** who can access, use, or benefit from the software.

### Commercial Use

Organizations exceeding 50 users must contact the maintainers for a commercial license. See [LICENSE](LICENSE) for contact details.

### Open Source Conversion

On **2030-05-30** (4 years from initial release), this software will automatically convert to the GNU Affero General Public License v3.0 (AGPL-3.0).

### For Contributors

All contributors must sign the [Contributor License Agreement](CLA.md) before their contributions can be merged. See [CLA.md](CLA.md) for details.

### License Terms

- **Production use**: Free for organizations with ≤50 users
- **Non-production use**: Unlimited (development, testing, evaluation)
- **Derivative works**: Must comply with BSL-1.1 terms
- **After 2030-05-30**: Converts to AGPL-3.0

For the full license text, see [LICENSE](LICENSE).
