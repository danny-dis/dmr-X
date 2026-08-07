import type { Router } from '@dmr-x/router';
import type { FastifyInstance } from 'fastify';

export async function banditRoutes(server: FastifyInstance): Promise<void> {
  const router = (server as any).router as Router;
  const sampler = router.getSampler();

  /**
   * GET /admin/bandit/arms
   *
   * Returns the Thompson sampler's learned posteriors for every arm (provider-model pair).
   * Each arm includes:
   * - alpha, beta: Beta distribution parameters
   * - pulls: Number of times this arm has been selected
   * - mean: Point estimate (alpha / (alpha + beta))
   * - totalReward: Sum of all rewards
   * - posteriorStdDev: Standard deviation of the posterior (derived)
   *
   * Response is sorted by pulls descending (most-learned arms first).
   */
  server.get('/admin/bandit/arms', async () => {
    const arms = sampler.snapshot();

    // Sort by pulls descending and compute posterior standard deviation for each arm
    const enriched = arms
      .map((arm) => {
        // Beta-distribution variance: (a*b) / ((a+b)^2 * (a+b+1))
        //
        // Guarded on `denom > 0`, not `denom > 1`: the formula is well-defined
        // for any positive alpha+beta, and ThompsonSampler's prior is a
        // constructor parameter (`priorAlpha`/`priorBeta`, both defaulting to
        // 1). A Jeffreys prior of Beta(0.5, 0.5) sums to exactly 1, where the
        // true sd is 0.354 — a `> 1` guard would report that as 0.000 and make
        // an unpulled arm look perfectly certain.
        const alpha = arm.alpha ?? 0;
        const beta = arm.beta ?? 0;
        const denom = alpha + beta;

        let posteriorStdDev = 0;
        if (denom > 0) {
          const variance = (alpha * beta) / ((denom * denom) * (denom + 1));
          posteriorStdDev = Math.sqrt(Math.max(0, variance));
        }

        return {
          key: arm.key,
          providerId: arm.providerId,
          modelId: arm.modelId,
          alpha: arm.alpha,
          beta: arm.beta,
          pulls: arm.pulls,
          mean: arm.mean,
          totalReward: arm.totalReward,
          posteriorStdDev,
        };
      })
      .sort((a, b) => b.pulls - a.pulls);

    return {
      object: 'list',
      data: enriched,
    };
  });

  /**
   * GET /admin/bandit/summary
   *
   * Returns aggregated statistics for the Thompson bandit:
   * - armCount: Number of arms (provider-model pairs)
   * - totalPulls: Total selections across all arms
   * - bestArm: Arm with highest mean reward
   * - worstArm: Arm with lowest mean reward
   */
  server.get('/admin/bandit/summary', async () => {
    const arms = sampler.snapshot();

    if (arms.length === 0) {
      return {
        armCount: 0,
        totalPulls: 0,
        bestArm: null,
        worstArm: null,
      };
    }

    const totalPulls = arms.reduce((sum, arm) => sum + (arm.pulls ?? 0), 0);

    // Find best and worst arms by mean
    let bestArm = arms[0];
    let worstArm = arms[0];

    for (const arm of arms) {
      if (arm.mean > bestArm.mean) {
        bestArm = arm;
      }
      if (arm.mean < worstArm.mean) {
        worstArm = arm;
      }
    }

    return {
      armCount: arms.length,
      totalPulls,
      bestArm: {
        key: bestArm.key,
        providerId: bestArm.providerId,
        modelId: bestArm.modelId,
        mean: bestArm.mean,
        pulls: bestArm.pulls,
      },
      worstArm: {
        key: worstArm.key,
        providerId: worstArm.providerId,
        modelId: worstArm.modelId,
        mean: worstArm.mean,
        pulls: worstArm.pulls,
      },
    };
  });
}
