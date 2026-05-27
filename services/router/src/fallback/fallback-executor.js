import { AllProvidersFailedError, ProviderError } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';
function isRateLimitError(error) {
    if (error instanceof ProviderError) {
        return error.statusCode === 429;
    }
    if (error instanceof Error) {
        return error.message.includes('429') || error.message.toLowerCase().includes('rate limit');
    }
    return false;
}
export async function executeWithFallback(plan, request, executor, options) {
    const tried = [];
    const rls = options?.rateLimitService;
    const qs = options?.quotaService;
    const tenantId = options?.tenantId;
    // Try primary
    try {
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
        }
        return response;
    }
    catch (error) {
        logger.warn({ err: error, provider: plan.primary.providerId }, 'Primary provider failed');
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
            }
            return response;
        }
        catch (error) {
            logger.warn({ err: error, provider: step.provider.providerId }, 'Fallback provider failed');
            // On 429, add penalty and record usage
            if (rls && isRateLimitError(error)) {
                rls.addPenalty(step.provider.providerId, step.provider.modelId);
                await rls.recordUsage(step.provider.providerId, step.provider.modelId, 0);
            }
        }
    }
    throw new AllProvidersFailedError(tried);
}
//# sourceMappingURL=fallback-executor.js.map