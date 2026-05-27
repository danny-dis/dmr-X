export class ThompsonSampler {
    priorAlpha;
    priorBeta;
    arms = new Map();
    constructor(priorAlpha = 1, priorBeta = 1) {
        this.priorAlpha = priorAlpha;
        this.priorBeta = priorBeta;
    }
    /**
     * Select the best candidate using Thompson Sampling
     */
    select(candidates, qualityTarget) {
        if (candidates.length === 0) {
            throw new Error('No candidates available');
        }
        if (candidates.length === 1) {
            return candidates[0];
        }
        // Sample from each arm's Beta distribution
        const samples = candidates.map((candidate) => {
            const armKey = this.getArmKey(candidate);
            const arm = this.getArm(armKey);
            const sample = this.sampleBeta(arm.alpha, arm.beta);
            // Adjust sample by quality target weights
            const adjustedSample = this.adjustByQualityTarget(sample, candidate, qualityTarget);
            return { candidate, sample: adjustedSample };
        });
        // Select the arm with the highest sample
        samples.sort((a, b) => b.sample - a.sample);
        return samples[0].candidate;
    }
    /**
     * Update the arm's state after observing a reward
     */
    update(candidate, reward) {
        const armKey = this.getArmKey(candidate);
        const arm = this.getArm(armKey);
        // Reward is between 0 and 1
        const clampedReward = Math.max(0, Math.min(1, reward));
        // Update Beta distribution parameters
        arm.alpha += clampedReward;
        arm.beta += (1 - clampedReward);
        arm.pulls++;
        arm.totalReward += clampedReward;
    }
    /**
     * Get statistics for all arms
     */
    getStats() {
        const stats = new Map();
        for (const [key, arm] of this.arms) {
            stats.set(key, {
                mean: arm.alpha / (arm.alpha + arm.beta),
                pulls: arm.pulls,
                alpha: arm.alpha,
                beta: arm.beta,
            });
        }
        return stats;
    }
    /**
     * Reset an arm's state
     */
    reset(candidate) {
        const armKey = this.getArmKey(candidate);
        this.arms.set(armKey, {
            alpha: this.priorAlpha,
            beta: this.priorBeta,
            pulls: 0,
            totalReward: 0,
        });
    }
    /**
     * Reset all arms
     */
    resetAll() {
        this.arms.clear();
    }
    getArmKey(candidate) {
        return `${candidate.providerId}:${candidate.modelId}`;
    }
    getArm(key) {
        if (!this.arms.has(key)) {
            this.arms.set(key, {
                alpha: this.priorAlpha,
                beta: this.priorBeta,
                pulls: 0,
                totalReward: 0,
            });
        }
        return this.arms.get(key);
    }
    /**
     * Sample from a Beta distribution using the Jöhnk method
     * This is a simplified version that works well for common alpha/beta values
     */
    sampleBeta(alpha, beta) {
        // Use the mean with some noise for simplicity
        // In production, use a proper Beta distribution sampler
        const mean = alpha / (alpha + beta);
        const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
        const stdDev = Math.sqrt(variance);
        // Add Gaussian noise scaled by standard deviation
        const noise = this.gaussianRandom() * stdDev;
        return Math.max(0, Math.min(1, mean + noise));
    }
    /**
     * Generate a Gaussian random number using Box-Muller transform
     */
    gaussianRandom() {
        const u1 = Math.random();
        const u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    /**
     * Adjust the sample by quality target weights
     */
    adjustByQualityTarget(sample, candidate, qualityTarget) {
        // Quality target affects how much we value quality vs cost vs latency
        const weights = this.getWeights(qualityTarget);
        // Normalize scores
        const qualityScore = candidate.qualityScore;
        const costScore = 1 - (candidate.costPerInputToken || 0) / 0.01; // Normalize to 0.01
        const latencyScore = 1 - (candidate.avgLatencyMs || 0) / 5000; // Normalize to 5s
        // Combine Thompson sample with quality/cost/latency scores
        const combinedScore = sample * 0.3 + // Exploration
            qualityScore * weights.quality +
            costScore * weights.cost +
            latencyScore * weights.latency;
        return combinedScore;
    }
    getWeights(qualityTarget) {
        switch (qualityTarget) {
            case 'frontier':
                return { quality: 0.5, cost: 0.1, latency: 0.1 };
            case 'balanced':
                return { quality: 0.3, cost: 0.2, latency: 0.2 };
            case 'economy':
                return { quality: 0.1, cost: 0.5, latency: 0.2 };
        }
    }
}
/**
 * Calculate reward from response metrics
 */
export function calculateReward(qualityScore, latencyMs, costPerToken, success) {
    if (!success)
        return 0;
    // Normalize metrics
    const normalizedQuality = qualityScore;
    const normalizedLatency = Math.max(0, 1 - latencyMs / 10000); // 10s max
    const normalizedCost = Math.max(0, 1 - costPerToken / 0.01); // $0.01 max
    // Weighted combination
    return (normalizedQuality * 0.5 +
        normalizedLatency * 0.3 +
        normalizedCost * 0.2);
}
//# sourceMappingURL=thompson-sampler.js.map