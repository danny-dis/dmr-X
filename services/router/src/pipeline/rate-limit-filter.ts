import type { CandidateSet } from '@dmr-x/core';
import type { RateLimitService } from '@dmr-x/quota';

/**
 * Filter candidates that would exceed their rate limits.
 *
 * This is the core enabler for free-tier aggregation —
 * without it, tight limits (e.g., 3 RPM) burn out instantly.
 */
export async function rateLimitFilter(
  candidates: CandidateSet,
  rateLimitService: RateLimitService,
  estimatedTokens: number = 0
): Promise<CandidateSet> {
  const filtered: CandidateSet = [];

  for (const candidate of candidates) {
    const result = await rateLimitService.checkLimit(
      candidate.providerId,
      candidate.modelId,
      estimatedTokens
    );

    if (result.allowed) {
      filtered.push(candidate);
    }
  }

  return filtered;
}
