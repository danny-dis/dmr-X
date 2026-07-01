import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const root = 'C:/Users/pc/Documents/projects/DMR-X';

export default defineConfig({
  resolve: {
    alias: {
      '@dmr-x/adapters': resolve(root, 'services/adapters/src'),
      '@dmr-x/core': resolve(root, 'packages/core/src'),
      '@dmr-x/utils': resolve(root, 'packages/utils/src'),
      '@dmr-x/db': resolve(root, 'packages/db/src'),
      '@dmr-x/cache': resolve(root, 'packages/cache/src'),
      '@dmr-x/federation': resolve(root, 'packages/federation/src'),
      '@dmr-x/memory': resolve(root, 'packages/memory/src'),
      '@dmr-x/oauth': resolve(root, 'packages/oauth/src'),
      '@dmr-x/policy': resolve(root, 'packages/policy/src'),
      '@dmr-x/billing': resolve(root, 'packages/billing/src'),
      '@dmr-x/tokenizers': resolve(root, 'packages/tokenizers/src'),
      '@dmr-x/registry': resolve(root, 'services/registry/src'),
      'fastify': resolve(root, 'node_modules/.bun/fastify@5.9.0/node_modules/fastify'),
      '@fastify/compress': resolve(root, 'node_modules/.bun/@fastify+compress@9.0.0/node_modules/@fastify/compress'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/mcp-input-validator.test.ts'],
    pool: 'threads',
    poolOptions: { threads: { maxThreads: 1 } },
  },
});
