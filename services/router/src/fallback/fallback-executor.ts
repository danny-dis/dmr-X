import type { RoutingPlan, UnifiedRequest, UnifiedResponse, ModelBinding } from '@dmr-x/core';
import { AllProvidersFailedError, ProviderError, ProviderUnavailableError, QuotaExhaustedError } from '@dmr-x/core';
import type { RateLimitService, QuotaService, KeyRotationService } from '@dmr-x/quota';
import { logger } from '@dmr-x/utils';

// Model error tracking: temporarily skip models that returned 404/410
// TTL: 1 hour for deprecated models, 5 minutes for other errors
const MODEL_ERROR_TTL: Record<string, number> = {
  'model_not_found': 60 * 60_000,     // 1 hour
  'auth_error': 24 * 60 * 60_000,     // 24 hours
  'provider_overloaded': 5 * 60_000,  // 5 minutes
};
const modelErrorCache = new Map<string, { category: string; expiresAt: number }>();

export interface AdapterExecutor {
  execute(
    providerId: string,
    modelId: string,
    request: UnifiedRequest
  ): Promise<UnifiedResponse>;
}

export interface FallbackStepConfig {
  /** Trigger: when to use this fallback */
  trigger: 'error' | 'timeout' | 'rate_limit' | 'context_window' | 'content_policy';
  /** Provider/model to fallback to */
  providerId: string;
  modelId: string;
  /** Delay before trying this fallback (ms) */
  waitMs?: number;
}

export interface FallbackOptions {
  rateLimitService?: RateLimitService;
  quotaService?: QuotaService;
  tenantId?: string;
  requestId?: string;
  onSuccess?: (providerId: string) => void;
  onFailure?: (providerId: string) => void;
  /** Optional configured fallback chain (from config.yaml) */
  configuredFallbacks?: FallbackStepConfig[];
  /** Key rotation service for same-provider key retry */
  keyRotationService?: KeyRotationService;
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 429;
  }
  return false;
}

function isPaymentRequiredError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 402;
  }
  return false;
}

function isForbiddenError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 403;
  }
  return false;
}

function isProviderOverloadedError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 529 || error.statusCode === 530;
  }
  return false;
}

function isModelNotFoundError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.statusCode === 404 || error.statusCode === 410) return true;
  if (error.statusCode === 400) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('model not found') ||
      msg.includes('model_not_found') ||
      msg.includes('model not supported') ||
      msg.includes('model_required') ||
      msg.includes('unknown model') ||
      msg.includes('model does not exist')
    );
  }
  return false;
}

function isAuthError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 401;
  }
  return false;
}

function isInsufficientQuotaError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('insufficient_quota') ||
    msg.includes('insufficient quota') ||
    msg.includes('quota_exhausted') ||
    msg.includes('out of credits') ||
    msg.includes('payment_required')
  );
}

function isQuotaError(error: unknown): boolean {
  return error instanceof QuotaExhaustedError;
}

/**
 * Detect context-window errors (input too long).
 * Providers return 400/413/422 with messages about context length, max tokens, etc.
 */
function isContextWindowError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.statusCode !== 400 && error.statusCode !== 413 && error.statusCode !== 422) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('context_length') ||
    msg.includes('context window') ||
    msg.includes('maximum context') ||
    msg.includes('token limit') ||
    msg.includes('too many tokens') ||
    msg.includes('input is too long') ||
    msg.includes('max_tokens') ||
    msg.includes('request too large') ||
    msg.includes('payload too large')
  );
}

/**
 * Detect content-policy / moderation errors.
 * Providers return 400/422 with messages about content filtering.
 */
function isContentPolicyError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.statusCode !== 400 && error.statusCode !== 422) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('content_policy') ||
    msg.includes('content policy') ||
    msg.includes('safety') ||
    msg.includes('blocked') ||
    msg.includes('content filter') ||
    msg.includes('moderation') ||
    msg.includes('flagged') ||
    msg.includes('harmful') ||
    msg.includes('violates')
  );
}

