// Standalone vitest workspace for the MCP tests that blow up the
// combined fork pool on some platforms.
//
// IMPORTANT: this workspace does NOT `extends` the base vitest.config.ts.
// When a project uses `extends`, vitest ignores that project's own
// `include`/`poolOptions.forks.execArgv` and uses the base config's
// values instead — meaning the 8192MB heap cap and the whole-suite
// `include` would apply, OOMing the ~7GB CI runner. By defining a
// self-contained project we guarantee only the intended files run in an
// isolated fork. The base config's `@dmr-x/*` alias map is copied
// verbatim so the test environment (db mock setup via the alias graph)
// stays correct.
//
// `mcp-input-validator.test.ts` is QUARANTINED from CI. Running it under
// vitest hangs and then dies with "Reached heap limit — JavaScript heap out
// of memory" (~8.9GB after ~16 min).
//
// Finding B2 proposed fixing this by stubbing the heavy `@dmr-x/utils` barrel
// with `vi.mock` in the test file, on the theory that transforming that graph
// in the fork worker was what blew the heap. That stub was written and is
// still in the test file, but it DOES NOT fix the problem — measured, not
// assumed:
//   - The test still OOMs with the mock in place.
//   - It hangs >300s even when run alone in its own fork, capped at
//     --max-old-space-size=2048, so it is not contention with
//     `mcp-policy-engine` sharing this project's single fork either.
//   - `InputValidator` itself is not the culprit: importing it directly under
//     bun with the REAL (unmocked) `@dmr-x/utils` and running every input the
//     test uses completes in ~0ms total.
// So the blow-up is specific to vitest's worker, and the actual cause is not
// yet identified. Re-adding this file to `include` will hang CI, not just
// fail it. Leave it excluded until the vitest-side cause is found.
//
// InputValidator behavior remains covered by mcp-policy-engine and the
// broader unit suite.

import { defineWorkspace } from 'vitest/config';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

// Same store-resolution helper as vitest.config.ts — kept inline so this
// workspace stays self-contained and version bumps don't break resolution.
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
    resolve: {
      alias: {
        // Copied from vitest.config.ts (workspace packages → src)
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
      name: 'mcp',
      globals: true,
      environment: 'node',
      // NOTE: `tests/unit/mcp-input-validator.test.ts` is deliberately absent
      // — see the quarantine note at the top of this file. Adding it hangs CI.
      include: ['tests/unit/mcp-policy-engine.test.ts'],
      exclude: ['node_modules', 'dist', '.turbo', '.claude', '.openclaude'],
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  },
]);
