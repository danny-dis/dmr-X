// Standalone vitest workspace for the two MCP tests that blow up the
// combined fork pool on some platforms.
//
// IMPORTANT: this workspace does NOT `extends` the base vitest.config.ts.
// When a project uses `extends`, vitest ignores that project's own
// `include`/`poolOptions.forks.execArgv` and uses the base config's
// values instead — meaning the 8192MB heap cap and the whole-suite
// `include` would apply, OOMing the ~7GB CI runner. By defining a
// self-contained project we guarantee only these 2 files run at a 4096MB
// cap. The base config's `@dmr-x/*` alias map is copied verbatim so the
// test environment (db mock setup via the alias graph) stays correct.

import { defineWorkspace } from 'vitest/config';
import { resolve } from 'node:path';

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
        'fastify': resolve(__dirname, 'node_modules/.bun/fastify@5.9.0/node_modules/fastify'),
        '@fastify/compress': resolve(__dirname, 'node_modules/.bun/@fastify+compress@9.0.0/node_modules/@fastify/compress'),
        'zod': resolve(__dirname, 'node_modules/.bun/zod@4.4.3/node_modules/zod'),
        'zod/v4': resolve(__dirname, 'node_modules/.bun/zod@4.4.3/node_modules/zod/v4'),
      },
    },
    test: {
      name: 'mcp',
      globals: true,
      environment: 'node',
      include: ['tests/unit/mcp-input-validator.test.ts', 'tests/unit/mcp-policy-engine.test.ts'],
      exclude: ['node_modules', 'dist', '.turbo', '.claude', '.openclaude'],
      pool: 'forks',
      poolOptions: {
        forks: {
          maxForks: 1,
          execArgv: ['--max-old-space-size=4096'],
        },
      },
      coverage: { enabled: false },
    },
  },
]);