/**
 * Determine the error category for fallback routing.
 */
function classifyError(error: unknown): 'rate_limit' | 'context_window' | 'content_policy' | 'quota' | 'model_not_found' | 'auth_error' | 'provider_overloaded' | 'insufficient_quota' | 'error' {
  if (isRateLimitError(error)) return 'rate_limit';
  if (isContextWindowError(error)) return 'context_window';
  if (isContentPolicyError(error)) return 'content_policy';
  if (isQuotaError(error)) return 'quota';
  if (isModelNotFoundError(error)) return 'model_not_found';
  if (isAuthError(error)) return 'auth_error';
  if (isProviderOverloadedError(error)) return 'provider_overloaded';
  if (isInsufficientQuotaError(error)) return 'insufficient_quota';
  return 'error';
}

function trackModelError(providerId: string, modelId: string, category: string): void {
  const ttl = MODEL_ERROR_TTL[category] || 5 * 60_000;
  const key = `${providerId}:${modelId}`;
  modelErrorCache.set(key, { category, expiresAt: Date.now() + ttl });
  logger.warn({ providerId, modelId, category, ttl }, 'Tracked model error — will skip for cooldown period');
}

function isModelOnErrorCooldown(providerId: string, modelId: string): boolean {
  const key = `${providerId}:${modelId}`;
  const entry = modelErrorCache.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    modelErrorCache.delete(key);
    return false;
  }
  return true;
}

