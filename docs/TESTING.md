# Testing

DMR-X uses [Vitest](https://vitest.dev/) for unit testing with opt-in end-to-end connectivity tests.

## Quick Start

```bash
bun run test
```

## Unit Tests

54 test files (50+ suites) in `tests/unit/` — a representative subset is listed below:

| Test File | Covers |
|-----------|--------|
| `pipeline.test.ts` | Routing pipeline stages |
| `capability-filter.test.ts` | Model capability matching |
| `availability-filter.test.ts` | Provider health filtering |
| `cost-latency-scorer.test.ts` | Cost/latency/quality scoring |
| `final-selector.test.ts` | Epsilon-greedy selection |
| `task-classifier.test.ts` | Task classification (modality + capabilities) |
| `router-provider-prefix.test.ts` | Provider prefix routing and meta-model scoping |
| `anthropic-converter.test.ts` | OpenAI ↔ Anthropic format conversion |
| `anthropic-stream-serializer.test.ts` | Anthropic SSE streaming |
| `anthropic-adapter.test.ts` | Anthropic adapter behavior |
| `openai-adapter.test.ts` | OpenAI adapter behavior |
| `ollama-adapter.test.ts` | Ollama adapter behavior |
| `ocr-adapter.test.ts` | OCR adapter behavior |
| `audio-separation-adapter.test.ts` | Audio separation adapter |
| `api-contracts.test.ts` | API response shape validation |
| `admin-validation.test.ts` | Admin input validation |
| `auth-middleware.test.ts` | API key authentication |
| `tool-orchestrator.test.ts` | Tool execution and loops |
| `conversation-state.test.ts` | Conversation state management |
| `conversation-routes-tenant-isolation.test.ts` | Tenant isolation on conversation routes |
| `sqlite-client.test.ts` | SQLite client behavior |
| `migration-checksum.test.ts` | Migration checksum verification |
| `memory-cache.test.ts` | In-memory cache operations |
| `rate-limiter.test.ts` | Rate limiting |
| `circuit-breaker.test.ts` | Circuit breaker pattern |
| `crypto.test.ts` | AES-256-GCM encryption/decryption |
| `meta-models.test.ts` | Meta-model alias resolution |
| `mcp-config.test.ts` | MCP configuration resolution |
| `mcp-tool-restrictions.test.ts` | MCP tool restriction enforcement |
| `model-discovery.test.ts` | Local provider model discovery |
| `event-stream.test.ts` | Stream utility helpers |
| `http-errors.test.ts` | HTTP error creation and formatting |
| `stop-conditions.test.ts` | Stop condition evaluation |
| `stream-transformers.test.ts` | Stream transformation utilities |
| `worker-pool-fanout.test.ts` | Worker pool fan-out |
| `bandit-reward-signals.test.ts` | Thompson sampling reward signals |
| `otel-spans.test.ts` | OpenTelemetry span emission |
| `telemetry-integration.test.ts` | Telemetry onResponse hook |
| `request-logs-writes.test.ts` | Request log persistence |
| `server-hardening.test.ts` | Server limits and security headers |
| `usage-tracker.test.ts` | Usage tracking and billing |

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
