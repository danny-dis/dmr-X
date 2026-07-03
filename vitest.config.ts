import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

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
      // fastify — only in apps/gateway, not hoisted to root
      'fastify': resolve(__dirname, 'node_modules/.bun/fastify@5.9.0/node_modules/fastify'),
      '@fastify/compress': resolve(__dirname, 'node_modules/.bun/@fastify+compress@9.0.0/node_modules/@fastify/compress'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.turbo', '.claude', '.openclaude'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
        execArgv: ['--max-old-space-size=6144'],
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
