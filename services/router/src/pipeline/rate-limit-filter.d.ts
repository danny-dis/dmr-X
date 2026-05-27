import type { CandidateSet } from '@dmr-x/core';
import type { RateLimitService } from '@dmr-x/quota';
/**
 * Filter candidates that would exceed their rate limits.
 *
 * This is the core enabler for free-tier aggregation —
 * without it, tight limits (e.g., 3 RPM) burn out instantly.
 */
export declare function rateLimitFilter(candidates: CandidateSet, rateLimitService: RateLimitService, estimatedTokens?: number): Promise<CandidateSet>;
//# sourceMappingURL=rate-limit-filter.d.ts.map