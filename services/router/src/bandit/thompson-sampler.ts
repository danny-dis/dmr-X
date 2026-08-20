import type { CandidateSet, ProviderModel, QualityTarget } from '@dmr-x/core';

/**
 * Thompson Sampling for routing decisions
 *
 * Each arm (provider-model pair) has a Beta distribution:
 * - alpha = successes + prior
 * - beta = failures + prior
 *
 * We sample from each arm's distribution and pick the highest.
 * This naturally balances exploration vs exploitation.
 */

interface ArmState {
  alpha: number; // successes + prior
  beta: number;  // failures + prior
  pulls: number;
  totalReward: number;
}

export class ThompsonSampler {
  private arms = new Map<string, ArmState>();

  constructor(
    private readonly priorAlpha: number = 1,
    private readonly priorBeta: number = 1,
    private readonly getPenaltyPoints?: (providerId: string, modelId: string) => number,
  ) {}

  /**
   * Select the best candidate using Thompson Sampling
   */
  select(candidates: CandidateSet, qualityTarget: QualityTarget): ProviderModel {
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
  update(candidate: ProviderModel, reward: number): void {
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
  getStats(): Map<string, { mean: number; pulls: number; alpha: number; beta: number }> {
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
  reset(candidate: ProviderModel): void {
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
  resetAll(): void {
    this.arms.clear();
  }

  /**
   * Snapshot of every arm — used by the admin API to inspect the bandit's
   * learned posteriors. Keys are `providerId:modelId`.
   */
  snapshot(): Array<{
    key: string;
    providerId: string;
    modelId: string;
    alpha: number;
    beta: number;
    pulls: number;
    mean: number;
    totalReward: number;
  }> {
    const out: Array<{
      key: string;
      providerId: string;
      modelId: string;
      alpha: number;
      beta: number;
      pulls: number;
      mean: number;
      totalReward: number;
    }> = [];
    for (const [key, arm] of this.arms) {
      const sep = key.indexOf(':');
      out.push({
        key,
        providerId: sep >= 0 ? key.slice(0, sep) : key,
        modelId: sep >= 0 ? key.slice(sep + 1) : '',
        alpha: arm.alpha,
        beta: arm.beta,
        pulls: arm.pulls,
        mean: arm.alpha / (arm.alpha + arm.beta),
        totalReward: arm.totalReward,
      });
    }
    return out;
  }

  /**
   * Restore an arm from persisted state. Used by `RewardUpdater.loadFromDb`.
   */
  restore(key: string, alpha: number, beta: number, pulls: number, totalReward: number): void {
    this.arms.set(key, { alpha, beta, pulls, totalReward });
  }

  private getArmKey(candidate: ProviderModel): string {
    return `${candidate.providerId}:${candidate.modelId}`;
  }

  private getArm(key: string): ArmState {
    if (!this.arms.has(key)) {
      this.arms.set(key, {
        alpha: this.priorAlpha,
        beta: this.priorBeta,
        pulls: 0,
        totalReward: 0,
      });
    }
    return this.arms.get(key)!;
  }

  /**
   * Sample from a Beta distribution using the Jöhnk method
   * This is a simplified version that works well for common alpha/beta values
   */
  private sampleBeta(alpha: number, beta: number): number {
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
  private gaussianRandom(): number {
    // Guard: Math.random() can return 0, which makes Math.log(0) = -Infinity
    const u1 = Math.max(Number.EPSILON, Math.random());
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Adjust the sample by quality target weights
   */
  private adjustByQualityTarget(
    sample: number,
    candidate: ProviderModel,
    qualityTarget: QualityTarget
  ): number {
    // Quality target affects how much we value quality vs cost vs latency
    const weights = this.getWeights(qualityTarget);

    // Normalize scores
    const qualityScore = candidate.qualityScore;
    // Penalties from the RateLimitService (e.g. repeated 429s) are now visible
    // to the bandit: each penalty point shaves 5% off the effective quality,
    // so an arm that keeps rate-limiting is demoted even when its raw quality
    // score would otherwise make it the best arm.
    const effectiveQuality =
      this.getPenaltyPoints && qualityScore != null
        ? Math.max(0, qualityScore - this.getPenaltyPoints(candidate.providerId, candidate.modelId) * 0.05)
        : qualityScore;
    const costScore = Math.max(0, 1 - (candidate.costPerInputToken || 0) / 0.01); // Normalize to 0.01, clamped to [0, 1]
    const latencyScore = Math.max(0, 1 - (candidate.avgLatencyMs || 0) / 5000); // Normalize to 5s, clamped to [0, 1]

    // Combine Thompson sample with quality/cost/latency scores
    const combinedScore =
      sample * 0.3 + // Exploration
      effectiveQuality * weights.quality +
      costScore * weights.cost +
      latencyScore * weights.latency;

    return combinedScore;
  }

  private getWeights(qualityTarget: QualityTarget): { quality: number; cost: number; latency: number } {
    switch (qualityTarget) {
      case 'frontier':
        return { quality: 0.5, cost: 0.1, latency: 0.1 };
      case 'balanced':
        return { quality: 0.3, cost: 0.2, latency: 0.2 };
      case 'economy':
        return { quality: 0.1, cost: 0.5, latency: 0.2 };
      default:
        return { quality: 0.3, cost: 0.2, latency: 0.2 };
    }
  }
}

/**
 * Calculate reward from response metrics.
 *
 * Optional fields (8C.1 / 8C.2):
 *  - `firstTokenLatencyMs` — time to first token. Used as a *fast* latency
 *    signal for streaming responses (TTFT). When provided it is blended with
 *    total latency so the bandit learns that "fast first byte" is valuable.
 *  - `toolCallsSucceeded` / `toolCallsAttempted` — tool-call success rate
 *    becomes a reward signal *only* when the request actually used tools.
 *    When tools weren't used, this signal is neutral.
 */
export function calculateReward(
  qualityScore: number,
  latencyMs: number,
  costPerToken: number,
  success: boolean,
  options: {
    firstTokenLatencyMs?: number;
    toolCallsSucceeded?: number;
    toolCallsAttempted?: number;
  } = {},
): number {
  if (!success) return 0;

  // Normalize metrics
  const normalizedQuality = qualityScore;
  const normalizedLatency = Math.max(0, 1 - latencyMs / 10000); // 10s max
  const normalizedCost = Math.max(0, 1 - costPerToken / 0.01); // $0.01 max

  // TTFT signal: 0..1, where 0 ms = 1.0 and 5000 ms = 0.0
  let ttftSignal = 0.5; // neutral if not provided
  if (typeof options.firstTokenLatencyMs === 'number') {
    ttftSignal = Math.max(0, 1 - Math.max(0, options.firstTokenLatencyMs) / 5000);
  }

  // Tool-call success signal: only applied when the request actually used tools.
  let toolSignal = 0.5; // neutral if no tools were used
  if (
    typeof options.toolCallsAttempted === 'number' &&
    options.toolCallsAttempted > 0 &&
    typeof options.toolCallsSucceeded === 'number'
  ) {
    toolSignal = Math.max(0, Math.min(1, options.toolCallsSucceeded / options.toolCallsAttempted));
  }

  // Weighted combination.
  // Quality stays the dominant signal; TTFT and tool success each pull 10%.
  return (
    normalizedQuality * 0.45 +
    normalizedLatency * 0.20 +
    normalizedCost * 0.15 +
    ttftSignal * 0.10 +
    toolSignal * 0.10
  );
}
