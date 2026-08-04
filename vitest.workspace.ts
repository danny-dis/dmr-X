// Vitest workspace — splits unit and E2E test runs.
//
// Default (`bun run test`):  runs unit tests only (fast, no gateway needed).
// E2E (`bun run test:e2e`): runs E2E tests against a live gateway at
//                            DMRX_GATEWAY_URL (default: http://localhost:3000).
//                            Requires DMRX_RUN_E2E=true to actually execute;
//                            without it, every E2E file's `describe` is a
//                            `describe.skip` (per the test files' own gating).
//
// Run the gateway before invoking test:e2e:
//   DMRX_LOCAL_MODE=true bun run dev:gateway
//   # in another shell:
//   DMRX_RUN_E2E=true DMRX_GATEWAY_URL=http://localhost:3000 bun run test:e2e
import { defineWorkspace } from 'vitest/config';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

// Same store-resolution helper as vitest.config.ts — kept inline so this
// workspace stays self-contained (it must NOT `extends` the base config:
// vitest ignores a project's own `include` when `extends` is present, which
// is what made the e2e project inherit the unit `include` and re-run the
// whole suite, then OOM on mcp-input-validator.test.ts — finding B1).
function resolveStorePath(storeName: string, pkgPath: string, major?: string): string {
  const storeDir = resolve(__dirname, 'node_modules/.bun');
  const dirs = readdirSync(storeDir).filter((d) => d.startsWith(`${storeName}@`));
  if (dirs.length === 0) {
    throw new Error(`vitest alias: cannot find "${storeName}" in bun store at ${storeDir}`);
  }
  const candidates = major ? dirs.filter((d) => d.startsWith(`${storeName}@${major}.`)) : dirs;
  if (candidates.length === 0) {
    throw new Error(`vitest alias: no "${storeName}@${major}.*" in bun store at ${storeDir}`);
  }
  const chosen = [...candidates].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()!;
  return resolve(storeDir, chosen, 'node_modules', pkgPath);
}

const zodRoot = resolveStorePath('zod', 'zod', '4');

export default defineWorkspace([
    {
        extends: './vitest.config.ts',
        test: {
            name: 'unit',
            include: ['tests/unit/**/*.test.ts'],
            // Vitest's defaults (5s test / 10s hook) assume a machine with CPU
            // to spare. The base config pins `maxForks: 1`, so the whole suite
            // shares one starvable process: anything else busy on the box
            // (a parallel build, an indexer, a loaded CI runner) can stall a
            // hook doing nothing but `Fastify({ logger: false })` past 10s.
            // That surfaced as `telemetry-integration.test.ts` failing with
            // "Hook timed out in 10000ms" only under load. These bounds still
            // catch a genuine hang, just not a busy neighbour.
            testTimeout: 20_000,
            hookTimeout: 30_000,
            exclude: ['node_modules', 'dist', '.turbo', '.claude', '.openclaude', 'tests/e2e/**',
                // mcp-input-validator and mcp-policy-engine run in the
                // dedicated `mcp` workspace project (isolated fork). See
                // vitest.mcp.workspace.ts.
                'tests/unit/mcp-input-validator.test.ts',
                'tests/unit/mcp-policy-engine.test.ts',
            ],
        },
    },
    {
        // NOTE: intentionally does NOT `extends` the base config. When a
        // workspace project uses `extends`, vitest ignores that project's own
        // `include` and uses the base config's `include` instead — which would
        // make this project re-run the whole unit suite and OOM (B1). This
        // project is fully self-contained so only `tests/e2e/**` runs here.
        resolve: {
            alias: {
                '@dmr-x/adapters': resolve(__dirname, 'services/adapters/src'),
                '@dmr-x/core': resolve(__dirname, 'packages/core/src'),
                '@dmr-x/utils': resolve(__dirname, 'packages/utils/src'),
                '@dmr-x/db': resolve(__dirname, 'packages/db/src'),
                '@dmr-x/cache': resolve(__dirname, 'services/cache/src'),
                '@dmr-x/federation': resolve(__dirname, 'services/federation/src'),
                '@dmr-x/memory': resolve(__dirname, 'services/memory/src'),
                '@dmr-x/oauth': resolve(__dirname, 'services/oauth/src'),
                '@dmr-x/policy': resolve(__dirname, 'services/policy/src'),
                '@dmr-x/billing': resolve(__dirname, 'services/billing/src'),
                '@dmr-x/tokenizers': resolve(__dirname, 'packages/tokenizers/src'),
                '@dmr-x/registry': resolve(__dirname, 'services/registry/src'),
                '@dmr-x/provider-catalog': resolve(__dirname, 'packages/provider-catalog/src'),
                '@dmr-x/sandbox': resolve(__dirname, 'services/sandbox/src'),
                '@dmr-x/router': resolve(__dirname, 'services/router/src'),
                '@dmr-x/agent-registry': resolve(__dirname, 'services/agent-registry/src'),
                '@dmr-x/agent-runtime': resolve(__dirname, 'services/agent-runtime/src'),
                'fastify': resolveStorePath('fastify', 'fastify'),
                '@fastify/compress': resolveStorePath('@fastify+compress', '@fastify/compress'),
                'zod': zodRoot,
                'zod/v4': resolve(zodRoot, 'v4'),
            },
        },
        test: {
            name: 'e2e',
            globals: true,
            environment: 'node',
            include: ['tests/e2e/**/*.test.ts'],
            exclude: ['node_modules', 'dist', '.turbo', '.claude', '.openclaude'],
            // E2E tests are slow and network-dependent. Single fork, longer
            // timeout, and bail on the first failure so we don't pile up
            // 30s of late failures from a single broken gateway.
            testTimeout: 30_000,
            hookTimeout: 30_000,
            pool: 'forks',
            poolOptions: { forks: { singleFork: true } },
            bail: 1,
        },
    },
]);
