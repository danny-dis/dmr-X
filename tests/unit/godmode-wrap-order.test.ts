import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderModel } from '@dmr-x/core';

import {
  buildGodmodeWrapOrder,
  GODMODE_WRAP_FALLBACK,
} from '../../apps/gateway/src/lib/godmode-guard.js';

function candidate(partial: Partial<ProviderModel> & { modelId: string; providerId: string }): ProviderModel {
  return {
    modality: 'llm',
    qualityScore: 0.5,
    costPerInputToken: 0,
    costPerOutputToken: 0,
    avgLatencyMs: 500,
    contextLength: 128_000,
    ...partial,
  } as ProviderModel;
}

describe('buildGodmodeWrapOrder (pick-then-wrap)', () => {
  it('ranks concrete vault models before one guarded auto-free pool retry', () => {
    const candidates = [
      candidate({ providerId: 'a', modelId: 'slow-free', qualityScore: 0.2, avgLatencyMs: 4000 }),
      candidate({ providerId: 'b', modelId: 'fast-good', qualityScore: 0.9, avgLatencyMs: 200 }),
      candidate({ providerId: 'c', modelId: 'mid', qualityScore: 0.6, avgLatencyMs: 800 }),
    ];
    const order = buildGodmodeWrapOrder(candidates);
    expect(order[0]).toBe('fast-good');
    expect(order.at(-1)).toBe('auto-free');
    expect(order.filter((model) => model === 'auto-free')).toHaveLength(1);
    expect(order.length).toBeGreaterThanOrEqual(1);
    expect(order.length).toBeLessThanOrEqual(6);
  });

  it('falls back to emergency list when vault is empty', () => {
    expect(buildGodmodeWrapOrder([])).toEqual([...GODMODE_WRAP_FALLBACK]);
  });
});

// ─── B-006 regression: restartGodmodeProxy must pass api_key through ─────────
// The auto-restart path previously omitted `apiKey` from every
// setGodmodeConfig call, so the gateway sent no Bearer to the sidecar (which
// always requires auth) and every godmode wrap/stream 401'd.
//
// Workspace packages are mocked by FILE PATH (apps/gateway/node_modules
// junctions resolve them to their real sources, so @dmr-x/* alias mocks are
// bypassed by the dynamic imports inside restartGodmodeProxy) — the same
// pattern sidecar-boot-godmode-autostart.test.ts uses. @dmr-x/utils is NOT
// mocked so the real resolveMetaModel chain keeps working for the tests above.
const {
  setGodmodeConfigMock,
  getGodmodeServiceMock,
  getRunningInstanceMock,
  healthCheckMock,
  stopMock,
  startMock,
} = vi.hoisted(() => ({
  setGodmodeConfigMock: vi.fn(),
  getGodmodeServiceMock: vi.fn(),
  getRunningInstanceMock: vi.fn(),
  healthCheckMock: vi.fn(),
  stopMock: vi.fn(),
  startMock: vi.fn(),
}));

vi.mock('../../services/godmode/src/index.ts', () => ({
  getGodmodeService: (...args: unknown[]) => getGodmodeServiceMock(...args),
  setGodmodeConfig: (...args: unknown[]) => setGodmodeConfigMock(...args),
}));

vi.mock('../../services/server-manager/src/index.ts', () => ({
  serverManager: {
    getRunningInstance: (...args: unknown[]) => getRunningInstanceMock(...args),
    healthCheck: (...args: unknown[]) => healthCheckMock(...args),
    stop: (...args: unknown[]) => stopMock(...args),
    start: (...args: unknown[]) => startMock(...args),
  },
}));

describe('auto-free keeps the wrapper when picked models are unavailable', () => {
  afterEach(() => vi.resetAllMocks());

  it('retries the wider DMR-X free pool through Godmode, not plain routing', async () => {
    const chat = vi.fn(async ({ model }: { model: string }) => {
      if (model === 'auto-free') return { choices: [{ message: { content: 'wrapped-pool-answer' } }] };
      throw new Error('picked concrete model unavailable');
    });
    getGodmodeServiceMock.mockReturnValue({
      isInitialized: () => true,
      healthCheck: vi.fn().mockResolvedValue(true),
      chat,
    });
    const { wrapViaGodmode } = await import('../../apps/gateway/src/lib/godmode-guard.js');
    const result = await wrapViaGodmode({
      requestId: 'test-free-pool-fallback', model: 'auto-free', costFilter: 'free',
      messages: [{ role: 'user', content: 'test' }],
      candidates: [candidate({ providerId: 'test', modelId: 'unavailable-picked-model', qualityScore: 0.9 })],
    });
    expect(chat.mock.calls.map(([request]) => request.model)).toEqual(['unavailable-picked-model', 'auto-free']);
    expect(result.status).toBe('wrapped');
    expect(result.wrapModel).toBe('auto-free');
    expect(result.completion.choices[0].message.content).toBe('wrapped-pool-answer');
  });
});

describe('ensureGodmodeProxy re-wires server api_key (B-006)', () => {
  const svc = () => ({
    isInitialized: () => false,
    initialize: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(false),
  });

  beforeEach(() => {
    vi.resetAllMocks();
    // No sidecar reachable on the default URL — force the server-manager path.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no sidecar in tests')));
    getGodmodeServiceMock.mockReturnValue(svc());
    stopMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('adopting a live instance passes its api_key', async () => {
    getRunningInstanceMock.mockReturnValue({
      url: 'http://localhost:47115',
      api_key: 'live-key-48chars',
      llm_base_url: 'http://localhost:47113/v1',
      llm_api_key: 'llm-key',
    });
    healthCheckMock.mockResolvedValue(true);

    const { ensureGodmodeProxy } = await import('../../apps/gateway/src/lib/godmode-guard.js');
    await expect(ensureGodmodeProxy('req-live')).resolves.toBe(true);

    expect(setGodmodeConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://localhost:47115', apiKey: 'live-key-48chars' }),
    );
  });

  it('fresh start passes the generated api_key', async () => {
    getRunningInstanceMock.mockReturnValue({
      url: 'http://localhost:47115',
      api_key: 'old-key',
      llm_base_url: 'http://localhost:47113/v1',
    });
    healthCheckMock.mockResolvedValue(false);
    startMock.mockResolvedValue({
      url: 'http://localhost:47115',
      api_key: 'fresh-key-48chars',
      llm_base_url: 'http://localhost:47113/v1',
      llm_api_key: 'llm-key',
    });

    const { ensureGodmodeProxy } = await import('../../apps/gateway/src/lib/godmode-guard.js');
    await expect(ensureGodmodeProxy('req-start')).resolves.toBe(true);

    expect(stopMock).toHaveBeenCalled();
    expect(setGodmodeConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://localhost:47115', apiKey: 'fresh-key-48chars' }),
    );
  });

  it('externally-managed healthy sidecar uses GODMODE_API_KEY', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.stubEnv('GODMODE_API_KEY', 'ext-key');

    const { ensureGodmodeProxy } = await import('../../apps/gateway/src/lib/godmode-guard.js');
    await expect(ensureGodmodeProxy('req-ext')).resolves.toBe(true);

    expect(setGodmodeConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'ext-key' }),
    );
  });
});