export async function executeWithFallback(
  plan: RoutingPlan,
  request: UnifiedRequest,
  executor: AdapterExecutor,
  options?: FallbackOptions
): Promise<UnifiedResponse> {
  const tried: string[] = [];
  const rls = options?.rateLimitService;
  const qs = options?.quotaService;
  const tenantId = options?.tenantId;
  let anyNonRateLimitError = false;
  let primaryErrorRaw: unknown = null;
  const requestId = options?.requestId || crypto.randomUUID();

  // Helper: acquire concurrency slot for a provider, release on completion via finally
  async function withConcurrencySlot<T>(
    providerId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const slotId = `${providerId}:${requestId}`;
    if (rls) {
      rls.acquireConcurrencySlot(providerId, slotId);
    }
    try {
      return await fn();
    } finally {
      if (rls) {
        rls.releaseConcurrencySlot(providerId, slotId);
      }
    }
  }

  // Try primary
  try {
    // Check rate limit before executing
    if (rls) {
      const limitCheck = rls.checkLimit(plan.primary.providerId, plan.primary.modelId, 0);
      if (!limitCheck.allowed) {
        logger.info({ provider: plan.primary.providerId, retryAfterMs: limitCheck.retryAfterMs }, 'Primary provider rate-limited, skipping');
        tried.push(plan.primary.providerId);
        throw new Error(`Rate limited: ${limitCheck.reason}`);
      }
    }

    // Check quota before executing
    if (qs && tenantId) {
      await qs.checkQuota(tenantId, plan.primary.providerId, 0, 0);
    }
    tried.push(plan.primary.providerId);
    const response = await withConcurrencySlot(plan.primary.providerId, () =>
      executor.execute(plan.primary.providerId, plan.primary.modelId, request)
    );
    // Record circuit breaker success (wrapped in try/catch)
    try { options?.onSuccess?.(plan.primary.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onSuccess callback error'); }
    // Record successful usage (fire-and-forget, never fail the request)
    try {
      if (rls) {
        const tokens = response.usage?.total_tokens || 0;
        await rls.recordUsage(plan.primary.providerId, plan.primary.modelId, tokens);
      }
      if (qs && tenantId) {
        const tokens = response.usage?.total_tokens || 0;
        await qs.recordUsage(tenantId, plan.primary.providerId, tokens, 0);
        await qs.recordProviderBudgetUsage(tenantId, plan.primary.providerId, tokens);
      }
    } catch (usageErr) {
      logger.warn({ err: usageErr, provider: plan.primary.providerId, requestId: options?.requestId }, 'Failed to record usage for primary provider');
    }
    return response;
  } catch (error) {
    primaryErrorRaw = error;
    // Record circuit breaker failure (wrapped in try/catch to prevent callback errors from breaking fallback chain)
    try { options?.onFailure?.(plan.primary.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onFailure callback error'); }
    if (!isRateLimitError(error)) {
      anyNonRateLimitError = true;
    }
    if (isQuotaError(error)) {
      logger.warn({ provider: plan.primary.providerId, requestId: options?.requestId }, 'Primary provider quota exhausted');
    } else {
      logger.warn({ err: error, provider: plan.primary.providerId, requestId: options?.requestId }, 'Primary provider failed');
    }
    // On 429, add penalty and record usage
    if (rls && isRateLimitError(error)) {
      rls.addPenalty(plan.primary.providerId, plan.primary.modelId);
      try {
        await rls.recordUsage(plan.primary.providerId, plan.primary.modelId, 0);
      } catch (usageErr) {
        logger.warn({ err: usageErr, provider: plan.primary.providerId }, 'Failed to record rate limit usage');
      }
    }
    // On 402 (Payment Required), apply 24h cooldown — model needs credit to work
    if (rls && isPaymentRequiredError(error)) {
      rls.setPaymentRequiredCooldown(plan.primary.providerId, plan.primary.modelId);
      logger.warn(
        { provider: plan.primary.providerId, modelId: plan.primary.modelId },
        'Payment required (402) — applying 24h cooldown'
      );
    }
    // On 403 (Forbidden), apply 24h cooldown — model is not accessible
    if (rls && isForbiddenError(error)) {
      rls.setModelForbiddenCooldown(plan.primary.providerId, plan.primary.modelId);
      logger.warn(
        { provider: plan.primary.providerId, modelId: plan.primary.modelId },
        'Model forbidden (403) — applying 24h cooldown'
      );
    }
    // On 529/530 (Provider Overloaded), apply 5-minute cooldown
    if (rls && isProviderOverloadedError(error)) {
      rls.setCooldown(plan.primary.providerId, plan.primary.modelId, 5 * 60_000);
      logger.warn(
        { provider: plan.primary.providerId, statusCode: error instanceof ProviderError ? error.statusCode : 'unknown' },
        'Provider overloaded — applying 5-minute cooldown'
      );
    }
  }

  // Same-provider key retry: if primary failed with rate limit, try next key on same provider
  if (isRateLimitError(primaryErrorRaw) && options?.keyRotationService) {
    const nextKey = options.keyRotationService.getNextKey(plan.primary.providerId, plan.primary.modelId);
    if (nextKey) {
      try {
        logger.info({ provider: plan.primary.providerId }, 'Trying next key on same provider');
        const response = await withConcurrencySlot(plan.primary.providerId, () =>
          executor.execute(plan.primary.providerId, plan.primary.modelId, request)
        );
        try { options?.onSuccess?.(plan.primary.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onSuccess callback error'); }
        try {
          if (rls) {
            const tokens = response.usage?.total_tokens || 0;
            await rls.recordUsage(plan.primary.providerId, plan.primary.modelId, tokens);
          }
          if (qs && tenantId) {
            const tokens = response.usage?.total_tokens || 0;
            await qs.recordUsage(tenantId, plan.primary.providerId, tokens, 0);
            await qs.recordProviderBudgetUsage(tenantId, plan.primary.providerId, tokens);
          }
        } catch (usageErr) {
          logger.warn({ err: usageErr, provider: plan.primary.providerId }, 'Failed to record usage for key retry');
        }
        return response;
      } catch (keyRetryError) {
        logger.warn({ err: keyRetryError, provider: plan.primary.providerId }, 'Key retry also failed, falling through to cross-provider fallback');
        try { options?.onFailure?.(plan.primary.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onFailure callback error'); }
      }
    }
  }

  // Classify the primary error for smart fallback selection
  const errorCategory = classifyError(primaryErrorRaw);
  // Track model-level errors so we skip them on subsequent attempts
  if (errorCategory === 'model_not_found' || errorCategory === 'auth_error') {
    trackModelError(plan.primary.providerId, plan.primary.modelId, errorCategory);
  }

  // Try configured fallbacks first (from config.yaml), then built-in chain
  const configuredSteps = options?.configuredFallbacks || [];
  const allFallbackSteps = [
    // Configured fallbacks filtered by error category
    ...configuredSteps
      .filter(f => f.trigger === errorCategory || f.trigger === 'error')
      .map(f => ({
        provider: { providerId: f.providerId, modelId: f.modelId, adapterType: '', score: 0 },
        trigger: f.trigger as any,
        waitMs: f.waitMs || 0,
      })),
    // Built-in fallback chain
    ...plan.chain,
  ];

  // Deduplicate by providerId:modelId
  const seen = new Set<string>();
  const deduplicated = allFallbackSteps.filter(step => {
    const key = `${step.provider.providerId}:${step.provider.modelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  for (const step of deduplicated) {
    try {
      // Skip models on error cooldown (deprecated, auth errors, etc.)
      if (isModelOnErrorCooldown(step.provider.providerId, step.provider.modelId)) {
        logger.info({ provider: step.provider.providerId, model: step.provider.modelId }, 'Skipping model on error cooldown');
        continue;
      }

      // Re-check rate limit before executing fallback
      if (rls) {
        const limitCheck = rls.checkLimit(step.provider.providerId, step.provider.modelId, 0);
        if (!limitCheck.allowed) {
          logger.info({ provider: step.provider.providerId, retryAfterMs: limitCheck.retryAfterMs }, 'Fallback provider rate-limited, skipping');
          continue;
        }
      }

      if (step.waitMs && step.waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, step.waitMs));
      }

      // Check quota before executing fallback
      if (qs && tenantId) {
        await qs.checkQuota(tenantId, step.provider.providerId, 0, 0);
      }
      tried.push(step.provider.providerId);
      const response = await withConcurrencySlot(step.provider.providerId, () =>
        executor.execute(step.provider.providerId, step.provider.modelId, request)
      );
      // Record circuit breaker success (wrapped in try/catch)
      try { options?.onSuccess?.(step.provider.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onSuccess callback error'); }
      // Record successful usage (fire-and-forget, never fail the request)
      try {
        if (rls) {
          const tokens = response.usage?.total_tokens || 0;
          await rls.recordUsage(step.provider.providerId, step.provider.modelId, tokens);
        }
        if (qs && tenantId) {
          const tokens = response.usage?.total_tokens || 0;
          await qs.recordUsage(tenantId, step.provider.providerId, tokens, 0);
          await qs.recordProviderBudgetUsage(tenantId, step.provider.providerId, tokens);
        }
      } catch (usageErr) {
        logger.warn({ err: usageErr, provider: step.provider.providerId, requestId: options?.requestId }, 'Failed to record usage for fallback provider');
      }
      logger.info(
        { provider: step.provider.providerId, modelId: step.provider.modelId, errorCategory, trigger: step.trigger },
        'Fallback succeeded'
      );
      return response;
    } catch (error) {
      // Record circuit breaker failure (wrapped in try/catch)
      try { options?.onFailure?.(step.provider.providerId); } catch (cbErr) { logger.warn({ err: cbErr }, 'onFailure callback error'); }
      if (!isRateLimitError(error)) {
        anyNonRateLimitError = true;
      }
      if (isQuotaError(error)) {
        logger.warn({ provider: step.provider.providerId, requestId: options?.requestId }, 'Fallback provider quota exhausted');
      } else {
        logger.warn(
          { err: error, provider: step.provider.providerId, requestId: options?.requestId },
          'Fallback provider failed'
        );
      }
      // On 429, add penalty and record usage
      if (rls && isRateLimitError(error)) {
        rls.addPenalty(step.provider.providerId, step.provider.modelId);
        try {
          await rls.recordUsage(step.provider.providerId, step.provider.modelId, 0);
        } catch (usageErr) {
          logger.warn({ err: usageErr, provider: step.provider.providerId }, 'Failed to record rate limit usage');
        }
      }
      // On 402 (Payment Required), apply 24h cooldown — model needs credit to work
      if (rls && isPaymentRequiredError(error)) {
        rls.setPaymentRequiredCooldown(step.provider.providerId, step.provider.modelId);
        logger.warn(
          { provider: step.provider.providerId, modelId: step.provider.modelId },
          'Payment required (402) on fallback — applying 24h cooldown'
        );
      }
      // On 403 (Forbidden), apply 24h cooldown — model is not accessible
      if (rls && isForbiddenError(error)) {
        rls.setModelForbiddenCooldown(step.provider.providerId, step.provider.modelId);
        logger.warn(
          { provider: step.provider.providerId, modelId: step.provider.modelId },
          'Model forbidden (403) on fallback — applying 24h cooldown'
        );
      }
      // On 529/530 (Provider Overloaded), apply 5-minute cooldown
      if (rls && isProviderOverloadedError(error)) {
        rls.setCooldown(step.provider.providerId, step.provider.modelId, 5 * 60_000);
        logger.warn(
          { provider: step.provider.providerId, statusCode: error instanceof ProviderError ? error.statusCode : 'unknown' },
          'Provider overloaded — applying 5-minute cooldown'
        );
      }
      // Track model-level errors so we skip them on subsequent attempts
      const fallbackErrorCategory = classifyError(error);
      if (fallbackErrorCategory === 'model_not_found' || fallbackErrorCategory === 'auth_error') {
        trackModelError(step.provider.providerId, step.provider.modelId, fallbackErrorCategory);
      }
    }
  }

  if (!anyNonRateLimitError && tried.length > 0) {
    throw new ProviderUnavailableError(tried, 5000);
  }
  throw new AllProvidersFailedError(tried);
}

/**
 * Execute a request with cross-binding multi-binding failover support.
 *
 * Tries each binding (primary + fallbacks) in order. For each binding,
 * the standard fallback chain is attempted. When all retries on the
 * current binding are exhausted and crossBindingFailover is enabled,
 * the next binding is tried instead of failing immediately.
 */
export async function executeWithMultiBindingFallback(
  plan: RoutingPlan,
  request: UnifiedRequest,
  executor: AdapterExecutor,
  bindings: ModelBinding | undefined,
  options?: FallbackOptions,
): Promise<UnifiedResponse> {
  // No multi-binding config — delegate to standard fallback
  if (!bindings || !bindings.crossBindingFailover) {
    return executeWithFallback(plan, request, executor, options);
  }

  const allBindings = [bindings.primary, ...bindings.fallbacks];
  const triedProviders: string[] = [];

  for (const entry of allBindings) {
    const bindingPlan: RoutingPlan = {
      ...plan,
      primary: {
        ...plan.primary,
        providerId: entry.providerId,
        modelId: entry.modelId,
      },
    };

    try {
      return await executeWithFallback(bindingPlan, request, executor, {
        ...options,
        onFailure: (providerId: string) => {
          triedProviders.push(providerId);
          options?.onFailure?.(providerId);
        },
      });
    } catch (error) {
      logger.warn(
        { providerId: entry.providerId, modelId: entry.modelId },
        'Binding exhausted, trying next binding',
      );
    }
  }

  logger.error(
    { bindingsTried: triedProviders },
    'All bindings exhausted, no more fallbacks available',
  );
  throw new AllProvidersFailedError(triedProviders);
}
