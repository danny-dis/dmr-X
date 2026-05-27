import type { RoutingPlan, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import { AllProvidersFailedError, ProviderError, QuotaExhaustedError } from '@dmr-x/core';
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

  // Try primary
  try {
    // Check quota before executing
    if (qs && tenantId) {
      await qs.checkQuota(tenantId, plan.primary.providerId, 0, 0);
    }
    tried.push(plan.primary.providerId);
    const response = await executor.execute(plan.primary.providerId, plan.primary.modelId, request);
    // Record successful usage
    if (rls) {
      const tokens = response.usage?.total_tokens || 0;
      await rls.recordUsage(plan.primary.providerId, plan.primary.modelId, tokens);
    }
    if (qs && tenantId) {
      const tokens = response.usage?.total_tokens || 0;
      await qs.recordUsage(tenantId, plan.primary.providerId, tokens, 0);
      await qs.recordProviderBudgetUsage(tenantId, plan.primary.providerId, tokens);
    }
    return response;
  } catch (error) {
    if (isQuotaError(error)) {
      logger.warn({ provider: plan.primary.providerId }, 'Primary provider quota exhausted');
    } else {
      logger.warn({ err: error, provider: plan.primary.providerId }, 'Primary provider failed');
    }
    // On 429, add penalty and record usage
    if (rls && isRateLimitError(error)) {
      rls.addPenalty(plan.primary.providerId, plan.primary.modelId);
      await rls.recordUsage(plan.primary.providerId, plan.primary.modelId, 0);
    }
  }

  // Try fallback chain
  for (const step of plan.chain) {
    const trigger = step.trigger;

    // Check if this trigger matches the error type
    // For Phase 1, we try all fallbacks regardless of trigger
    try {
      if (step.waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, step.waitMs));
      }

      // Check quota before executing fallback
      if (qs && tenantId) {
        await qs.checkQuota(tenantId, step.provider.providerId, 0, 0);
      }
      tried.push(step.provider.providerId);
      const response = await executor.execute(step.provider.providerId, step.provider.modelId, request);
      // Record successful usage
      if (rls) {
        const tokens = response.usage?.total_tokens || 0;
        await rls.recordUsage(step.provider.providerId, step.provider.modelId, tokens);
      }
      if (qs && tenantId) {
        const tokens = response.usage?.total_tokens || 0;
        await qs.recordUsage(tenantId, step.provider.providerId, tokens, 0);
        await qs.recordProviderBudgetUsage(tenantId, step.provider.providerId, tokens);
      }
      return response;
    } catch (error) {
      if (isQuotaError(error)) {
        logger.warn({ provider: step.provider.providerId }, 'Fallback provider quota exhausted');
      } else {
        logger.warn(
          { err: error, provider: step.provider.providerId },
          'Fallback provider failed'
        );
      }
      // On 429, add penalty and record usage
      if (rls && isRateLimitError(error)) {
        rls.addPenalty(step.provider.providerId, step.provider.modelId);
        await rls.recordUsage(step.provider.providerId, step.provider.modelId, 0);
      }
    }
  }

  throw new AllProvidersFailedError(tried);
}
