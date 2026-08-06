# Release 0.5.12 — Godmode Relay & DB Singleton

**Date:** 2026-07-23

## Summary

Godmode relay mode (no OpenRouter key needed), DB globalThis singleton fix, provider key seeding from .env, and model discovery enrichment.

## Features

- **Godmode relay mode** — G0DM0D3 relays LLM calls through DMR-X itself via `llmBaseUrl`/`llmApiKey`. `GODMODE_RELAY=1` env var signals internal proxy mode. Rate-limit middleware skips limiting in relay mode.
- **DB globalThis singleton** — `@dmr-x/db` stores sql.js handle on `globalThis` so multiple bun workspace copies share one in-memory database. Fixes gateway/server-manager visibility gap.
- **Provider key seeding** — `seedEnvKeysToProviderKeys()` upserts Default key rows for providers with `envKey` set in `.env` on boot. Idempotent, survives DB wipes.
- **Meta-model godmode flag** — `auto-free` routes through G0DM0D3 proxy for persona wrapping. `auto-eco` is free-only.
- **Model discovery enrichment** — discovered models enriched with catalog data (costs, context, capabilities). New `POST /admin/providers/:id/discover` endpoint.
- **Batch free verification** — `POST /admin/providers/:id/verify-free-batch` probes models with minimal chat completions.
- **DMRX_FREE_PROVIDERS auto-classification** — models classified as free at boot from env var.

## Fixes

- Agent chat: evaluation logic removed, `runtime`/`conversationId` added to context.
- Godmode routes: accept `llmBaseUrl`/`llmApiKey` on install/start, auto-initialize proxy.
- Server manager: constructs return object directly (sql.js read-back inconsistency fix).
- Version bumped all 35 workspace packages to 0.5.12.

## Known Issues

- 3 high-severity dependency vulnerabilities (opentelemetry/propagator-jaeger, fast-uri, brace-expansion) — documented in SECURITY.md, requires upstream patches.
