/**
 * Rate limit configuration for a provider/model.
 * Free-tier providers have tight limits (e.g., 3 RPM, 500K TPD).
 */
export interface RateLimitConfig {
  rpm?: number;   // requests per minute
  rpd?: number;   // requests per day
  tpm?: number;   // tokens per minute
  tpd?: number;   // tokens per day
}

/**
 * Current rate limit state for a provider/model.
 */
export interface RateLimitState {
  providerId: string;
  modelId: string;
  config: RateLimitConfig;
  currentRPM: number;
  currentRPD: number;
  currentTPM: number;
  currentTPD: number;
  penaltyPoints: number;  // 0-10, from 429 responses
}

/**
 * Result of a rate limit check.
 */
export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterMs?: number;
  reason?: string;
}
