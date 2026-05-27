import type { ThompsonSampler } from './thompson-sampler.js';
export interface RequestRecord {
    requestId: string;
    providerId: string;
    modelId: string;
    latencyMs: number;
    tokensInput: number;
    tokensOutput: number;
    costPerInputToken: number;
    costPerOutputToken: number;
    qualityScore?: number;
    success: boolean;
    errorCode?: string;
}
export declare class RewardUpdater {
    private sampler;
    constructor(sampler: ThompsonSampler);
    /**
     * Update the bandit after a request completes
     */
    updateFromRequest(record: RequestRecord): Promise<void>;
    /**
     * Periodically recompute rewards from request logs
     */
    recomputeFromLogs(daysBack?: number): Promise<void>;
}
//# sourceMappingURL=reward-updater.d.ts.map