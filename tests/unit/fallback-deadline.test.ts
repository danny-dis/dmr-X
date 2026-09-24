import { describe, expect, it } from 'vitest';
import { ProviderError, type RoutingPlan, type UnifiedRequest } from '@dmr-x/core';
import { executeWithFallback, executeWithHedging, resetHedgeState } from '../../services/router/src/fallback/fallback-executor.js';

const request: UnifiedRequest = {
  modality: 'llm', model: 'auto', stream: false,
  metadata: {},
  messages: [{ role: 'user', content: 'deadline test' }],
};
const provider = (providerId: string) => ({ providerId, modelId: 'free-model', adapterType: 'openai', score: 1 });
const plan = (withFallback: boolean): RoutingPlan => ({
  primary: provider('primary'),
  chain: withFallback ? [{ provider: provider('fallback'), trigger: 'error', waitMs: 0 }] : [],
  timeoutMs: 30_000, maxRetries: 1,
});
const stalled = new Promise<never>(() => {});
const resultWithin = (promise: Promise<unknown>) => Promise.race([
  promise.then(() => 'resolved', error => (error as Error).name),
  new Promise<string>(resolve => setTimeout(() => resolve('stalled'), 150)),
]);

describe('fallback end-to-end deadline', () => {
  it('bounds a primary provider that never resolves', async () => {
    const result = executeWithFallback(plan(false), request, {
      execute: async () => stalled,
    }, { globalTimeoutMs: 25 });
    expect(await resultWithin(result)).toBe('ProviderUnavailableError');
  });

  it('uses the routing plan timeout when no override is provided', async () => {
    const stalled = new Promise<never>(() => {});
    const result = executeWithFallback({ ...plan(false), timeoutMs: 45 }, request, {
      execute: async () => stalled,
    });
    expect(await resultWithin(result)).toBe('ProviderUnavailableError');
  });

  it('bounds a sequential fallback that never resolves', async () => {
    const result = executeWithFallback(plan(true), request, {
      execute: async (providerId) => providerId === 'primary'
        ? Promise.reject(new Error('primary down')) : stalled,
    }, { globalTimeoutMs: 25 });
    expect(await resultWithin(result)).toBe('ProviderUnavailableError');
  });
  it('bounds quota checks before dispatch', async () => {
    const result = executeWithFallback(plan(false), request, {
      execute: async () => { throw new Error('must not dispatch'); },
    }, { globalTimeoutMs: 25, tenantId: 'test', quotaService: {
      checkQuota: async () => stalled,
    } as any });
    expect(await resultWithin(result)).toBe('ProviderUnavailableError');
  });

  it('bounds parallel probes when quota checks never resolve', async () => {
    const twoFallbacks: RoutingPlan = { ...plan(true), chain: [
      { provider: provider('fallback-a'), trigger: 'error', waitMs: 0 },
      { provider: provider('fallback-b'), trigger: 'error', waitMs: 0 },
    ] };
    const result = executeWithFallback(twoFallbacks, request, {
      execute: async () => { throw new Error('upstream down'); },
    }, { globalTimeoutMs: 25, tenantId: 'test', quotaService: {
      checkQuota: async (_tenant: string, providerId: string) => providerId === 'primary' ? undefined : stalled,
    } as any });
    expect(await resultWithin(result)).toBe('ProviderUnavailableError');
  });

  it('returns a successful parallel fallback before another probe stalls', async () => {
    const twoFallbacks: RoutingPlan = { ...plan(true), chain: [
      { provider: provider('quick'), trigger: 'error', waitMs: 0 },
      { provider: provider('stuck'), trigger: 'error', waitMs: 0 },
    ] };
    const result = executeWithFallback(twoFallbacks, request, {
      execute: async (id) => {
        if (id === 'primary') throw new ProviderError('content policy blocked', 'primary', 400);
        if (id === 'stuck') return stalled;
        return { modelId: 'quick', usage: { total_tokens: 1 } } as any;
      },
    }, { globalTimeoutMs: 35 });
    expect((await result).modelId).toBe('quick');
  });
  it('does not restart the deadline after a hedged primary fails', async () => {
    const old = process.env.DMRX_HEDGE_DELAY_MS;
    process.env.DMRX_HEDGE_DELAY_MS = '1';
    resetHedgeState();
    try {
      let primaryCalls = 0;
      const result = executeWithHedging(plan(true), request, {
        execute: async (id) => {
          if (id === 'fallback') return stalled;
          primaryCalls++;
          await new Promise(resolve => setTimeout(resolve, 65));
          if (primaryCalls === 1) throw new ProviderError('content policy blocked', 'primary', 400);
          return { model: 'late' } as any;
        },
      }, { globalTimeoutMs: 95 });
      expect(await resultWithin(result)).toBe('ProviderUnavailableError');
    } finally {
      if (old === undefined) delete process.env.DMRX_HEDGE_DELAY_MS;
      else process.env.DMRX_HEDGE_DELAY_MS = old;
    }
  });
  it('does not dispatch a hedge when its quota check rejects', async () => {
    const old = process.env.DMRX_HEDGE_DELAY_MS;
    process.env.DMRX_HEDGE_DELAY_MS = '1';
    resetHedgeState();
    const dispatched: string[] = [];
    try {
      const response = await executeWithHedging(plan(true), request, {
        execute: async (id) => {
          dispatched.push(id);
          if (id === 'primary') {
            await new Promise(resolve => setTimeout(resolve, 20));
            return { modelId: 'primary' } as any;
          }
          return { modelId: 'fallback' } as any;
        },
      }, { globalTimeoutMs: 100, tenantId: 'test', quotaService: {
        checkQuota: async (_tenant: string, id: string) => {
          if (id === 'fallback') throw new Error('quota exhausted');
        },
      } as any });
      expect(response.modelId).toBe('primary');
      expect(dispatched).toEqual(['primary']);
    } finally {
      if (old === undefined) delete process.env.DMRX_HEDGE_DELAY_MS;
      else process.env.DMRX_HEDGE_DELAY_MS = old;
    }
  });
  it('bounds stalled success bookkeeping', async () => {
    const result = executeWithFallback(plan(false), request, {
      execute: async () => ({ usage: { total_tokens: 1 } }) as any,
    }, { globalTimeoutMs: 25, tenantId: 'test', quotaService: {
      checkQuota: async () => undefined,
      recordUsage: async () => stalled,
    } as any });
    expect(await resultWithin(result)).toBe('ProviderUnavailableError');
  });
  it('bounds stalled fallback-success bookkeeping', async () => {
    const result = executeWithFallback(plan(true), request, {
      execute: async (providerId) => {
        if (providerId === 'primary') throw new Error('down');
        return { usage: { total_tokens: 1 } } as any;
      },
    }, { globalTimeoutMs: 25, tenantId: 'test', quotaService: {
      checkQuota: async () => undefined,
      recordUsage: async () => stalled,
    } as any });
    expect(await resultWithin(result)).toBe('ProviderUnavailableError');
  });
  it('bounds rate-limit penalty bookkeeping after a failed provider', async () => {
    const result = executeWithFallback(plan(false), request, {
      execute: async () => { throw new ProviderError('rate limit', 'primary', 429); },
    }, { globalTimeoutMs: 25, rateLimitService: {
      checkLimit: () => ({ allowed: true }),
      acquireConcurrencySlot: () => undefined,
      releaseConcurrencySlot: () => undefined,
      addPenalty: () => undefined,
      recordUsage: async () => stalled,
    } as any });
    expect(await resultWithin(result)).toBe('ProviderUnavailableError');
  });
});
