import type { CandidateSet } from '@dmr-x/core';
import type { RateLimitService } from '@dmr-x/quota';

export interface RateLimitFilterResult {
  allowed: CandidateSet;
  rateLimited: Array<{
    providerId: string;
    modelId: string;
    retryAfterMs: number;
    reason: string;
  }>;
  earliestResetMs: number;
}

/**
 * Filter candidates that would exceed their rate limits.
 * Runs checks in parallel for performance.
 * Returns both allowed candidates and rate-limited info for smart retry.
 */
export async function rateLimitFilter(
  candidates: CandidateSet,
  rateLimitService: RateLimitService,
  estimatedTokens: number = 0
): Promise<RateLimitFilterResult> {
  // Ensure at least 1 token for TPM/TPD checks to prevent bypass
  const tokensForCheck = Math.max(estimatedTokens, 1);
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      const result = rateLimitService.checkLimit(
        candidate.providerId,
        candidate.modelId,
        tokensForCheck
      );
      return { candidate, result };
    })
  );

  const allowed: CandidateSet = [];
  const rateLimited: RateLimitFilterResult['rateLimited'] = [];
  let earliestResetMs = Infinity;

  for (const { candidate, result } of results) {
    if (result.allowed) {
      allowed.push(candidate);
    } else {
      rateLimited.push({
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        retryAfterMs: result.retryAfterMs ?? 60000,
        reason: result.reason ?? 'Rate limit exceeded',
      });
      if (result.retryAfterMs && result.retryAfterMs < earliestResetMs) {
        earliestResetMs = result.retryAfterMs;
      }
    }
  }

  return {
    allowed,
    rateLimited,
    earliestResetMs: earliestResetMs === Infinity ? 0 : earliestResetMs,
  };
}
