import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../packages/core/src/types/errors.js';
import { executeWithFallback, isModelOnErrorCooldown, resetModelErrorCache } from '../../services/router/src/fallback/fallback-executor.js';

beforeEach(() => resetModelErrorCache());
const request = { modality: 'llm', messages: [{ role: 'user', content: 'OK' }] } as any;
function plan() {
  return { primary: { providerId: 'empty-account', modelId: 'free-model-a', adapterType: 'test', score: 1 }, chain: [{ provider: { providerId: 'working-account', modelId: 'working-model', adapterType: 'test', score: 0.8 }, trigger: 'error', waitMs: 0 }], timeoutMs: 5000, maxRetries: 0 } as any;
}
function limits() {
  return { checkLimit: vi.fn().mockReturnValue({ allowed: true }), recordUsage: vi.fn().mockResolvedValue(undefined), addPenalty: vi.fn(), recordRateLimitHit: vi.fn(), isOnCooldown: vi.fn().mockReturnValue(false), getCooldownExpiry: vi.fn().mockReturnValue(null), setCooldown: vi.fn(), setPaymentRequiredCooldown: vi.fn(), setModelForbiddenCooldown: vi.fn(), acquireConcurrencySlot: vi.fn(), releaseConcurrencySlot: vi.fn() } as any;
}
describe('account-quota readiness rather than model ban', () => {
  it('cools sibling models after a 403 insufficient_user_quota and serves the working fallback', async () => {
    const executor = { execute: vi.fn().mockRejectedValueOnce(new ProviderError('insufficient_user_quota: remaining eligible quota $0.000000', 'tokenrouter', 403)).mockResolvedValue({ modality: 'llm', requestId: 'quota-scope', providerId: 'working-account', modelId: 'working-model', usage: { total_tokens: 1 } }) };
    const result = await executeWithFallback(plan(), request, executor);
    expect(result.providerId).toBe('working-account');
    expect(isModelOnErrorCooldown('empty-account', 'different-free-model')).toBe(true);
    expect(isModelOnErrorCooldown('working-account', 'different-model')).toBe(false);
  });
  it('does not apply a 24-hour model forbidden penalty to account-quota 403', async () => {
    const rls = limits();
    const executor = { execute: vi.fn().mockRejectedValueOnce(new ProviderError('insufficient_user_quota: remaining eligible quota $0.000000', 'tokenrouter', 403)).mockResolvedValue({ modality: 'llm', requestId: 'quota-penalty', providerId: 'working-account', modelId: 'working-model', usage: { total_tokens: 1 } }) };
    await executeWithFallback(plan(), request, executor, { rateLimitService: rls });
    expect(rls.setModelForbiddenCooldown).not.toHaveBeenCalled();
  });
});
