import type { RoutingPlan, UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
export interface AdapterExecutor {
    execute(providerId: string, modelId: string, request: UnifiedRequest): Promise<UnifiedResponse>;
}
export interface FallbackOptions {
    rateLimitService?: RateLimitService;
    quotaService?: QuotaService;
    tenantId?: string;
}
export declare function executeWithFallback(plan: RoutingPlan, request: UnifiedRequest, executor: AdapterExecutor, options?: FallbackOptions): Promise<UnifiedResponse>;
//# sourceMappingURL=fallback-executor.d.ts.map