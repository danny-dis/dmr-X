import type { RateLimitConfig, RateLimitCheckResult, RateLimitState } from '@dmr-x/core';
/**
 * Rate-limit tracking service using Redis sorted sets for sliding windows.
 *
 * Tracks RPM, RPD, TPM, TPD per (providerId, modelId) pair.
 * Used by free-tier providers with tight limits (e.g., 3 RPM, 500K TPD).
 *
 * Key pattern: rl:{providerId}:{modelId}:{window}
 * Score: timestamp (ms), Member: request UUID
 */
export declare class RateLimitService {
    private configs;
    private penalties;
    private decayInterval;
    /**
     * Register rate limit config for a provider/model.
     */
    setConfig(providerId: string, modelId: string, config: RateLimitConfig): void;
    /**
     * Get the config key for a provider/model.
     */
    private configKey;
    /**
     * Get the Redis key for a window.
     */
    private redisKey;
    /**
     * Check if a request would exceed rate limits.
     */
    checkLimit(providerId: string, modelId: string, estimatedTokens?: number): Promise<RateLimitCheckResult>;
    /**
     * Record usage after a successful or failed request.
     */
    recordUsage(providerId: string, modelId: string, tokens?: number): Promise<void>;
    /**
     * Add a penalty point after a 429 response.
     * Each 429 adds 3 points, capped at 10.
     */
    addPenalty(providerId: string, modelId: string): number;
    /**
     * Get current penalty points for a provider/model.
     */
    getPenaltyPoints(providerId: string, modelId: string): number;
    /**
     * Start the penalty decay interval (every 2 minutes, -1 point).
     */
    startDecay(intervalMs?: number): void;
    /**
     * Stop the penalty decay interval.
     */
    stopDecay(): void;
    /**
     * Get current state for a provider/model.
     */
    getState(providerId: string, modelId: string): Promise<RateLimitState>;
    /**
     * Count entries in a sliding window using Redis sorted set.
     */
    private countWindow;
    /**
     * Sum token counts from a sliding window.
     * Member format: tpm_{requestId}:{tokens} or tpd_{requestId}:{tokens}
     */
    private sumWindow;
    /**
     * Get the oldest entry timestamp in a window.
     */
    private oldestInWindow;
    /**
     * Add an entry to a sliding window with auto-expiry.
     */
    private addToWindow;
}
export declare const rateLimitService: RateLimitService;
//# sourceMappingURL=rate-limit.service.d.ts.map