import { createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import type { RateLimitConfig, RateLimitCheckResult, RateLimitState } from '@dmr-x/core';

const cache = createNamespacedCache('rl');

interface WindowData {
  count?: number;
  total?: number;
  windowStart: number;
}

/**
 * Rate-limit tracking service using in-memory cache for sliding windows.
 *
 * Tracks RPM, RPD, TPM, TPD per (providerId, modelId) pair.
 * Used by free-tier providers with tight limits (e.g., 3 RPM, 500K TPD).
 *
 * Key pattern: rl:{providerId}:{modelId}:{window}
 * Value: JSON string of { count, windowStart } or { total, windowStart }
 */
export class RateLimitService {
  private configs = new Map<string, RateLimitConfig>();
  private penalties = new Map<string, { points: number; lastPenalty: number }>();
  private decayInterval: NodeJS.Timeout | null = null;

  /**
   * Register rate limit config for a provider/model.
   */
  setConfig(providerId: string, modelId: string, config: RateLimitConfig): void {
    const key = this.configKey(providerId, modelId);
    this.configs.set(key, config);
  }

  /**
   * Get the config key for a provider/model.
   */
  private configKey(providerId: string, modelId: string): string {
    return `${providerId}:${modelId}`;
  }

  /**
   * Get the cache key for a window.
   */
  private cacheKey(providerId: string, modelId: string, window: string): string {
    return `${providerId}:${modelId}:${window}`;
  }

  /**
   * Check if a request would exceed rate limits.
   */
  checkLimit(
    providerId: string,
    modelId: string,
    estimatedTokens: number = 0
  ): RateLimitCheckResult {
    const key = this.configKey(providerId, modelId);
    const config = this.configs.get(key);

    if (!config) {
      return { allowed: true }; // No config = no limits
    }

    const now = Date.now();

    // Check RPM
    if (config.rpm) {
      const rpmKey = this.cacheKey(providerId, modelId, 'rpm');
      const count = this.getCount(rpmKey, now, 60_000);
      if (count >= config.rpm) {
        const windowStart = this.getWindowStart(rpmKey, now, 60_000);
        const retryAfterMs = windowStart ? 60_000 - (now - windowStart) : 60_000;
        return { allowed: false, retryAfterMs, reason: `RPM limit (${config.rpm}) exceeded` };
      }
    }

    // Check RPD
    if (config.rpd) {
      const rpdKey = this.cacheKey(providerId, modelId, 'rpd');
      const count = this.getCount(rpdKey, now, 86_400_000);
      if (count >= config.rpd) {
        const windowStart = this.getWindowStart(rpdKey, now, 86_400_000);
        const retryAfterMs = windowStart ? 86_400_000 - (now - windowStart) : 86_400_000;
        return { allowed: false, retryAfterMs, reason: `RPD limit (${config.rpd}) exceeded` };
      }
    }

    // Check TPM
    if (config.tpm && estimatedTokens > 0) {
      const tpmKey = this.cacheKey(providerId, modelId, 'tpm');
      const tokens = this.getTokenSum(tpmKey, now, 60_000);
      if (tokens + estimatedTokens > config.tpm) {
        return { allowed: false, retryAfterMs: 60_000, reason: `TPM limit (${config.tpm}) would be exceeded` };
      }
    }

    // Check TPD
    if (config.tpd && estimatedTokens > 0) {
      const tpdKey = this.cacheKey(providerId, modelId, 'tpd');
      const tokens = this.getTokenSum(tpdKey, now, 86_400_000);
      if (tokens + estimatedTokens > config.tpd) {
        return { allowed: false, retryAfterMs: 86_400_000, reason: `TPD limit (${config.tpd}) would be exceeded` };
      }
    }

    return { allowed: true };
  }

  /**
   * Record usage after a successful or failed request.
   */
  recordUsage(
    providerId: string,
    modelId: string,
    tokens: number = 0
  ): void {
    const now = Date.now();

    // Record in RPM window
    const rpmKey = this.cacheKey(providerId, modelId, 'rpm');
    this.addToCountWindow(rpmKey, now, 60_000);

    // Record in RPD window
    const rpdKey = this.cacheKey(providerId, modelId, 'rpd');
    this.addToCountWindow(rpdKey, now, 86_400_000);

    // Record tokens in TPM window
    if (tokens > 0) {
      const tpmKey = this.cacheKey(providerId, modelId, 'tpm');
      this.addToTokenWindow(tpmKey, now, tokens, 60_000);

      // Record tokens in TPD window
      const tpdKey = this.cacheKey(providerId, modelId, 'tpd');
      this.addToTokenWindow(tpdKey, now, tokens, 86_400_000);
    }
  }

  /**
   * Add a penalty point after a 429 response.
   * Each 429 adds 3 points, capped at 10.
   */
  addPenalty(providerId: string, modelId: string): number {
    const key = this.configKey(providerId, modelId);
    const existing = this.penalties.get(key) || { points: 0, lastPenalty: 0 };
    const newPoints = Math.min(10, existing.points + 3);
    this.penalties.set(key, { points: newPoints, lastPenalty: Date.now() });
    logger.warn({ providerId, modelId, penaltyPoints: newPoints }, 'Added rate limit penalty');
    return newPoints;
  }

  /**
   * Get current penalty points for a provider/model.
   */
  getPenaltyPoints(providerId: string, modelId: string): number {
    const key = this.configKey(providerId, modelId);
    return this.penalties.get(key)?.points || 0;
  }

  /**
   * Start the penalty decay interval (every 2 minutes, -1 point).
   */
  startDecay(intervalMs: number = 120_000): void {
    if (this.decayInterval) return;
    this.decayInterval = setInterval(() => {
      for (const [key, penalty] of this.penalties.entries()) {
        if (penalty.points > 0) {
          penalty.points -= 1;
          if (penalty.points <= 0) {
            this.penalties.delete(key);
          }
        }
      }
    }, intervalMs);
  }

  /**
   * Stop the penalty decay interval.
   */
  stopDecay(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
  }

  /**
   * Get current state for a provider/model.
   */
  getState(providerId: string, modelId: string): RateLimitState {
    const key = this.configKey(providerId, modelId);
    const config = this.configs.get(key) || {};
    const now = Date.now();

    const currentRPM = config.rpm
      ? this.getCount(this.cacheKey(providerId, modelId, 'rpm'), now, 60_000)
      : 0;
    const currentRPD = config.rpd
      ? this.getCount(this.cacheKey(providerId, modelId, 'rpd'), now, 86_400_000)
      : 0;
    const currentTPM = config.tpm
      ? this.getTokenSum(this.cacheKey(providerId, modelId, 'tpm'), now, 60_000)
      : 0;
    const currentTPD = config.tpd
      ? this.getTokenSum(this.cacheKey(providerId, modelId, 'tpd'), now, 86_400_000)
      : 0;

    return {
      providerId,
      modelId,
      config,
      currentRPM,
      currentRPD,
      currentTPM,
      currentTPD,
      penaltyPoints: this.getPenaltyPoints(providerId, modelId),
    };
  }

  // -- Private helpers --

  /**
   * Parse a cached window data entry.
   */
  private parseWindowData(key: string): WindowData | null {
    const raw = cache.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as WindowData;
    } catch {
      return null;
    }
  }

  /**
   * Get request count from a sliding window.
   * If the window has expired, returns 0.
   */
  private getCount(key: string, now: number, windowMs: number): number {
    const data = this.parseWindowData(key);
    if (!data || !data.count) return 0;
    if (now - data.windowStart > windowMs) return 0;
    return data.count;
  }

  /**
   * Get the window start timestamp.
   */
  private getWindowStart(key: string, now: number, windowMs: number): number | null {
    const data = this.parseWindowData(key);
    if (!data) return null;
    if (now - data.windowStart > windowMs) return null;
    return data.windowStart;
  }

  /**
   * Get token sum from a sliding window.
   */
  private getTokenSum(key: string, now: number, windowMs: number): number {
    const data = this.parseWindowData(key);
    if (!data || !data.total) return 0;
    if (now - data.windowStart > windowMs) return 0;
    return data.total;
  }

  /**
   * Add a request count entry to a sliding window with auto-expiry.
   * Uses a simple counter with window reset approach.
   */
  private addToCountWindow(key: string, now: number, ttlMs: number): void {
    const existing = this.parseWindowData(key);
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    if (!existing || now - existing.windowStart > ttlMs) {
      cache.set(key, JSON.stringify({ count: 1, windowStart: now }), ttlSeconds);
    } else {
      cache.set(key, JSON.stringify({ count: (existing.count || 0) + 1, windowStart: existing.windowStart }), ttlSeconds);
    }
  }

  /**
   * Add token count to a sliding window with auto-expiry.
   */
  private addToTokenWindow(key: string, now: number, tokens: number, ttlMs: number): void {
    const existing = this.parseWindowData(key);
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    if (!existing || now - existing.windowStart > ttlMs) {
      cache.set(key, JSON.stringify({ total: tokens, windowStart: now }), ttlSeconds);
    } else {
      cache.set(key, JSON.stringify({ total: (existing.total || 0) + tokens, windowStart: existing.windowStart }), ttlSeconds);
    }
  }
}

export const rateLimitService = new RateLimitService();
