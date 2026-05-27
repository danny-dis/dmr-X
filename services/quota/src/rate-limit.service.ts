import { getRedis } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
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
   * Get the Redis key for a window.
   */
  private redisKey(providerId: string, modelId: string, window: string): string {
    return `rl:${providerId}:${modelId}:${window}`;
  }

  /**
   * Check if a request would exceed rate limits.
   */
  async checkLimit(
    providerId: string,
    modelId: string,
    estimatedTokens: number = 0
  ): Promise<RateLimitCheckResult> {
    const key = this.configKey(providerId, modelId);
    const config = this.configs.get(key);

    if (!config) {
      return { allowed: true }; // No config = no limits
    }

    const redis = getRedis();
    const now = Date.now();

    // Check RPM
    if (config.rpm) {
      const rpmKey = this.redisKey(providerId, modelId, 'rpm');
      const count = await this.countWindow(redis, rpmKey, now, 60_000);
      if (count >= config.rpm) {
        const oldest = await this.oldestInWindow(redis, rpmKey, now, 60_000);
        const retryAfterMs = oldest ? 60_000 - (now - oldest) : 60_000;
        return { allowed: false, retryAfterMs, reason: `RPM limit (${config.rpm}) exceeded` };
      }
    }

    // Check RPD
    if (config.rpd) {
      const rpdKey = this.redisKey(providerId, modelId, 'rpd');
      const count = await this.countWindow(redis, rpdKey, now, 86_400_000);
      if (count >= config.rpd) {
        const oldest = await this.oldestInWindow(redis, rpdKey, now, 86_400_000);
        const retryAfterMs = oldest ? 86_400_000 - (now - oldest) : 86_400_000;
        return { allowed: false, retryAfterMs, reason: `RPD limit (${config.rpd}) exceeded` };
      }
    }

    // Check TPM
    if (config.tpm && estimatedTokens > 0) {
      const tpmKey = this.redisKey(providerId, modelId, 'tpm');
      const tokens = await this.sumWindow(redis, tpmKey, now, 60_000);
      if (tokens + estimatedTokens > config.tpm) {
        return { allowed: false, retryAfterMs: 60_000, reason: `TPM limit (${config.tpm}) would be exceeded` };
      }
    }

    // Check TPD
    if (config.tpd && estimatedTokens > 0) {
      const tpdKey = this.redisKey(providerId, modelId, 'tpd');
      const tokens = await this.sumWindow(redis, tpdKey, now, 86_400_000);
      if (tokens + estimatedTokens > config.tpd) {
        return { allowed: false, retryAfterMs: 86_400_000, reason: `TPD limit (${config.tpd}) would be exceeded` };
      }
    }

    return { allowed: true };
  }

  /**
   * Record usage after a successful or failed request.
   */
  async recordUsage(
    providerId: string,
    modelId: string,
    tokens: number = 0
  ): Promise<void> {
    const redis = getRedis();
    const now = Date.now();
    const requestId = `req_${now}_${Math.random().toString(36).slice(2, 8)}`;

    // Record in RPM window
    const rpmKey = this.redisKey(providerId, modelId, 'rpm');
    await this.addToWindow(redis, rpmKey, requestId, now, 120_000); // 2 min TTL

    // Record in RPD window
    const rpdKey = this.redisKey(providerId, modelId, 'rpd');
    await this.addToWindow(redis, rpdKey, `rpd_${requestId}`, now, 172_800_000); // 2 day TTL

    // Record tokens in TPM window
    if (tokens > 0) {
      const tpmKey = this.redisKey(providerId, modelId, 'tpm');
      await this.addToWindow(redis, tpmKey, `tpm_${requestId}:${tokens}`, now, 120_000);

      // Record tokens in TPD window
      const tpdKey = this.redisKey(providerId, modelId, 'tpd');
      await this.addToWindow(redis, tpdKey, `tpd_${requestId}:${tokens}`, now, 172_800_000);
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
  async getState(providerId: string, modelId: string): Promise<RateLimitState> {
    const key = this.configKey(providerId, modelId);
    const config = this.configs.get(key) || {};
    const redis = getRedis();
    const now = Date.now();

    const [currentRPM, currentRPD, currentTPM, currentTPD] = await Promise.all([
      config.rpm ? this.countWindow(redis, this.redisKey(providerId, modelId, 'rpm'), now, 60_000) : 0,
      config.rpd ? this.countWindow(redis, this.redisKey(providerId, modelId, 'rpd'), now, 86_400_000) : 0,
      config.tpm ? this.sumWindow(redis, this.redisKey(providerId, modelId, 'tpm'), now, 60_000) : 0,
      config.tpd ? this.sumWindow(redis, this.redisKey(providerId, modelId, 'tpd'), now, 86_400_000) : 0,
    ]);

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

  /**
   * Count entries in a sliding window using Redis sorted set.
   */
  private async countWindow(
    redis: ReturnType<typeof getRedis>,
    key: string,
    now: number,
    windowMs: number
  ): Promise<number> {
    const minScore = now - windowMs;
    return redis.zCount(key, minScore.toString(), '+inf');
  }

  /**
   * Sum token counts from a sliding window.
   * Member format: tpm_{requestId}:{tokens} or tpd_{requestId}:{tokens}
   */
  private async sumWindow(
    redis: ReturnType<typeof getRedis>,
    key: string,
    now: number,
    windowMs: number
  ): Promise<number> {
    const minScore = now - windowMs;
    const members = await redis.zRangeByScore(key, minScore.toString(), '+inf');
    let sum = 0;
    for (const member of members) {
      const lastColon = member.lastIndexOf(':');
      if (lastColon !== -1) {
        const tokenCount = parseInt(member.slice(lastColon + 1), 10);
        if (!isNaN(tokenCount)) sum += tokenCount;
      }
    }
    return sum;
  }

  /**
   * Get the oldest entry timestamp in a window.
   */
  private async oldestInWindow(
    redis: ReturnType<typeof getRedis>,
    key: string,
    now: number,
    windowMs: number
  ): Promise<number | null> {
    const minScore = now - windowMs;
    const members = await redis.zRangeByScore(key, minScore.toString(), '+inf', { LIMIT: { offset: 0, count: 1 } });
    if (members.length === 0) return null;
    const score = await redis.zScore(key, members[0]);
    return score ? Number(score) : null;
  }

  /**
   * Add an entry to a sliding window with auto-expiry.
   */
  private async addToWindow(
    redis: ReturnType<typeof getRedis>,
    key: string,
    member: string,
    score: number,
    ttlMs: number
  ): Promise<void> {
    await redis.zAdd(key, { score, value: member });
    await redis.expire(key, Math.ceil(ttlMs / 1000));
  }
}

export const rateLimitService = new RateLimitService();
