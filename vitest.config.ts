import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import react from '@vitejs/plugin-react';

// Resolve a package out of Bun's `.bun` install store WITHOUT pinning a
// version. `storeName` is the store directory prefix (Bun escapes `/` in
// scoped names to `+`, e.g. `@fastify/compress` -> `@fastify+compress`);
// `pkgPath` is the nested package path inside the store entry. `major`
// optionally filters to a specific major so we keep resolving the v4 Zod
// even when a v3 copy is also installed (the gateway runs zod 3, the
// @dmr-x/utils barrel needs zod 4). Dependency bumps therefore resolve
// dynamically instead of silently breaking test module resolution.
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

// Shared with both the `unit` and `e2e` projects below. Each project is
// intentionally self-contained (full `resolve`/`test` blocks, no `extends`)
// rather than inheriting from the root config or from each other — a
// workspace project that uses `extends` has been observed (finding B1, see
// git history of the old vitest.workspace.ts) to ignore that project's own
// `include`/`exclude` and fall back to the extended config's, which is how
// the e2e project once silently inherited the unit include and OOM'd running
// mcp-input-validator.test.ts. Duplicating this object across projects (via
// a single shared reference, not re-declaring it) avoids relying on merge
// semantics we don't trust for a setting this load-bearing.
const backendAlias = {
  // Workspace packages — point to source so vitest/vite handles TS directly
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
  // gateway-internal workspace packages (needed by routes under test)
  '@dmr-x/sandbox': resolve(__dirname, 'services/sandbox/src'),
  '@dmr-x/router': resolve(__dirname, 'services/router/src'),
  '@dmr-x/agent-registry': resolve(__dirname, 'services/agent-registry/src'),
  '@dmr-x/agent-runtime': resolve(__dirname, 'services/agent-runtime/src'),
  // fastify — only in apps/gateway, not hoisted to root. Versions are
  // resolved from the store dynamically so bumps don't break resolution.
  'fastify': resolveStorePath('fastify', 'fastify'),
  '@fastify/compress': resolveStorePath('@fastify+compress', '@fastify/compress'),
  'zod': zodRoot,
  'zod/v4': resolve(zodRoot, 'v4'),
};

