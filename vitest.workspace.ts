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
      exclude: ['node_modules', 'dist', '.turbo', '.claude', '.openclaude', 'tests/e2e/**',
        // These 2 tests hang when run in the combined vitest fork pool on
        // Windows due to vitest/bun compatibility. Run individually in CI
        // via the dedicated `mcp` project below.
        'tests/unit/mcp-input-validator.test.ts',
        'tests/unit/mcp-policy-engine.test.ts',
      ],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'mcp',
      // Dedicated project for the two tests excluded from `unit` above
      // (they blow up the combined fork pool on some platforms). Inherits
      // the full config so the test environment (alias graph, db mock
      // setup) is correct, but caps the worker heap BELOW the CI runner's
      // ~7GB RAM. The base config's 8192MB cap exceeds the runner and gets
      // OOM-killed by the OS; 4096MB keeps these small tests well within
      // bounds. Coverage is disabled via the CI flag (--coverage.enabled=false).
      include: ['tests/unit/mcp-input-validator.test.ts', 'tests/unit/mcp-policy-engine.test.ts'],
      poolOptions: { forks: { maxForks: 1, execArgv: ['--max-old-space-size=4096'] } },
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
