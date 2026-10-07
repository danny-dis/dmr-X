import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../packages/core/src/types/errors.js';
import { executeWithFallback, isModelOnErrorCooldown, resetModelErrorCache } from '../../services/router/src/fallback/fallback-executor.js';

const request = { modality: 'llm', messages: [{ role: 'user', content: 'OK' }] } as any;
const response = (providerId: string, modelId: string) => ({
  modality: 'llm', requestId: `${providerId}-${modelId}`, providerId, modelId, usage: { total_tokens: 1 },
});
const step = (providerId: string, modelId: string) => ({
  provider: { providerId, modelId, adapterType: 'test', score: 1 }, trigger: 'error', waitMs: 0,
});
const plan = (primaryId: string, primaryModel: string, chain: any[] = []) => ({
  primary: { providerId: primaryId, modelId: primaryModel, adapterType: 'test', score: 1 },
  chain,
  timeoutMs: 5_000,
  maxRetries: 0,
}) as any;
const limits = () => ({
  checkLimit: vi.fn().mockReturnValue({ allowed: true }),
  recordUsage: vi.fn().mockResolvedValue(undefined),
  addPenalty: vi.fn(),
  recordRateLimitHit: vi.fn(),
  setCooldown: vi.fn(),
  setPaymentRequiredCooldown: vi.fn(),
  setModelForbiddenCooldown: vi.fn(),
  acquireConcurrencySlot: vi.fn(),
  releaseConcurrencySlot: vi.fn(),
}) as any;

beforeEach(() => resetModelErrorCache());

describe('fallback readiness regressions', () => {
  it('skips a cooled primary and dispatches its healthy alternate', async () => {
    const executor = { execute: vi.fn() };
    executor.execute.mockRejectedValueOnce(new ProviderError('temporary upstream error', 'cooled-primary', 500));
    await expect(executeWithFallback(plan('cooled-primary', 'model-a'), request, executor)).rejects.toThrow();

    executor.execute.mockReset().mockResolvedValue(response('healthy', 'model-b'));
    const result = await executeWithFallback(plan('cooled-primary', 'model-a', [step('healthy', 'model-b')]), request, executor);

    expect(result.providerId).toBe('healthy');
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledWith('healthy', 'model-b', request);
  });

  it('tries the healthy minority when at least 80 percent of the pool is cooled', async () => {
    const executor = { execute: vi.fn().mockRejectedValue(new ProviderError('temporary upstream error', 'any', 500)) };
    for (const [providerId, modelId] of [['dead-1', 'a'], ['dead-2', 'b'], ['dead-3', 'c'], ['dead-4', 'd']]) {
      await expect(executeWithFallback(plan(providerId, modelId), request, executor)).rejects.toThrow();
    }

    executor.execute.mockReset().mockResolvedValue(response('healthy', 'e'));
    const result = await executeWithFallback(plan('dead-1', 'a', [step('dead-2', 'b'), step('dead-3', 'c'), step('dead-4', 'd'), step('healthy', 'e')]), request, executor);

    expect(result.providerId).toBe('healthy');
    expect(executor.execute).toHaveBeenCalledWith('healthy', 'e', request);
  });

  it('treats 429 insufficient_quota as provider-wide for primary and sequential fallbacks', async () => {
    const primaryExecutor = { execute: vi.fn()
      .mockRejectedValueOnce(new ProviderError('insufficient_quota', 'empty-primary', 429))
      .mockResolvedValueOnce(response('working', 'model')) };
    await executeWithFallback(plan('empty-primary', 'a', [step('working', 'model')]), request, primaryExecutor);
    expect(isModelOnErrorCooldown('empty-primary', 'sibling')).toBe(true);

    resetModelErrorCache();
    const fallbackExecutor = { execute: vi.fn()
      .mockRejectedValueOnce(new ProviderError('upstream error', 'primary', 500))
      .mockRejectedValueOnce(new ProviderError('insufficient_quota', 'empty-fallback', 429))
      .mockResolvedValueOnce(response('working', 'model')) };
    await executeWithFallback(plan('primary', 'a', [step('empty-fallback', 'b'), step('working', 'model')]), request, fallbackExecutor);
    expect(isModelOnErrorCooldown('empty-fallback', 'sibling')).toBe(true);
  });

  it('does not penalize or cool parallel admission skips', async () => {
    const priming = { execute: vi.fn().mockRejectedValue(new ProviderError('upstream error', 'cooled', 500)) };
    await expect(executeWithFallback(plan('cooled', 'a'), request, priming)).rejects.toThrow();
    const rls = limits();
    rls.checkLimit.mockImplementation((providerId: string) => providerId === 'limited'
      ? { allowed: false, retryAfterMs: 1_000, reason: 'RPM' }
      : { allowed: true });
    const quota = { checkQuota: vi.fn().mockImplementation(async (_tenant: string, providerId: string) => {
      if (providerId === 'quota-rejected') throw new Error('quota admission rejected');
    }) } as any;
    const onFailure = vi.fn();
    const executor = { execute: vi.fn()
      .mockRejectedValueOnce(new ProviderError('upstream error', 'primary', 500))
      .mockResolvedValueOnce(response('healthy', 'e')) };

    const result = await executeWithFallback(
      plan('primary', 'a', [step('cooled', 'a'), step('limited', 'b'), step('quota-rejected', 'c'), step('healthy', 'e')]),
      request,
      executor,
      { rateLimitService: rls, quotaService: quota, tenantId: 'tenant', onFailure },
    );

    expect(result.providerId).toBe('healthy');
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(rls.addPenalty).not.toHaveBeenCalled();
    expect(rls.setPaymentRequiredCooldown).not.toHaveBeenCalled();
    expect(rls.setModelForbiddenCooldown).not.toHaveBeenCalled();
    expect(isModelOnErrorCooldown('limited', 'b')).toBe(false);
    expect(isModelOnErrorCooldown('quota-rejected', 'c')).toBe(false);
  });
});
