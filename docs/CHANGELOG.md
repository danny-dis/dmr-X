# Changelog

## v0.2.0 — Production Hardening (2026-05-30)

### Security
- API keys encrypted at rest (AES-256-GCM via `@dmr-x/utils` crypto module).
- MCP server requires authentication (`DMRX_MCP_API_KEY`).
- Prototype pollution protection on settings endpoint (Zod schema validation).
- CORS uses explicit origin allowlist, never wildcard.
- CSP, X-Frame-Options, HSTS, and other security headers added.
- 500+ error responses sanitized — no internal details leak to clients.
- Timing-safe comparisons for API key verification.

### Infrastructure
- Migrated primary runtime from Node.js to Bun.
- Dockerfile uses `oven/bun:1-alpine` with multi-stage build and resource limits.
- SQLite via `sql.js` with debounced saves and shutdown flush.
- Removed Redis/Postgres dependencies — zero external infrastructure required.

### Adapters
- 10 provider adapters: OpenAI, Anthropic, Ollama, Replicate, Stability, ElevenLabs, Deepgram, Cohere, Jina, GenericOpenAI.
- Unified adapter registry with health checking and automatic failure tracking.
- GenericOpenAIAdapter for any OpenAI-compatible provider.

### Gateway
- Anthropic Messages API endpoint (`POST /v1/messages`) alongside OpenAI format.
- Admin routes for provider management, tenant keys, and settings.
- Agentic chat with approval gates (`POST /v1/agentic/chat`).
- Tool execution and multi-turn tool loops.
- Rate limiting, request ID middleware, and SPA fallback for UI.

### MCP
- MCP server with stdio, SSE, and streamable HTTP transports.
- Tools: `dmrx_chat`, `dmrx_generate_image`, `dmrx_embed`, `dmrx_transcribe`, `dmrx_speak`, `dmrx_rerank`, `dmrx_models`, `dmrx_status`.

### Testing
- 262+ unit tests passing.
- Opt-in E2E connectivity tests (`DMRX_RUN_E2E=true`).
- QA/security audit completed — 142 findings cataloged, all CRIT+HIGH resolved.

### Documentation
- Rewrote README, architecture, configuration, and deployment docs.
- Added AI provider reference catalogs (100+ providers documented).
- Added BSL-1.1 license with CLA.

## v0.1.0 — Refactor Baseline

- Removed generated TypeScript artifacts from source folders.
- Removed orphaned prototype UI source.
- Tightened test discovery and generated-file ignores.
- Fixed unused imports and locals reported by TypeScript.
- Simplified MCP server tool registration types.
- Rewrote environment documentation and production setup docs.
