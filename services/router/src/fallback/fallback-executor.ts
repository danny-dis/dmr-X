import type { RoutingPlan, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { AllProvidersFailedError, ProviderError, ProviderUnavailableError, QuotaExhaustedError } from '@dmr-x/core';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
import { logger } from '@dmr-x/utils';

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
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 429;
  }
  return false;
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
function classifyError(error: unknown): 'rate_limit' | 'context_window' | 'content_policy' | 'quota' | 'error' {
  if (isRateLimitError(error)) return 'rate_limit';
  if (isContextWindowError(error)) return 'context_window';
  if (isContentPolicyError(error)) return 'content_policy';
  if (isQuotaError(error)) return 'quota';
  return 'error';
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
    const response = await executor.execute(plan.primary.providerId, plan.primary.modelId, request);
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
  }

  // Classify the primary error for smart fallback selection
  const errorCategory = classifyError(primaryErrorRaw);

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
      const response = await executor.execute(step.provider.providerId, step.provider.modelId, request);
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
    }
  }

  if (!anyNonRateLimitError && tried.length > 0) {
    throw new ProviderUnavailableError(tried, 5000);
  }
  throw new AllProvidersFailedError(tried);
}
