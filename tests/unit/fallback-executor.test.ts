import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeWithFallback, executeWithMultiBindingFallback, resetModelErrorCache } from '../../services/router/src/fallback/fallback-executor.js';
import {
  AllProvidersFailedError,
  ProviderError,
  ProviderUnavailableError,
  QuotaExhaustedError,
} from '../../packages/core/src/types/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Record<string, any> = {}) {
  return {
    primary: { providerId: 'prov-a', modelId: 'model-a', adapterType: 'test', score: 1 },
    chain: [
      { provider: { providerId: 'prov-b', modelId: 'model-b', adapterType: 'test', score: 0.8 }, trigger: 'error' as const, waitMs: 0 },
    ],
    timeoutMs: 30_000,
    maxRetries: 0,
    ...overrides,
  };
}

function makeResponse(overrides: Record<string, any> = {}) {
  return {
    modality: 'llm',
    requestId: 'req-1',
    providerId: 'prov-a',
    modelId: 'model-a',
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    ...overrides,
  };
}

const dummyRequest = { modality: 'llm', messages: [{ role: 'user', content: 'hello' }] } as any;

function createMockRLS() {
  return {
    checkLimit: vi.fn().mockReturnValue({ allowed: true }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    addPenalty: vi.fn().mockReturnValue(0),
    isOnCooldown: vi.fn().mockReturnValue(false),
    getCooldownExpiry: vi.fn().mockReturnValue(null),
    setCooldown: vi.fn(),
    setPaymentRequiredCooldown: vi.fn(),
    setModelForbiddenCooldown: vi.fn(),
    acquireConcurrencySlot: vi.fn(),
    releaseConcurrencySlot: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// executeWithFallback
// ---------------------------------------------------------------------------

describe('executeWithFallback', () => {
  let mockExecutor: { execute: ReturnType<typeof vi.fn> };
  let mockRLS: ReturnType<typeof createMockRLS>;

  beforeEach(() => {
    resetModelErrorCache();
    mockExecutor = { execute: vi.fn() };
    mockRLS = createMockRLS();
  });

  // ---- Primary success ---------------------------------------------------

  describe('primary success', () => {
    it('returns the response from the primary provider', async () => {
      const resp = makeResponse();
      mockExecutor.execute.mockResolvedValue(resp);

      const result = await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      expect(result).toBe(resp);
      expect(mockExecutor.execute).toHaveBeenCalledWith('prov-a', 'model-a', dummyRequest);
    });

    it('records usage via rateLimitService on success', async () => {
      mockExecutor.execute.mockResolvedValue(makeResponse());

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      expect(mockRLS.recordUsage).toHaveBeenCalledWith('prov-a', 'model-a', 30);
    });

    it('calls onSuccess callback with the provider id', async () => {
      mockExecutor.execute.mockResolvedValue(makeResponse());
      const onSuccess = vi.fn();

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
        onSuccess,
      });

      expect(onSuccess).toHaveBeenCalledWith('prov-a');
    });

    it('invokes quotaService.checkQuota before execution when provided', async () => {
      mockExecutor.execute.mockResolvedValue(makeResponse());
      const mockQS = {
        checkQuota: vi.fn().mockResolvedValue(undefined),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        recordProviderBudgetUsage: vi.fn().mockResolvedValue(undefined),
      };

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
        quotaService: mockQS,
        tenantId: 'tenant-1',
      });

      expect(mockQS.checkQuota).toHaveBeenCalledWith('tenant-1', 'prov-a', 0, 0);
    });

    it('records usage via quotaService on success', async () => {
      mockExecutor.execute.mockResolvedValue(makeResponse());
      const mockQS = {
        checkQuota: vi.fn().mockResolvedValue(undefined),
        recordUsage: vi.fn().mockResolvedValue(undefined),
        recordProviderBudgetUsage: vi.fn().mockResolvedValue(undefined),
      };

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
        quotaService: mockQS,
        tenantId: 'tenant-1',
      });

      expect(mockQS.recordUsage).toHaveBeenCalledWith('tenant-1', 'prov-a', 30, 0);
      expect(mockQS.recordProviderBudgetUsage).toHaveBeenCalledWith('tenant-1', 'prov-a', 30);
    });
  });

  // ---- Primary rate-limit / error classification -------------------------

  describe('primary rate-limited by checkLimit', () => {
    it('skips primary when checkLimit returns allowed:false', async () => {
      // First call (primary): rate-limited. Subsequent calls (fallback): allowed.
      mockRLS.checkLimit
        .mockReturnValueOnce({ allowed: false, retryAfterMs: 2000, reason: 'RPM exceeded' })
        .mockReturnValue({ allowed: true });
      const fallbackResp = makeResponse({ providerId: 'prov-b', modelId: 'model-b' });
      mockExecutor.execute.mockResolvedValue(fallbackResp);

      const result = await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      // Only the fallback executor should have been called
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1);
      expect(mockExecutor.execute).toHaveBeenCalledWith('prov-b', 'model-b', dummyRequest);
      expect(result).toBe(fallbackResp);
    });
  });

  describe('primary 429 rate-limit error', () => {
    it('adds penalty and records zero usage then falls through to fallback', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Rate limited', 'prov-a', 429))
        .mockResolvedValueOnce(makeResponse({ providerId: 'prov-b', modelId: 'model-b' }));

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      expect(mockRLS.addPenalty).toHaveBeenCalledWith('prov-a', 'model-a');
      expect(mockRLS.recordUsage).toHaveBeenCalledWith('prov-a', 'model-a', 0);
      // Fallback was called
      expect(mockExecutor.execute).toHaveBeenCalledWith('prov-b', 'model-b', dummyRequest);
    });
  });

  describe('primary 402 payment required', () => {
    it('sets 24h cooldown via setPaymentRequiredCooldown', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Payment required', 'prov-a', 402))
        .mockResolvedValueOnce(makeResponse({ providerId: 'prov-b', modelId: 'model-b' }));

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      expect(mockRLS.setPaymentRequiredCooldown).toHaveBeenCalledWith('prov-a', 'model-a');
    });
  });

  describe('primary 403 forbidden', () => {
    it('sets 24h cooldown via setModelForbiddenCooldown', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Forbidden', 'prov-a', 403))
        .mockResolvedValueOnce(makeResponse({ providerId: 'prov-b', modelId: 'model-b' }));

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      expect(mockRLS.setModelForbiddenCooldown).toHaveBeenCalledWith('prov-a', 'model-a');
    });
  });

  describe('primary 529 / 530 provider overloaded', () => {
    it('sets 5-minute cooldown via setCooldown on 529', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Overloaded', 'prov-a', 529))
        .mockResolvedValueOnce(makeResponse({ providerId: 'prov-b', modelId: 'model-b' }));

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      expect(mockRLS.setCooldown).toHaveBeenCalledWith('prov-a', 'model-a', 5 * 60_000);
    });

    it('sets 5-minute cooldown on 530', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Overloaded', 'prov-a', 530))
        .mockResolvedValueOnce(makeResponse({ providerId: 'prov-b', modelId: 'model-b' }));

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      expect(mockRLS.setCooldown).toHaveBeenCalledWith('prov-a', 'model-a', 5 * 60_000);
    });
  });

  describe('primary 404 model_not_found', () => {
    it('tracks model error and skips same model in fallback chain', async () => {
      // Primary: prov-404-a:model-404-a  -> throws 404
      // Fallback chain:
      //   1. prov-404-a:model-404-a  -> should be skipped (on cooldown)
      //   2. prov-404-b:model-404-b  -> succeeds
      const plan = makePlan({
        primary: { providerId: 'prov-404-a', modelId: 'model-404-a', adapterType: 'test', score: 1 },
        chain: [
          { provider: { providerId: 'prov-404-a', modelId: 'model-404-a', adapterType: 'test', score: 0.7 }, trigger: 'error' as const, waitMs: 0 },
          { provider: { providerId: 'prov-404-b', modelId: 'model-404-b', adapterType: 'test', score: 0.5 }, trigger: 'error' as const, waitMs: 0 },
        ],
      });

      const fallbackResp = makeResponse({ providerId: 'prov-404-b', modelId: 'model-404-b' });

      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Model not found', 'prov-404-a', 404))
        .mockResolvedValueOnce(fallbackResp);

      const result = await executeWithFallback(plan, dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      // Only the third step (prov-404-b) should execute — primary (404) and first fallback (same model, skipped) don't count
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
      expect(mockExecutor.execute).toHaveBeenLastCalledWith('prov-404-b', 'model-404-b', dummyRequest);
      expect(result).toBe(fallbackResp);
    });
  });

  describe('primary 401 auth_error', () => {
    it('tracks model error and skips same model in fallback chain', async () => {
      const plan = makePlan({
        primary: { providerId: 'prov-auth-a', modelId: 'model-auth-a', adapterType: 'test', score: 1 },
        chain: [
          { provider: { providerId: 'prov-auth-a', modelId: 'model-auth-a', adapterType: 'test', score: 0.7 }, trigger: 'error' as const, waitMs: 0 },
          { provider: { providerId: 'prov-auth-b', modelId: 'model-auth-b', adapterType: 'test', score: 0.5 }, trigger: 'error' as const, waitMs: 0 },
        ],
      });

      const fallbackResp = makeResponse({ providerId: 'prov-auth-b', modelId: 'model-auth-b' });

      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Unauthorized', 'prov-auth-a', 401))
        .mockResolvedValueOnce(fallbackResp);

      const result = await executeWithFallback(plan, dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
      expect(mockExecutor.execute).toHaveBeenLastCalledWith('prov-auth-b', 'model-auth-b', dummyRequest);
      expect(result).toBe(fallbackResp);
    });
  });

  describe('primary QuotaExhaustedError', () => {
    it('falls through to fallback chain without cooldown', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new QuotaExhaustedError())
        .mockResolvedValueOnce(makeResponse({ providerId: 'prov-b', modelId: 'model-b' }));

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      // No cooldown set for QuotaExhaustedError
      expect(mockRLS.setCooldown).not.toHaveBeenCalled();
      expect(mockRLS.setPaymentRequiredCooldown).not.toHaveBeenCalled();
      expect(mockRLS.setModelForbiddenCooldown).not.toHaveBeenCalled();
      expect(mockRLS.addPenalty).not.toHaveBeenCalled();
      // Fallback tried
      expect(mockExecutor.execute).toHaveBeenLastCalledWith('prov-b', 'model-b', dummyRequest);
    });
  });

  // ---- Fallback chain ----------------------------------------------------

  describe('fallback chain', () => {
    it('tries fallback when primary fails and returns fallback response', async () => {
      const fallbackResp = makeResponse({ providerId: 'prov-b', modelId: 'model-b' });
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Server error', 'prov-a', 500))
        .mockResolvedValueOnce(fallbackResp);

      const result = await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
      });

      expect(result).toBe(fallbackResp);
      expect(mockExecutor.execute).toHaveBeenCalledWith('prov-b', 'model-b', dummyRequest);
    });

    it('throws AllProvidersFailedError when all providers fail with non-rate-limit errors', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Server error', 'prov-a', 500))
        .mockRejectedValueOnce(new ProviderError('Server error', 'prov-b', 500));

      await expect(
        executeWithFallback(makePlan(), dummyRequest, mockExecutor, { rateLimitService: mockRLS }),
      ).rejects.toThrow(AllProvidersFailedError);
    });

    it('throws ProviderUnavailableError when all errors are rate-limit (429)', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Rate limited', 'prov-a', 429))
        .mockRejectedValueOnce(new ProviderError('Rate limited', 'prov-b', 429));

      await expect(
        executeWithFallback(makePlan(), dummyRequest, mockExecutor, { rateLimitService: mockRLS }),
      ).rejects.toThrow(ProviderUnavailableError);
    });

    it('applies 429 handling (addPenalty + recordUsage) on fallback step errors', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Server error', 'prov-a', 500))
        .mockRejectedValueOnce(new ProviderError('Rate limited', 'prov-b', 429));

      const plan = makePlan();
      plan.chain.push({
        provider: { providerId: 'prov-c', modelId: 'model-c', adapterType: 'test', score: 0.3 },
        trigger: 'error' as const,
        waitMs: 0,
      });
      mockExecutor.execute.mockResolvedValueOnce(makeResponse({ providerId: 'prov-c', modelId: 'model-c' }));

      await executeWithFallback(plan, dummyRequest, mockExecutor, { rateLimitService: mockRLS });

      // addPenalty should have been called for the fallback step that got 429
      expect(mockRLS.addPenalty).toHaveBeenCalledWith('prov-b', 'model-b');
      expect(mockRLS.recordUsage).toHaveBeenCalledWith('prov-b', 'model-b', 0);
    });

    it('applies 402 cooldown on fallback step errors', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Server error', 'prov-a', 500))
        .mockRejectedValueOnce(new ProviderError('Payment required', 'prov-b', 402));

      const plan = makePlan();
      plan.chain.push({
        provider: { providerId: 'prov-c', modelId: 'model-c', adapterType: 'test', score: 0.3 },
        trigger: 'error' as const,
        waitMs: 0,
      });
      mockExecutor.execute.mockResolvedValueOnce(makeResponse({ providerId: 'prov-c', modelId: 'model-c' }));

      await executeWithFallback(plan, dummyRequest, mockExecutor, { rateLimitService: mockRLS });

      expect(mockRLS.setPaymentRequiredCooldown).toHaveBeenCalledWith('prov-b', 'model-b');
    });

    it('re-checks rate limit before each fallback and skips rate-limited ones', async () => {
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Server error', 'prov-a', 500));

      const plan = makePlan();
      plan.chain = [
        { provider: { providerId: 'prov-rate', modelId: 'model-rate', adapterType: 'test', score: 0.7 }, trigger: 'error' as const, waitMs: 0 },
        { provider: { providerId: 'prov-ok', modelId: 'model-ok', adapterType: 'test', score: 0.5 }, trigger: 'error' as const, waitMs: 0 },
      ];

      mockRLS.checkLimit.mockImplementation((providerId: string) => {
        if (providerId === 'prov-rate') return { allowed: false, retryAfterMs: 1000, reason: 'RPM' };
        return { allowed: true };
      });

      const okResp = makeResponse({ providerId: 'prov-ok', modelId: 'model-ok' });
      mockExecutor.execute.mockResolvedValue(okResp);

      const result = await executeWithFallback(plan, dummyRequest, mockExecutor, { rateLimitService: mockRLS });

      // prov-rate was skipped, prov-ok was tried
      expect(mockExecutor.execute).toHaveBeenCalledWith('prov-ok', 'model-ok', dummyRequest);
      expect(result).toBe(okResp);
    });
  });

  // ---- Key rotation ------------------------------------------------------

  describe('key rotation on 429', () => {
    it('retries with the next key on the same provider when primary returns 429', async () => {
      const mockKeyRotation = {
        getNextKey: vi.fn().mockReturnValue('key-2'),
      };

      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Rate limited', 'prov-a', 429))
        .mockResolvedValueOnce(makeResponse()); // key retry succeeds

      const result = await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
        keyRotationService: mockKeyRotation as any,
      });

      expect(mockKeyRotation.getNextKey).toHaveBeenCalledWith('prov-a', 'model-a');
      // executor called a second time with same provider/model (new key underneath)
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
      expect(mockExecutor.execute).toHaveBeenLastCalledWith('prov-a', 'model-a', dummyRequest);
      // Should return the retry response, not fall through to fallback
      const expectedResp = await mockExecutor.execute.mock.results[1].value;
      expect(result).toStrictEqual(expectedResp);
    });

    it('falls through to cross-provider fallback when key rotation returns no key', async () => {
      const mockKeyRotation = {
        getNextKey: vi.fn().mockReturnValue(undefined),
      };

      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Rate limited', 'prov-a', 429))
        .mockResolvedValueOnce(makeResponse({ providerId: 'prov-b', modelId: 'model-b' }));

      const result = await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
        keyRotationService: mockKeyRotation as any,
      });

      // Falls through to fallback chain since no next key
      expect(mockExecutor.execute).toHaveBeenLastCalledWith('prov-b', 'model-b', dummyRequest);
      expect(result.providerId).toBe('prov-b');
    });

    it('falls through to cross-provider fallback when key rotation retry also fails', async () => {
      const mockKeyRotation = {
        getNextKey: vi.fn().mockReturnValue('key-2'),
      };

      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Rate limited', 'prov-a', 429)) // primary
        .mockRejectedValueOnce(new ProviderError('Rate limited', 'prov-a', 429)) // key retry
        .mockResolvedValueOnce(makeResponse({ providerId: 'prov-b', modelId: 'model-b' })); // fallback

      const result = await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
        keyRotationService: mockKeyRotation as any,
      });

      expect(mockExecutor.execute).toHaveBeenCalledTimes(3);
      expect(result.providerId).toBe('prov-b');
    });
  });

  // ---- Callbacks ---------------------------------------------------------

  describe('callbacks', () => {
    it('calls onFailure with primary providerId on primary error', async () => {
      const onFailure = vi.fn();
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Error', 'prov-a', 500))
        .mockResolvedValueOnce(makeResponse({ providerId: 'prov-b', modelId: 'model-b' }));

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
        onFailure,
      });

      expect(onFailure).toHaveBeenCalledWith('prov-a');
    });

    it('calls onSuccess with fallback providerId when fallback succeeds', async () => {
      const onSuccess = vi.fn();
      mockExecutor.execute
        .mockRejectedValueOnce(new ProviderError('Error', 'prov-a', 500))
        .mockResolvedValueOnce(makeResponse({ providerId: 'prov-b', modelId: 'model-b' }));

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
        onSuccess,
      });

      expect(onSuccess).toHaveBeenCalledWith('prov-b');
    });
  });

  // ---- Concurrency slots -------------------------------------------------

  describe('concurrency slot management', () => {
    it('acquires and releases concurrency slot for primary execution', async () => {
      mockExecutor.execute.mockResolvedValue(makeResponse());

      await executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
        rateLimitService: mockRLS,
        requestId: 'test-req',
      });

      expect(mockRLS.acquireConcurrencySlot).toHaveBeenCalledWith('prov-a', 'prov-a:test-req');
      expect(mockRLS.releaseConcurrencySlot).toHaveBeenCalledWith('prov-a', 'prov-a:test-req');
    });

    it('releases concurrency slot even when execution throws', async () => {
      mockExecutor.execute.mockRejectedValue(new ProviderError('Error', 'prov-a', 500));

      await expect(
        executeWithFallback(makePlan(), dummyRequest, mockExecutor, {
          rateLimitService: mockRLS,
          requestId: 'test-req',
        }),
      ).rejects.toThrow();

      expect(mockRLS.releaseConcurrencySlot).toHaveBeenCalledWith('prov-a', 'prov-a:test-req');
    });
  });
});

