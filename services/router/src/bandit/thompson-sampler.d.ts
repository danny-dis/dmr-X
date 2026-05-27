import type { CandidateSet, ProviderModel, QualityTarget } from '@dmr-x/core';
export declare class ThompsonSampler {
    private readonly priorAlpha;
    private readonly priorBeta;
    private arms;
    constructor(priorAlpha?: number, priorBeta?: number);
    /**
     * Select the best candidate using Thompson Sampling
     */
    select(candidates: CandidateSet, qualityTarget: QualityTarget): ProviderModel;
    /**
     * Update the arm's state after observing a reward
     */
    update(candidate: ProviderModel, reward: number): void;
    /**
     * Get statistics for all arms
     */
    getStats(): Map<string, {
        mean: number;
        pulls: number;
        alpha: number;
        beta: number;
    }>;
    /**
     * Reset an arm's state
     */
    reset(candidate: ProviderModel): void;
    /**
     * Reset all arms
     */
    resetAll(): void;
    private getArmKey;
    private getArm;
    /**
     * Sample from a Beta distribution using the Jöhnk method
     * This is a simplified version that works well for common alpha/beta values
     */
    private sampleBeta;
    /**
     * Generate a Gaussian random number using Box-Muller transform
     */
    private gaussianRandom;
    /**
     * Adjust the sample by quality target weights
     */
    private adjustByQualityTarget;
    private getWeights;
}
/**
 * Calculate reward from response metrics
 */
export declare function calculateReward(qualityScore: number, latencyMs: number, costPerToken: number, success: boolean): number;
//# sourceMappingURL=thompson-sampler.d.ts.map