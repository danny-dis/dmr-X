import { ProviderError } from '@dmr-x/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleStickySession } from '../../services/router/src/sticky-session-handler.js';
import { resetModelErrorCache } from '../../services/router/src/fallback/fallback-executor.js';

vi.mock('../../services/router/src/sticky/sticky-session.js', () => ({
  getStickyProvider: vi.fn().mockResolvedValue({ providerId: 'pinned', modelId: 'same-model' }),
  breakStickySession: vi.fn().mockResolvedValue(undefined),
}));

const candidate = (providerId: string, modelId: string) => ({
  providerId, providerName: providerId, modelId, isHealthy: true,
  qualityScore: 0.8, modality: 'llm', capabilities: ['chat'],
  costPerInputToken: 0, costPerOutputToken: 0,
});

beforeEach(() => resetModelErrorCache());

describe('sticky fallback affinity', () => {
  it('tries the same model on another provider before switching models', async () => {
    const execute = vi.fn(async (providerId: string, modelId: string) => {
      if (providerId === 'pinned' && modelId === 'same-model') {
        throw new ProviderError('primary unavailable', providerId, 500);
      }
      return {
        modality: 'llm', providerId, modelId, requestId: 'test',
        message: { role: 'assistant', content: 'OK' }, finishReason: 'stop',
      };
    });
    const result = await handleStickySession({
      request: {
        modality: 'llm', model: 'auto', messages: [{ role: 'user', content: 'Hello' }],
      },
      options: { requestId: 'sticky-affinity-test' },
      candidates: [
        candidate('pinned', 'same-model'),
        candidate('alternate', 'same-model'),
        candidate('pinned', 'different-model'),
        candidate('other', 'other-model'),
      ],
      adapterExecutor: { execute }, config: { enablePlanner: false },
      thompsonSampler: {} as any, router: {} as any,
      conversationHash: 'sticky-affinity-test', modelTarget: { modelId: 'auto' },
    } as any);

    expect(result.used).toBe(true);
    if (!result.used) return;
    expect(result.result.response.modelId).toBe('same-model');
    expect(result.result.response.providerId).toBe('alternate');
    expect(execute).not.toHaveBeenCalledWith('pinned', 'different-model', expect.anything());
    expect(execute).not.toHaveBeenCalledWith('other', 'other-model', expect.anything());
  });
});