// ---------------------------------------------------------------------------
// executeWithMultiBindingFallback
// ---------------------------------------------------------------------------

describe('executeWithMultiBindingFallback', () => {
  let mockExecutor: { execute: ReturnType<typeof vi.fn> };
  let mockRLS: ReturnType<typeof createMockRLS>;

  beforeEach(() => {
    resetModelErrorCache();
    mockExecutor = { execute: vi.fn() };
    mockRLS = createMockRLS();
  });

  it('delegates to executeWithFallback when bindings is undefined', async () => {
    mockExecutor.execute.mockResolvedValue(makeResponse());

    const result = await executeWithMultiBindingFallback(
      makePlan(),
      dummyRequest,
      mockExecutor,
      undefined,
      { rateLimitService: mockRLS },
    );

    expect(result.providerId).toBe('prov-a');
    expect(mockExecutor.execute).toHaveBeenCalledWith('prov-a', 'model-a', dummyRequest);
  });

  it('delegates to executeWithFallback when crossBindingFailover is false', async () => {
    mockExecutor.execute.mockResolvedValue(makeResponse());

    const result = await executeWithMultiBindingFallback(
      makePlan(),
      dummyRequest,
      mockExecutor,
      { primary: { providerId: 'b-prov-a', modelId: 'b-model-a' }, fallbacks: [], crossBindingFailover: false },
      { rateLimitService: mockRLS },
    );

    // Still uses the plan's primary (not the binding) because crossBindingFailover is false
    expect(result.providerId).toBe('prov-a');
  });

  it('tries primary binding then falls back to next binding on failure', async () => {
    const plan = makePlan({
      primary: { providerId: 'b-p1', modelId: 'b-m1', adapterType: 'test', score: 1 },
      chain: [
        { provider: { providerId: 'b-p1-fb', modelId: 'b-m1-fb', adapterType: 'test', score: 0.7 }, trigger: 'error' as const, waitMs: 0 },
      ],
    });

    const bindings = {
      primary: { providerId: 'binding-1', modelId: 'binding-m1' },
      fallbacks: [{ providerId: 'binding-2', modelId: 'binding-m2' }],
      crossBindingFailover: true,
    };

    // Binding 1: primary (binding-1) fails, fallback (b-p1-fb) fails -> AllProvidersFailedError
    // Caught by outer try/catch, proceeds to binding 2
    mockExecutor.execute
      .mockRejectedValueOnce(new ProviderError('Error', '', 500))
      .mockRejectedValueOnce(new ProviderError('Error', '', 500))
      // Binding 2: primary (binding-2) succeeds
      .mockResolvedValueOnce(makeResponse({ providerId: 'binding-2', modelId: 'binding-m2' }));

    const result = await executeWithMultiBindingFallback(plan, dummyRequest, mockExecutor, bindings, {
      rateLimitService: mockRLS,
    });

    expect(result.providerId).toBe('binding-2');
    // Should have called execute 3 times: b-p1, b-p1-fb (both fail), then binding-2 succeeds
    expect(mockExecutor.execute).toHaveBeenCalledTimes(3);
    expect(mockExecutor.execute).toHaveBeenLastCalledWith('binding-2', 'binding-m2', dummyRequest);
  });

  it('throws AllProvidersFailedError when all bindings are exhausted', async () => {
    const plan = makePlan({
      primary: { providerId: 'ex-p1', modelId: 'ex-m1', adapterType: 'test', score: 1 },
      chain: [
        { provider: { providerId: 'ex-p1-fb', modelId: 'ex-m1-fb', adapterType: 'test', score: 0.7 }, trigger: 'error' as const, waitMs: 0 },
      ],
    });

    const bindings = {
      primary: { providerId: 'ex-b1', modelId: 'ex-bm1' },
      fallbacks: [{ providerId: 'ex-b2', modelId: 'ex-bm2' }],
      crossBindingFailover: true,
    };

    // Binding 1: primary (ex-b1) fails, fallback (ex-p1-fb) fails
    // Binding 2: primary (ex-b2) fails, fallback (ex-p1-fb) fails
    mockExecutor.execute
      .mockRejectedValueOnce(new ProviderError('Error', '', 500))
      .mockRejectedValueOnce(new ProviderError('Error', '', 500))
      .mockRejectedValueOnce(new ProviderError('Error', '', 500))
      .mockRejectedValueOnce(new ProviderError('Error', '', 500));

    await expect(
      executeWithMultiBindingFallback(plan, dummyRequest, mockExecutor, bindings, {
        rateLimitService: mockRLS,
      }),
    ).rejects.toThrow(AllProvidersFailedError);
  });
});
