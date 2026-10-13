import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

describe('managed host-tool HTTP repro', () => {
  it('locates the first hanging boundary without executing a host command', async () => {
    vi.stubEnv('DMRX_LOCAL_MODE', 'false');
    console.error('[dmrx-readiness-host] before reset');
    vi.resetModules();
    console.error('[dmrx-readiness-host] before routes import');
    const routes = await import('../../apps/gateway/src/routes/tools.routes.js');
    console.error('[dmrx-readiness-host] imported routes');
    const server = Fastify();
    try {
      routes.registerBuiltinToolHandlers();
      routes.registerCodingToolHandlers();
      console.error('[dmrx-readiness-host] registered handlers');
      await server.register(routes.toolsRoutes);
      console.error('[dmrx-readiness-host] registered routes');
      const response = await server.inject({
        method: 'POST', url: '/tools/execute',
        payload: {
          model: 'unused', messages: [{ role: 'user', content: 'unused' }],
          tools: [{ type: 'function', function: { name: 'execute_code', description: 'test', parameters: { type: 'object' } } }],
          tool_call: { id: 'readiness-policy', type: 'function', function: { name: 'execute_code', arguments: '{"language":"bogus","code":"noop"}' } },
        },
      });
      console.error('[dmrx-readiness-host] HTTP responded');
      expect(response.statusCode).toBe(200);
      expect(response.json().result).toEqual({error: 'Host-process tools are disabled outside local development mode'});
    } finally {
      await server.close();
      vi.unstubAllEnvs();
    }
  }, 30_000);
});
