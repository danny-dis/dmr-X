import type { RateLimitConfig, RateLimitCheckResult, RateLimitState } from '@dmr-x/core';
import { createNamespacedCache, getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

const cache = createNamespacedCache('rl');

interface WindowData {
  count?: number;
  total?: number;
  windowStart: number;
}

// Escalating cooldown durations (ms) based on 429 hit count within 24h
const COOLDOWN_DURATIONS = [
  2 * 60_000,      // 1st hit: 2 minutes
  10 * 60_000,     // 2nd hit: 10 minutes
  60 * 60_000,     // 3rd hit: 1 hour
  24 * 60 * 60_000, // 4th+ hit: 24 hours
];

const TRANSIENT_COOLDOWN_MS = 90_000; // 90s for RPM/TPM 429s
const PAYMENT_REQUIRED_COOLDOWN_MS = 24 * 60 * 60_000; // 24h for 402
const MODEL_FORBIDDEN_COOLDOWN_MS = 24 * 60 * 60_000; // 24h for 403

// Provider-wide daily request caps (configurable via env)
const DEFAULT_PROVIDER_DAILY_CAPS: Record<string, number> = {
  openrouter: 1000,
};

// Rate limit hit tracking for escalation
interface RateLimitHit {
  timestamps: number[];
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
  // Escalating cooldown state
  private cooldowns = new Map<string, number>(); // key -> expiry timestamp
  private rateLimitHits = new Map<string, RateLimitHit>(); // key -> hit timestamps
  // Provider-wide daily request tracking
  private providerDailyRequests = new Map<string, { count: number; windowStart: number }>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.recoverState();
    // Persist state every 60 seconds
    this.persistTimer = setInterval(() => this.persistState(), 60_000);
  }

  /**
   * Recover cooldowns, penalties, and daily caps from SQLite on startup.
   */
  private recoverState(): void {
    try {
      const db = getDb();
      const now = Date.now();

      const rows = db.prepare(
        `SELECT provider_id, model_id, cooldown_expiry, penalty_points, last_penalty_at, hit_timestamps
         FROM rate_limit_cooldowns`
      ).all() as any[];

      let cooldownCount = 0;
      let penaltyCount = 0;

      for (const row of rows) {
        const key = `${row.provider_id}:${row.model_id}`;
        if (row.cooldown_expiry > now) {
          this.cooldowns.set(`${key}:cooldown`, row.cooldown_expiry);
          cooldownCount++;
        }
        if (row.penalty_points > 0) {
          this.penalties.set(key, {
            points: row.penalty_points,
            lastPenalty: row.last_penalty_at || now,
          });
          penaltyCount++;
        }
        if (row.hit_timestamps) {
          try {
            const timestamps = JSON.parse(row.hit_timestamps) as number[];
            const recentHits = timestamps.filter(t => t > now - 24 * 60 * 60_000);
            if (recentHits.length > 0) {
              this.rateLimitHits.set(key, { timestamps: recentHits });
            }
          } catch { /* ignore */ }
        }
      }

      const capRows = db.prepare(
        `SELECT provider_id, request_count, window_start FROM rate_limit_daily_caps`
      ).all() as any[];

      let capCount = 0;
      for (const row of capRows) {
        if (now - row.window_start < 86_400_000) {
          this.providerDailyRequests.set(`provider:${row.provider_id}:daily`, {
            count: row.request_count,
            windowStart: row.window_start,
          });
          capCount++;
        }
      }

      if (cooldownCount > 0 || penaltyCount > 0 || capCount > 0) {
        logger.info(
          { cooldowns: cooldownCount, penalties: penaltyCount, dailyCaps: capCount },
          'Recovered rate-limit state from database'
        );
      }
    } catch (error) {
      logger.debug({ err: error }, 'Could not recover rate-limit state (DB may not be ready)');
    }
  }

  /**
   * Persist current cooldown and penalty state to SQLite.
   */
  persistState(): void {
    try {
      const db = getDb();

      const upsert = db.prepare(`
        INSERT INTO rate_limit_cooldowns (provider_id, model_id, cooldown_expiry, penalty_points, last_penalty_at, hit_timestamps, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(provider_id, model_id) DO UPDATE SET
          cooldown_expiry = excluded.cooldown_expiry,
          penalty_points = excluded.penalty_points,
          last_penalty_at = excluded.last_penalty_at,
          hit_timestamps = excluded.hit_timestamps,
          updated_at = datetime('now')
      `);

      const persistMany = db.transaction(() => {
        const allKeys = new Set<string>();
        for (const [key] of this.cooldowns) {
          if (key.endsWith(':cooldown')) {
            allKeys.add(key.replace(':cooldown', ''));
          }
        }
        for (const [key] of this.penalties) {
          allKeys.add(key);
        }

        for (const key of allKeys) {
          const parts = key.split(':');
          const providerId = parts[0];
          const modelId = parts.slice(1).join(':');
          const cooldownExpiry = this.cooldowns.get(`${key}:cooldown`) || 0;
          const penalty = this.penalties.get(key);
          const hitData = this.rateLimitHits.get(key);

          upsert.run(
            providerId, modelId, cooldownExpiry,
            penalty?.points || 0, penalty?.lastPenalty || null,
            hitData ? JSON.stringify(hitData.timestamps) : '[]',
          );
        }

        const capUpsert = db.prepare(`
          INSERT INTO rate_limit_daily_caps (provider_id, request_count, window_start)
          VALUES (?, ?, ?)
          ON CONFLICT(provider_id) DO UPDATE SET
            request_count = excluded.request_count,
            window_start = excluded.window_start
        `);

        for (const [key, data] of this.providerDailyRequests) {
          const match = key.match(/^provider:(.+):daily$/);
          if (match) {
            capUpsert.run(match[1], data.count, data.windowStart);
          }
        }
      });

      persistMany();
    } catch (error) {
      logger.debug({ err: error }, 'Failed to persist rate-limit state');
    }
  }

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
    // Persist immediately on penalty addition
    this.persistState();
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
   * Also evicts entries older than 30 minutes to prevent unbounded growth.
   */
  startDecay(intervalMs: number = 120_000): void {
    if (this.decayInterval) return;
    const MAX_PENALTY_AGE_MS = 30 * 60 * 1000; // 30 minutes
    this.decayInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, penalty] of this.penalties.entries()) {
        if (now - penalty.lastPenalty > MAX_PENALTY_AGE_MS) {
          this.penalties.delete(key);
        } else if (penalty.points > 0) {
          penalty.points -= 1;
          if (penalty.points <= 0) {
            this.penalties.delete(key);
          }
        }
      }
    }, intervalMs);
  }

  /**
   * Stop the penalty decay and persist intervals.
   */
  stopDecay(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
  }

  // ── Escalating Cooldown ──────────────────────────────────────────────────

  /**
   * Record a 429 hit for escalation tracking.
   * Returns the cooldown duration to apply.
   */
  recordRateLimitHit(providerId: string, modelId: string): number {
    const key = `${providerId}:${modelId}`;
    const now = Date.now();
    const hit = this.rateLimitHits.get(key) || { timestamps: [] };

    // Prune hits older than 24h
    hit.timestamps = hit.timestamps.filter(t => t > now - 24 * 60 * 60_000);
    hit.timestamps.push(now);
    this.rateLimitHits.set(key, hit);

    // Escalate based on hit count
    const idx = Math.min(hit.timestamps.length - 1, COOLDOWN_DURATIONS.length - 1);
    const duration = COOLDOWN_DURATIONS[idx];

    this.setCooldown(providerId, modelId, duration);
    logger.warn({ providerId, modelId, hitCount: hit.timestamps.length, cooldownMs: duration }, 'Escalating cooldown applied');
    // setCooldown already persists for long cooldowns; persist here for all durations
    this.persistState();
    return duration;
  }

  /**
   * Set a cooldown for a provider/model pair.
   */
  setCooldown(providerId: string, modelId: string, durationMs: number): void {
    const key = `${providerId}:${modelId}:cooldown`;
    this.cooldowns.set(key, Date.now() + durationMs);
    // Persist immediately for critical cooldowns (>= 1 hour)
    if (durationMs >= 60 * 60_000) {
      this.persistState();
    }
  }

  /**
   * Set a transient cooldown (90s for RPM/TPM 429s).
   */
  setTransientCooldown(providerId: string, modelId: string): void {
    this.setCooldown(providerId, modelId, TRANSIENT_COOLDOWN_MS);
  }

  /**
   * Set a payment-required cooldown (24h for 402).
   */
  setPaymentRequiredCooldown(providerId: string, modelId: string): void {
    this.setCooldown(providerId, modelId, PAYMENT_REQUIRED_COOLDOWN_MS);
  }

  /**
   * Set a model-forbidden cooldown (24h for 403).
   */
  setModelForbiddenCooldown(providerId: string, modelId: string): void {
    this.setCooldown(providerId, modelId, MODEL_FORBIDDEN_COOLDOWN_MS);
  }

  /**
   * Check if a provider/model is on cooldown.
   */
  isOnCooldown(providerId: string, modelId: string): boolean {
    const key = `${providerId}:${modelId}:cooldown`;
    const expiry = this.cooldowns.get(key);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.cooldowns.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get cooldown expiry for a provider/model.
   */
  getCooldownExpiry(providerId: string, modelId: string): number | null {
    const key = `${providerId}:${modelId}:cooldown`;
    const expiry = this.cooldowns.get(key);
    if (!expiry) return null;
    if (Date.now() > expiry) {
      this.cooldowns.delete(key);
      return null;
    }
    return expiry;
  }

  /**
   * Clear cooldown for a provider/model (on successful request).
   */
  clearCooldown(providerId: string, modelId: string): void {
    const key = `${providerId}:${modelId}:cooldown`;
    this.cooldowns.delete(key);
    // Also clear hit tracking to allow fresh escalation
    const hitKey = `${providerId}:${modelId}`;
    this.rateLimitHits.delete(hitKey);
  }

  // ── Provider-Wide Daily Request Caps ─────────────────────────────────────

  /**
   * Get the provider-wide daily request cap.
   * Configurable via PROVIDER_DAILY_CAP_{PROVIDER_ID} env var.
   */
  getProviderDailyCap(providerId: string): number | null {
    const envKey = `PROVIDER_DAILY_CAP_${providerId.toUpperCase()}`;
    const envVal = process.env[envKey];
    if (envVal !== undefined) {
      const n = Number(envVal);
      if (Number.isFinite(n) && n >= 0) return n === 0 ? null : n;
    }
    return DEFAULT_PROVIDER_DAILY_CAPS[providerId] ?? null;
  }

  /**
   * Check if a provider has exceeded its daily request cap.
   */
  checkProviderDailyCap(providerId: string): { allowed: boolean; used: number; cap: number | null } {
    const cap = this.getProviderDailyCap(providerId);
    if (cap === null) return { allowed: true, used: 0, cap: null };

    const now = Date.now();
    const key = `provider:${providerId}:daily`;
    const data = this.providerDailyRequests.get(key);

    if (!data || now - data.windowStart > 86_400_000) {
      return { allowed: true, used: 0, cap };
    }

    return { allowed: data.count < cap, used: data.count, cap };
  }

  /**
   * Record a request against the provider-wide daily cap.
   */
  recordProviderDailyRequest(providerId: string): void {
    const now = Date.now();
    const key = `provider:${providerId}:daily`;
    const data = this.providerDailyRequests.get(key);

    if (!data || now - data.windowStart > 86_400_000) {
      this.providerDailyRequests.set(key, { count: 1, windowStart: now });
    } else {
      data.count++;
    }
  }

  /**
   * Get all active cooldowns (for dashboard display).
   */
  getActiveCooldowns(): Array<{ providerId: string; modelId: string; expiresAt: number }> {
    const now = Date.now();
    const result: Array<{ providerId: string; modelId: string; expiresAt: number }> = [];
    for (const [key, expiry] of this.cooldowns) {
      if (expiry > now) {
        const parts = key.split(':');
        if (parts.length >= 2) {
          result.push({ providerId: parts[0], modelId: parts[1], expiresAt: expiry });
        }
      }
    }
    return result;
  }

  // ── Self-Correcting Catalog (Learn Limits from Errors) ───────────────────

  /**
   * Parse a provider-reported limit from an error message.
   * E.g., "Limit 30000, Requested 33476" from Groq 413 errors.
   */
  parseProviderLimit(message: string | undefined | null): { kind: 'tpm' | 'tpd' | 'rpm' | 'rpd'; limit: number } | null {
    if (!message) return null;

    // Extract the numeric limit
    const limitMatch = message.match(/\blimit[:\s]+([\d,]+)/i);
    if (!limitMatch) return null;
    const limit = Number(limitMatch[1]!.replace(/,/g, ''));
    if (!Number.isFinite(limit) || limit <= 0) return null;

    // Determine the axis (TPM/TPD/RPM/RPD)
    const patterns: Array<{ kind: 'tpm' | 'tpd' | 'rpm' | 'rpd'; re: RegExp }> = [
      { kind: 'tpd', re: /tokens?\s*per\s*day|\btpd\b/i },
      { kind: 'tpm', re: /tokens?\s*per\s*min(?:ute)?|\btpm\b/i },
      { kind: 'rpd', re: /requests?\s*per\s*day|\brpd\b/i },
      { kind: 'rpm', re: /requests?\s*per\s*min(?:ute)?|\brpm\b/i },
    ];

    for (const { kind, re } of patterns) {
      if (re.test(message)) return { kind, limit };
    }

    return null;
  }

  /**
   * Learn a real limit from an error and persist it.
   * Only lowers limits, never raises them.
   */
  learnLimitFromError(modelId: string, err: { message?: string }): { kind: string; limit: number } | null {
    const parsed = this.parseProviderLimit(err?.message);
    if (!parsed) return null;

    try {
      const { getDb } = require('@dmr-x/db');
      const db = getDb();
      const columnMap: Record<string, string> = {
        tpm: 'tpm_limit',
        tpd: 'tpd_limit',
        rpm: 'rpm_limit',
        rpd: 'rpd_limit',
      };
      const col = columnMap[parsed.kind];
      if (!col) return null;

      // Only lower limits, never raise them
      const result = db.prepare(
        `UPDATE model_profiles SET ${col} = ? WHERE model_id = ? AND (${col} IS NULL OR ${col} > ?)`
      ).run(parsed.limit, modelId, parsed.limit);

      if (result.changes > 0) {
        logger.warn({ modelId, kind: parsed.kind, limit: parsed.limit }, 'Learned real limit from error');
        return { kind: parsed.kind, limit: parsed.limit };
      }
    } catch (error) {
      logger.debug({ err: error, modelId }, 'Failed to learn limit from error');
    }

    return null;
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
