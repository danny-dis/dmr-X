import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ start: vi.fn(), install: vi.fn(), config: vi.fn(), initialize: vi.fn() }));
vi.mock('../../services/server-manager/src/index.ts', () => ({
  serverManager: { start: mocks.start, install: mocks.install },
  getGodmodeRepoInfo: () => ({}), getInstalledGodmodeRef: () => null,
}));
vi.mock('../../services/godmode/src/index.ts', () => ({
  getGodmodeService: () => ({ isInitialized: () => true, initialize: mocks.initialize, getConfig: mocks.config }),
  setGodmodeConfig: mocks.config,
}));
import { godmodeRoutes } from '../../apps/gateway/src/routes/godmode.routes.js';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('Godmode lifecycle always routes through DMR-X', () => {
  it('does not select direct OpenRouter when starting with a populated provider vault', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'provider-only-credential');
    vi.stubEnv('DMRX_GATEWAY_URL', 'http://localhost:47113');
    mocks.start.mockResolvedValue({ status: 'running', url: 'http://localhost:47115', runtime: 'bun-native',
      id: 'g0dm0d3', openrouter_key_ref: 'relay:http://localhost:47113/v1', llm_base_url: 'http://localhost:47113/v1' });
    const app = Fastify();
    await app.register(godmodeRoutes);
    try {
      const response = await app.inject({ method: 'POST', url: '/godmode/server/start', payload: {} });
      expect(response.statusCode).toBe(200);
      expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
        llmBaseUrl: 'http://localhost:47113/v1', openrouterApiKey: '',
      }));
    } finally { await app.close(); }
  });
});
