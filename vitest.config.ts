import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

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

export default defineConfig({
  resolve: {
    alias: {
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
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.turbo', '.claude', '.openclaude'],
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
  },
});
