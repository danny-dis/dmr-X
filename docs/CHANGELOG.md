# Changelog

## v0.3.0 — Documentation Overhaul & Gemini API (2026-06-01)

### Documentation
- Rewrote `README.md` with accurate Bun-first quickstart, architecture diagram, full API endpoint reference, meta-model aliases, and distribution section.
- Rewrote `docs/ARCHITECTURE.md` with accurate technology stack (SQLite, Bun, Fastify — no Redis/Postgres), detailed request flow diagram, package boundaries, adapter architecture, router pipeline stages, and security model.
- Rewrote `CLAUDE.md` as proper Claude Code project instructions (coding conventions, common gotchas, key files, architecture rules).
- Rewrote `docs/DEPLOYMENT.md` with Bun, Docker, binary, and reverse proxy configurations plus production checklist.
- Rewrote `docs/CONFIGURATION.md` with complete environment variable reference, all provider keys, and security notes.
- Created `docs/DISTRIBUTION.md` — binary packaging, install scripts, CI/CD release workflow.
- Created `docs/MCP.md` — MCP server setup, all 8 tools documented, client integration examples.
- Created `docs/TESTING.md` — test suites, running tests, type checking, known issues.
- Created `CONTRIBUTING.md` — contribution guidelines, branch naming, PR checklist.
- Moved historical audit reports to `docs/archive/` (PHASE1_AUDIT, QA_SECURITY_REPORT, REFACTOR_REPORT, agents checklist).
- Updated `docs/CHANGELOG.md` (this file).

### API
- Added Google Gemini native endpoint (`POST /v1/gemini/generateContent`) with streaming, tools, and thought tokens.
- Added meta-model aliases: `free`, `free-fast`, `free-smart`, `free-agentic`, `free-coding` for dynamic provider routing.
- Added OAuth provider authentication endpoints for Google, GitHub, HuggingFace, MiniMax.

### Routing
- Fixed `getCandidates()` to map `context_window` for meta-model resolution (free-agentic/free-coding always got 0 candidates).
- Router now throws 503 instead of silently falling back to paid models when meta-model resolution fails.
- Router direct model selection — matches `request.model` to candidate `modelId`.

### Adapters
- Added `PollinationsAdapter` for keyless image generation.
- Dynamic model loading with 5 bug fixes: activation, refresh, routing, consecutive_failures, hasKey.
- Startup sweep now covers ALL providers including keyless providers.

### UI
- Consolidated 20 routes into 10 tabbed pages.
- Settings page with 11 sections using left-nav pattern.
- ProviderKeys page rewritten with inline key editing, test, and save.
- Overview page fully dynamic — all data from API hooks, no hardcoded values.
- Deleted 85 stale `.js`/`.js.map` build artifacts from UI source.

### Infrastructure
- Cross-compile outputs use platform-specific names (`dmrx-linux`, `dmrx-darwin`, `dmrx-windows`).
- CI/CD release workflow triggers on `v*` tags, builds all platforms, publishes GitHub Release.
- Install scripts for Linux/macOS (`.tar.gz`) and Windows (`.zip`).

### Bug Fixes
- `billing_records` table now has `ON DELETE CASCADE` (was the only FK table without it).
- HTTP 204 No Content no longer crashes `res.json()` in request helper.
- Local mode admin auth — admin routes open when `LOCAL_MODE=true` OR no admin key set.
- Adapter UUID/name mismatch — router passes DB UUIDs, registry resolves to names.

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
