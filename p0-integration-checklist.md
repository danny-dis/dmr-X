# P0 Integration Checklist

Started: 2026-05-28

## Goal
Wire the 3 highest-impact extracted modules into the adapter layer so every adapter gets retry, typed errors, and error classification for free.

## Modules to Integrate

- [x] **retries.ts** → `base.adapter.ts` — Wrapped `fetchWithTimeout()` with `withRetry()` for automatic retry on transient failures
- [x] **http-errors.ts** → `base.adapter.ts` — Replaced `new Error()` with `createHttpError()` for typed HTTP errors
- [x] **error-classifiers.ts** → `base.adapter.ts` — Using `isConnectionError()`, `isTimeoutError()` for error classification

## Files Modified

- [x] `services/adapters/src/base.adapter.ts` — Core changes (retry + error typing)
- [x] `services/adapters/src/openai/openai.adapter.ts` — Error handling with HttpError
- [x] `services/adapters/src/anthropic/anthropic.adapter.ts` — Error handling with createHttpError
- [x] `services/adapters/src/generic-openai/generic-openai.adapter.ts` — Error handling with HttpError
- [x] `services/adapters/src/ollama/ollama.adapter.ts` — Error handling
- [x] `services/adapters/src/replicate/replicate.adapter.ts` — Error handling
- [x] `services/adapters/src/stability/stability.adapter.ts` — Error handling
- [x] `services/adapters/src/elevenlabs/elevenlabs.adapter.ts` — Error handling
- [x] `services/adapters/src/deepgram/deepgram.adapter.ts` — Error handling
- [x] `services/adapters/src/cohere/cohere.adapter.ts` — Error handling
- [x] `services/adapters/src/jina/jina.adapter.ts` — Error handling

## Verification

- [x] `npx tsc --noEmit` passes on services/adapters (only pre-existing DOM/Node errors)
- [x] `npx tsc --noEmit` passes on packages/utils (only pre-existing event-stream.ts error)
- [x] No breaking changes to ProviderAdapter interface

## Progress

| Task | Agent | Status |
|------|-------|--------|
| retry + classifiers → base.adapter | Agent 1 | DONE |
| http-errors → base.adapter | Agent 2 | DONE |
| http-errors → all adapters | Agent 3 | DONE |
