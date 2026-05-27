import type { CandidateSet } from '@dmr-x/core';
export interface QuotaAllocation {
    id: string;
    tenantId: string;
    providerId?: string;
    maxRequests?: number;
    maxTokens?: number;
    maxCost?: number;
    period: string;
}
export interface QuotaUsage {
    requests: number;
    tokens: number;
    cost: number;
}
export declare class QuotaService {
    /**
     * Filter candidates based on tenant quota
     */
    filterByQuota(candidates: CandidateSet, tenantId: string): Promise<CandidateSet>;
    /**
     * Record usage after a request
     */
    recordUsage(tenantId: string, providerId: string, tokens: number, cost: number): Promise<void>;
    /**
     * Check if a request would exceed quota
     */
    checkQuota(tenantId: string, providerId: string, estimatedTokens: number, estimatedCost: number): Promise<void>;
    private getAllocations;
    private getUsage;
    /**
     * Reset quotas for a new period
     */
    resetQuotas(tenantId?: string): Promise<void>;
    /**
     * Create a quota allocation
     */
    createAllocation(tenantId: string, providerId: string | null, maxRequests: number | null, maxTokens: number | null, maxCost: number | null, period?: string): Promise<QuotaAllocation>;
}
export declare const quotaService: QuotaService;
//# sourceMappingURL=quota.service.d.ts.map