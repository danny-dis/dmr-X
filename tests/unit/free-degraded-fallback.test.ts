import { afterEach, describe, expect, it } from 'vitest';
import type { RoutingPlan, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { executeWithFallback, resetModelErrorCache } from '../../services/router/src/fallback/fallback-executor.js';

const plan: RoutingPlan = {
  primary: { providerId: 'free', modelId: 'free-model', adapterType: 'openai', score: 1 },
  chain: [], timeoutMs: 500, maxRetries: 1,
};
const response = { providerId: 'paid', modelId: 'paid-model', choices: [] } as unknown as UnifiedResponse;

function request(model: string, costFilter?: string): UnifiedRequest {
  return {
    modality: 'llm', model, stream: false,
    messages: [{ role: 'user', content: 'test' }],
    metadata: costFilter ? { costFilter } : {},
  };
}

afterEach(() => {
  delete process.env.DMRX_DEGRADED_MODEL;
  resetModelErrorCache();
});

describe('last-resort fallback respects free-only policy', () => {
  it.each([request('auto', 'free'), request('free')])('does not execute an unverified degraded model for %#', async (input) => {
    process.env.DMRX_DEGRADED_MODEL = 'paid/paid-model';
    const called: string[] = [];
    await expect(executeWithFallback(plan, input, {
      execute: async (providerId) => {
        called.push(providerId);
        if (providerId === 'paid') return response;
        throw new Error('upstream down');
      },
    })).rejects.toThrow();
    expect(called).toEqual(['free']);
  });

  it('retains explicit degraded fallback for unconstrained requests', async () => {
    process.env.DMRX_DEGRADED_MODEL = 'paid/paid-model';
    const called: string[] = [];
    const result = await executeWithFallback(plan, request('auto', 'all'), {
      execute: async (providerId) => {
        called.push(providerId);
        if (providerId === 'paid') return response;
        throw new Error('upstream down');
      },
    });
    expect(called).toEqual(['free', 'paid']);
    expect(result.fallback?.reason).toBe('graceful_degradation');
  });

  it('does not dispatch configured fallbacks outside the verified free plan', async () => {
    const called: string[] = [];
    await expect(executeWithFallback(plan, request('free'), {
      execute: async (providerId) => {
        called.push(providerId);
        if (providerId === 'paid') return response;
        throw new Error('upstream down');
      },
    }, { configuredFallbacks: [{ trigger: 'error', providerId: 'paid', modelId: 'paid-model' }] })).rejects.toThrow();
    expect(called).toEqual(['free']);
  });
  it('honors an effective free-only router default absent from request metadata', async () => {
    process.env.DMRX_DEGRADED_MODEL = 'paid/paid-model';
    const called: string[] = [];
    await expect(executeWithFallback(plan, request('auto', 'all'), {
      execute: async (providerId) => {
        called.push(providerId);
        if (providerId === 'paid') return response;
        throw new Error('upstream down');
      },
    }, { freeOnly: true, configuredFallbacks: [{ trigger: 'error', providerId: 'paid', modelId: 'paid-model' }] })).rejects.toThrow();
    expect(called).toEqual(['free']);
  });
});
