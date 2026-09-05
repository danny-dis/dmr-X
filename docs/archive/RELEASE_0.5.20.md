# Release 0.5.20 — CI Pipeline Green & E2E Resilience

**Date:** 2026-09-05

## Summary

CI pipeline fully green after fixing type errors, migrating date formats to ISO 8601, and gating E2E tests that require API keys. All 1,425 unit tests passing, typecheck clean, security audit passing, and E2E resilient in CI without secrets.

## CI Pipeline Fixes
- **Type errors resolved** — fixed `AgentExecution` import, skill-capture null guard, `Briefcase` import, jobs mutation return types.
- **A2A agent card test** — fixed `url` field to use bare origin (`resolvedUrl` not `rpcUrl`).
- **Usage-tracker dates** — migrated `createdAt` from custom `YYYY-MM-DD HH:MM:SS` format to ISO 8601 UTC. Test expectations updated to match.
- **getLatestExecution → listExecutions(..., 1)** — fixed in `agent-chat.routes.ts` (method didn't exist).
- **Security audit** — bumped `vitest`, `browserslist`, `fast-uri`, and other deps to close CVEs.

## E2E Test Resilience
- **Provider integration tests gated on `hasProviders`** — tests self-skip when CI has no `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, or `POLLINATIONS_ENABLED` set. Previously these returned HTTP 503 and failed CI.
- **Model-list assertion gated** — `providers.test.ts` now skips (rather than fails) when no providers are registered.
- **Agent integration tests gated** — all Codex/OpenCode chat-completion tests skip cleanly in CI without keys.

## Verification
- **Unit tests:** 1,425 passing ✓
- **Typecheck:** passing ✓
- **Security audit:** passing ✓
- **E2E:** 27 passed (provider-integration tests gated/skipped in CI without keys) ✓

## Known Limitations
- Provider integration tests (Codex, OpenCode, Pollinations, Google Gemini, OpenRouter) only execute when real API keys are present in the environment. CI cannot exercise them without secrets. They remain valid for local testing with credentials.

## Version
- All 36 workspace packages bumped to `0.5.20`.
- Helm chart `appVersion` set to `0.5.20`.
