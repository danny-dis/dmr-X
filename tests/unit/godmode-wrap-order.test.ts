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
  it('ranks concrete vault models and does not emit auto-free', () => {
    const candidates = [
      candidate({ providerId: 'a', modelId: 'slow-free', qualityScore: 0.2, avgLatencyMs: 4000 }),
      candidate({ providerId: 'b', modelId: 'fast-good', qualityScore: 0.9, avgLatencyMs: 200 }),
      candidate({ providerId: 'c', modelId: 'mid', qualityScore: 0.6, avgLatencyMs: 800 }),
    ];
    const order = buildGodmodeWrapOrder(candidates);
    expect(order[0]).toBe('fast-good');
    expect(order).not.toContain('auto-free');
    expect(order.length).toBeGreaterThanOrEqual(1);
    expect(order.length).toBeLessThanOrEqual(5);
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
