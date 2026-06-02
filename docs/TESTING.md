# Testing

DMR-X uses [Vitest](https://vitest.dev/) for unit testing with opt-in end-to-end connectivity tests.

## Quick Start

```bash
bun run test
```

## Unit Tests

18 test suites in `tests/unit/`:

| Test File | Covers |
|-----------|--------|
| `pipeline.test.ts` | Routing pipeline stages |
| `capability-filter.test.ts` | Model capability matching |
| `availability-filter.test.ts` | Provider health filtering |
| `cost-latency-scorer.test.ts` | Cost/latency/quality scoring |
| `final-selector.test.ts` | Epsilon-greedy selection |
| `task-classifier.test.ts` | Task classification (modality + capabilities) |
| `anthropic-converter.test.ts` | OpenAI ↔ Anthropic format conversion |
| `anthropic-stream-serializer.test.ts` | Anthropic SSE streaming |
| `api-contracts.test.ts` | API response shape validation |
| `auth-middleware.test.ts` | API key authentication |
| `tool-orchestrator.test.ts` | Tool execution and loops |
| `conversation-state.test.ts` | Conversation state management |
| `sqlite-client.test.ts` | SQLite client behavior |
| `memory-cache.test.ts` | In-memory cache operations |
| `crypto.test.ts` | AES-256-GCM encryption/decryption |
| `meta-models.test.ts` | Meta-model alias resolution |
| `event-stream.test.ts` | Stream utility helpers |
| `http-errors.test.ts` | HTTP error creation and formatting |
| `stop-conditions.test.ts` | Stop condition evaluation |
| `stream-transformers.test.ts` | Stream transformation utilities |

## E2E Tests

End-to-end connectivity tests require a running gateway:

```bash
# Start the gateway first
bun run dev:gateway

# In another terminal, run E2E tests
DMRX_RUN_E2E=true bun run test -- tests/e2e/connectivity.test.ts
```

E2E tests are skipped by default because they need a live gateway and valid provider keys.

## Running Specific Tests

```bash
# Run a specific test file
bun run test -- tests/unit/crypto.test.ts

# Run tests matching a pattern
bun run test -- -t "encryption"

# Watch mode
bun run test:watch
```

## Test Configuration

Root `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.turbo'],
  },
});
```

## Writing Tests

Tests follow standard Vitest patterns:

```typescript
import { describe, it, expect } from 'vitest';

describe('feature', () => {
  it('should do something', () => {
    const result = myFunction(input);
    expect(result).toBe(expected);
  });
});
```

### Guidelines

- Test files go in `tests/unit/` (mirroring the module structure)
- Use `describe` blocks to group related tests
- Test both happy path and error cases
- Use real implementations where possible; mock only external services
- Keep tests fast — unit tests should complete in seconds

## Type Checking

Run TypeScript type checking without emitting files:

```bash
# Gateway
npx tsc -p apps/gateway/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters

# Router
npx tsc -p services/router/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters

# UI
npx tsc -p apps/ui/tsconfig.app.json --noEmit
```

## Known Issues

- **Vitest on Windows + Node v24:** `vitest/tinypool` spawns fail with `UNKNOWN` error. Use `npx tsc` for type checking instead. Bun runtime works fine.
- **Stale `.js` in source:** If tests behave unexpectedly, check for stale `.js` files alongside `.ts` source. Bun resolves `.js` before `.ts`, so stale build artifacts can cause tests to run against old code. Delete all `.js`, `.d.ts`, and `.js.map` files from `src/` directories.
