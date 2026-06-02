import type { RoutingPlan, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { AllProvidersFailedError, ProviderError, ProviderUnavailableError, QuotaExhaustedError } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';

export interface AdapterExecutor {
  execute(
    providerId: string,
    modelId: string,
    request: UnifiedRequest
  ): Promise<UnifiedResponse>;
}

export interface FallbackOptions {
  rateLimitService?: RateLimitService;
  quotaService?: QuotaService;
  tenantId?: string;
  requestId?: string;
  onSuccess?: (providerId: string) => void;
  onFailure?: (providerId: string) => void;
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.statusCode === 429;
  }
  if (error instanceof Error) {
    return error.message.includes('429') || error.message.toLowerCase().includes('rate limit');
  }
  return false;
}

function isQuotaError(error: unknown): boolean {
  return error instanceof QuotaExhaustedError;
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
  let allRateLimited = true;

  // Try primary
  try {
    // Check rate limit before executing
    if (rls) {
      const limitCheck = rls.checkLimit(plan.primary.providerId, plan.primary.modelId, 0);
      if (!limitCheck.allowed) {
        logger.info({ provider: plan.primary.providerId, retryAfterMs: limitCheck.retryAfterMs }, 'Primary provider rate-limited, skipping');
        allRateLimited = true;
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
    // Record circuit breaker success
    options?.onSuccess?.(plan.primary.providerId);
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
    // Record circuit breaker failure
    options?.onFailure?.(plan.primary.providerId);
    if (!isRateLimitError(error)) {
      allRateLimited = false;
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

  // Try fallback chain
  for (const step of plan.chain) {
    // Check if this trigger matches the error type
    // For Phase 1, we try all fallbacks regardless of trigger
    try {
      // Re-check rate limit before executing fallback
      if (rls) {
        const limitCheck = rls.checkLimit(step.provider.providerId, step.provider.modelId, 0);
        if (!limitCheck.allowed) {
          logger.info({ provider: step.provider.providerId, retryAfterMs: limitCheck.retryAfterMs }, 'Fallback provider rate-limited, skipping');
          continue;
        }
      }

      if (step.waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, step.waitMs));
      }

      // Check quota before executing fallback
      if (qs && tenantId) {
        await qs.checkQuota(tenantId, step.provider.providerId, 0, 0);
      }
      tried.push(step.provider.providerId);
      const response = await executor.execute(step.provider.providerId, step.provider.modelId, request);
      // Record circuit breaker success
      options?.onSuccess?.(step.provider.providerId);
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
      return response;
    } catch (error) {
      // Record circuit breaker failure
      options?.onFailure?.(step.provider.providerId);
      if (!isRateLimitError(error)) {
        allRateLimited = false;
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

  if (allRateLimited && tried.length > 0) {
    throw new ProviderUnavailableError(tried, 5000);
  }
  throw new AllProvidersFailedError(tried);
}