export default defineConfig({
  resolve: {
    alias: backendAlias,
  },
  test: {
    // Pool sizing (`maxForks`, `execArgv`) is a run-wide resource setting,
    // not a per-project one — vitest's own types omit `poolOptions` from
    // the per-project config and re-expose only `isolate`/`singleFork`
    // there (see `ProjectConfig` in vitest's `dist/chunks/reporters.*.d.ts`).
    // All projects below share this single fork, capped at an 8GB heap, so
    // it must live here at the root rather than inside `projects[].test`.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
        execArgv: ['--max-old-space-size=8192'],
      },
    },
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
      reporter: ['text', 'json', 'html', 'lcov'],
    },
    projects: [
      {
        // Default (`bun run test`): unit tests only (fast, no gateway needed).
        resolve: {
          alias: backendAlias,
        },
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          // bun:sqlite is a Bun native module — vite cannot transform/resolve
          // it, so externalize it and let the Bun runtime (which spawns the
          // fork workers under `bun vitest run`) load it natively.
          deps: { external: [/^bun:/] }, 
          // Vitest's defaults (5s test / 10s hook) assume a machine with CPU
          // to spare. The root config pins `maxForks: 1`, so the whole suite
          // shares one starvable process: anything else busy on the box
          // (a parallel build, an indexer, a loaded CI runner) can stall a
          // hook doing nothing but `Fastify({ logger: false })` past 10s.
          // That surfaced as `telemetry-integration.test.ts` failing with
          // "Hook timed out in 10000ms" only under load. These bounds still
          // catch a genuine hang, just not a busy neighbour.
          testTimeout: 20_000,
          hookTimeout: 30_000,
          exclude: [
            'node_modules', 'dist', '.turbo', '.claude', '.openclaude', 'tests/e2e/**',
            // mcp-input-validator and mcp-policy-engine run in the
            // dedicated `mcp` workspace project (isolated fork). See
            // vitest.mcp.workspace.ts.
            'tests/unit/mcp-input-validator.test.ts',
            'tests/unit/mcp-policy-engine.test.ts',
          ],
          // `maxForks`/`execArgv` live on the root `test.poolOptions` above
          // (vitest's per-project config type only allows `singleFork`/
          // `isolate` here — pool sizing is a run-wide resource, not a
          // per-project one). `singleFork: true` restates the intent
          // explicitly for this project.
          pool: 'forks',
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
        },
      },
      {
        // E2E (`bun run test:e2e`): runs against a live gateway at
        // DMRX_GATEWAY_URL (default: http://localhost:3000). Requires
        // DMRX_RUN_E2E=true to actually execute; without it, every E2E
        // file's `describe` is a `describe.skip` (per the test files' own
        // gating).
        //
        // Run the gateway before invoking test:e2e:
        //   DMRX_LOCAL_MODE=true bun run dev:gateway
        //   # in another shell:
        //   DMRX_RUN_E2E=true DMRX_GATEWAY_URL=http://localhost:3000 bun run test:e2e
        resolve: {
          alias: backendAlias,
        },
        test: {
          name: 'e2e',
          globals: true,
          environment: 'node',
          include: ['tests/e2e/**/*.test.ts'],
          deps: { external: [/^bun:/] }, 
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
      {
        // MCP isolated tests (CI's "Run MCP isolated tests" step): runs
        // `mcp-policy-engine.test.ts` in its own single-fork project,
        // separate from the main `unit` project.
        //
        // This used to be a standalone `vitest.mcp.workspace.ts` invoked via
        // `vitest run --workspace vitest.mcp.workspace.ts --project mcp`.
        // Vitest 3.2.6 no longer honors `--workspace` once the root config
        // defines `test.projects` — it logs "Both test.projects and
        // test.workspace are defined. Ignoring the test.workspace option."
        // and then fails with "No projects matched the filter \"mcp\"",
        // since the root config's `projects` array had no `mcp` entry. That
        // left this whole step silently broken; it went unnoticed because
        // the preceding "Run unit tests" step was failing first (a separate,
        // now-fixed issue), so CI never actually reached it. Folding `mcp`
        // in here as a sibling project — the same self-contained, no-`extends`
        // shape as `unit`/`e2e`/`ui` above — is the fix: one config vitest
        // actually resolves `--project mcp` against.
        //
        // `mcp-input-validator.test.ts` stays QUARANTINED from CI. Running it
        // under vitest hangs and then dies with "Reached heap limit —
        // JavaScript heap out of memory" (~8.9GB after ~16 min). A `vi.mock`
        // stub of the `@dmr-x/utils` barrel (on the theory that transforming
        // that graph in the fork worker blew the heap) was written and is
        // still in the test file, but measurably does NOT fix it: the test
        // still OOMs with the mock in place, still hangs >300s alone in its
        // own fork capped at --max-old-space-size=2048 (so it isn't
        // contention with mcp-policy-engine sharing a fork), and
        // `InputValidator` itself isn't the culprit — importing it directly
        // under bun with the real (unmocked) `@dmr-x/utils` and running every
        // input the test uses completes in ~0ms. The blow-up is specific to
        // vitest's worker; the actual cause is not yet identified.
        // Re-adding this file to `include` will hang CI, not just fail it.
        // `InputValidator` behavior remains covered by mcp-policy-engine and
        // the broader unit suite.
        resolve: {
          alias: backendAlias,
        },
        test: {
          name: 'mcp',
          globals: true,
          environment: 'node',
          include: ['tests/unit/mcp-policy-engine.test.ts'],
          deps: { external: [/^bun:/] }, 
          exclude: ['node_modules', 'dist', '.turbo', '.claude', '.openclaude'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        // UI (`bun run test:ui` / `--project ui`): jsdom + React Testing
        // Library, scoped to apps/ui/src. Mirrors the `@` alias declared in
        // apps/ui/vite.config.ts and apps/ui/tsconfig.app.json.
        plugins: [react()],
        resolve: {
          alias: {
            '@': resolve(__dirname, 'apps/ui/src'),
          },
        },
        test: {
          name: 'ui',
          globals: true,
          environment: 'jsdom',
          include: ['apps/ui/src/**/*.test.{ts,tsx}'],
          exclude: ['node_modules', 'dist', '.turbo', '.claude', '.openclaude'],
          setupFiles: [resolve(__dirname, 'apps/ui/src/test/setup.ts')],
        },
      },
    ],
  },
});
