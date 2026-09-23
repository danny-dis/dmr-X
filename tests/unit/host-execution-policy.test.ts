import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

import { canRunHostProcess } from '../../apps/gateway/src/lib/host-execution-policy.js';

describe('host execution policy', () => {
  it('denies managed-mode requests', () => {
    expect(canRunHostProcess(false, false)).toBe(false);
  });

  it('denies production even if local mode was explicitly enabled', () => {
    expect(canRunHostProcess(true, true)).toBe(false);
  });

  it('permits local development', () => {
    expect(canRunHostProcess(true, false)).toBe(true);
  });
});

describe('managed-mode tool execution', () => {
  it('denies direct execute_code and bash before reaching the host', async () => {
    vi.stubEnv('DMRX_LOCAL_MODE', 'false');
    vi.resetModules();
    const { registerBuiltinToolHandlers, registerCodingToolHandlers, toolsRoutes } =
      await import('../../apps/gateway/src/routes/tools.routes.js');
    const server = Fastify();
    registerBuiltinToolHandlers();
    registerCodingToolHandlers();
    await server.register(toolsRoutes);
    try {
      for (const [name, args] of [
        ['execute_code', { language: 'bogus', code: 'noop' }],
        ['bash', { command: 'not-a-shell-allowed-command' }],
      ] as const) {
        const response = await server.inject({
          method: 'POST',
          url: '/tools/execute',
          payload: {
            model: 'unused',
            messages: [{ role: 'user', content: 'unused' }],
            tools: [{ type: 'function', function: { name, description: 'test', parameters: { type: 'object' } } }],
            tool_call: { id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
          },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().result).toEqual({
          error: 'Host-process tools are disabled outside local development mode',
        });
      }
    } finally {
      await server.close();
      vi.unstubAllEnvs();
    }
  });
});
