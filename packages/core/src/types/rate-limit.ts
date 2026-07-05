/**
 * Rate limit configuration for a provider/model.
 * Free-tier providers have tight limits (e.g., 3 RPM, 500K TPD).
 */
export interface RateLimitConfig {
  rpm?: number;   // requests per minute
  rpd?: number;   // requests per day
  tpm?: number;   // tokens per minute
  tpd?: number;   // tokens per day
  maxConcurrent?: number; // max concurrent (in-flight) requests (e.g., Gemini free: ~10)
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
  currentConcurrent: number; // current in-flight request count
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
