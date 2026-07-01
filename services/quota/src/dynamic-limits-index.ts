/**
 * Dynamic Rate Limit Detection Module
 *
 * Parses rate limit headers from provider responses to track real-time
 * remaining quota.
 */

export {
  parseRateLimitHeaders,
  supportsRateLimitHeaders,
  calculateQuotaStatus,
  compareKeyQuota,
  parseLimitFromError,
  type RateLimitHeaders,
  type RateLimitState,
  type KeyQuotaStatus,
} from './dynamic-limits.js';
