import type { TaskProfile, CandidateSet, SelectedProvider, FallbackStep, FreeTierStrategy } from '@dmr-x/core';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
export interface PipelineInput {
    taskProfile: TaskProfile;
    candidates: CandidateSet;
    tenantPolicies?: string[];
    epsilon?: number;
    rateLimitService?: RateLimitService;
    quotaService?: QuotaService;
    tenantId?: string;
    estimatedTokens?: number;
    freeTierStrategy?: FreeTierStrategy;
}
export interface PipelineOutput {
    selected: SelectedProvider;
    chain: FallbackStep[];
    scoredCandidates: CandidateSet;
}
export declare function runPipeline(input: PipelineInput): Promise<PipelineOutput>;
//# sourceMappingURL=pipeline.d.ts.map