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
//
// NOTE: the two MCP tests (mcp-input-validator, mcp-policy-engine) are
// excluded from the `unit` project below. They must run ALONE (not in the
// combined fork pool) or they hang/OOM on some platforms. CI runs them in a
// dedicated step via `bun run test:mcp` (see package.json) — passing the
// files explicitly gives them their own isolated vitest process. We deliberately
// do NOT model them as a `--project mcp` workspace entry: vitest 3.x ignores
// `--project` filtering for projects declared in a workspace file, so
// `vitest run --project mcp` re-runs the ENTIRE unit suite and OOMs the runner.

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.ts'],
      exclude: ['node_modules', 'dist', '.turbo', '.claude', '.openclaude', 'tests/e2e/**',
        // Excluded from `unit`; run alone via `bun run test:mcp` (CI). See
        // the workspace note above for why they aren't a `--project` entry.
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
