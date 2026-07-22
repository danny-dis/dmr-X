import { describe, expect, it } from 'vitest';
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
