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
                // These 2 tests are run in the dedicated `mcp` workspace project
                // (isolated fork) — they hang in the combined vitest fork pool on
                // Windows due to vitest/bun compatibility. See vitest.mcp.workspace.ts.
                'tests/unit/mcp-input-validator.test.ts',
                'tests/unit/mcp-policy-engine.test.ts',
            ],
        },
    },
    {
        extends: './vitest.config.ts',
        test: {
            name: 'e2e',
            include: ['tests/e2e/**/*.test.ts'],
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
