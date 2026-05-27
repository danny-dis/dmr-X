import type { UnifiedRequest, RoutingPlan, UnifiedResponse, FreeTierStrategy } from '@dmr-x/core';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
import { type ClassifyOptions } from './classifier/task-classifier.js';
import { type AdapterExecutor } from './fallback/fallback-executor.js';
import type { CandidateSet } from '@dmr-x/core';
export interface RouterConfig {
    epsilon?: number;
    defaultQualityTarget?: 'frontier' | 'balanced' | 'economy';
    enableDecomposition?: boolean;
    decompositionThreshold?: number;
    rateLimitService?: RateLimitService;
    quotaService?: QuotaService;
    freeTierStrategy?: FreeTierStrategy;
}
export declare class Router {
    private readonly config;
    private candidates;
    private adapterExecutor;
    private taskDecomposer;
    private specialistRouter;
    private compositeExecutor;
    constructor(config?: RouterConfig);
    setCandidates(candidates: CandidateSet): void;
    setAdapterExecutor(executor: AdapterExecutor): void;
    /**
     * Route a request - handles both simple and composite tasks
     */
    route(request: UnifiedRequest, options: ClassifyOptions): Promise<{
        plan: RoutingPlan;
        response: UnifiedResponse;
    }>;
    /**
     * Route a simple (non-decomposed) request
     */
    private routeSimple;
    /**
     * Route a composite (decomposed) request
     */
    private routeComposite;
    /**
     * Check if a prompt is complex enough to warrant decomposition
     */
    private isComplexPrompt;
    private extractPrompt;
    /**
     * Estimate token count for rate-limit checking.
     * Uses ~4 chars/token heuristic (same as FreeLLMAPI).
     */
    private estimateTokens;
}
//# sourceMappingURL=router.service.d.ts.map