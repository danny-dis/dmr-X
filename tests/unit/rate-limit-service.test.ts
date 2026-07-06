import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimitService } from '../../services/quota/src/rate-limit.service.js';

const { mockCacheStore } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return { mockCacheStore: store };
});

vi.mock('@dmr-x/db', () => ({
  createNamespacedCache: () => ({
    get: (key: string) => mockCacheStore.get(key) ?? null,
    set: (key: string, value: string, _ttl?: number) => { mockCacheStore.set(key, value); },
  }),
  getDb: () => ({
    prepare: () => ({
      run: vi.fn(),
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
    }),
    transaction: (fn: () => void) => fn(),
  }),
}));

vi.mock('@dmr-x/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('RateLimitService', () => {
  let service: RateLimitService;

  beforeEach(() => {
    vi.useFakeTimers();
    mockCacheStore.clear();
    service = new RateLimitService();
  });

  afterEach(() => {
    service.stopDecay();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  // ── setConfig / checkLimit ─────────────────────────────────────────────

  describe('checkLimit', () => {
    it('should allow all requests when no config is set', () => {
      expect(service.checkLimit('test-provider', 'test-model').allowed).toBe(true);
      expect(service.checkLimit('test-provider', 'test-model', 99999).allowed).toBe(true);
    });

    it('should deny requests when RPM limit is exceeded', () => {
      service.setConfig('p', 'm', { rpm: 2 });
      service.recordUsage('p', 'm');
      service.recordUsage('p', 'm');

      const result = service.checkLimit('p', 'm');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('RPM');
    });

    it('should deny requests when RPD limit is exceeded', () => {
      service.setConfig('p', 'm', { rpd: 2 });
      service.recordUsage('p', 'm');
      service.recordUsage('p', 'm');

      const result = service.checkLimit('p', 'm');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('RPD');
    });

    it('should deny requests when TPM limit would be exceeded', () => {
      service.setConfig('p', 'm', { tpm: 1000 });
      service.recordUsage('p', 'm', 800);

      const result = service.checkLimit('p', 'm', 300);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('TPM');
    });

    it('should deny requests when TPD limit would be exceeded', () => {
      service.setConfig('p', 'm', { tpd: 5000 });
      service.recordUsage('p', 'm', 3000);

      const result = service.checkLimit('p', 'm', 3000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('TPD');
    });

    it('should count multiple checks incrementally until limit is hit', () => {
      service.setConfig('p', 'm', { rpm: 3 });

      expect(service.checkLimit('p', 'm').allowed).toBe(true);
      service.recordUsage('p', 'm');

      expect(service.checkLimit('p', 'm').allowed).toBe(true);
      service.recordUsage('p', 'm');

      expect(service.checkLimit('p', 'm').allowed).toBe(true);
      service.recordUsage('p', 'm');

      expect(service.checkLimit('p', 'm').allowed).toBe(false);
    });

    it('should return retryAfterMs when limit is exceeded', () => {
      service.setConfig('p', 'm', { rpm: 1 });
      service.recordUsage('p', 'm');

      const result = service.checkLimit('p', 'm');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60_000);
    });

    it('should allow again after the RPM window expires', () => {
      service.setConfig('p', 'm', { rpm: 1 });
      service.recordUsage('p', 'm');
      expect(service.checkLimit('p', 'm').allowed).toBe(false);

      vi.advanceTimersByTime(61_000);

      expect(service.checkLimit('p', 'm').allowed).toBe(true);
    });

    it('should allow again after the RPD window expires', () => {
      service.setConfig('p', 'm', { rpd: 1 });
      service.recordUsage('p', 'm');
      expect(service.checkLimit('p', 'm').allowed).toBe(false);

      vi.advanceTimersByTime(86_400_000 + 1000);

      expect(service.checkLimit('p', 'm').allowed).toBe(true);
    });
  });

  // ── recordUsage ────────────────────────────────────────────────────────

  describe('recordUsage', () => {
    it('should increment RPM and RPD counters when called', () => {
      service.setConfig('p', 'm', { rpm: 2, rpd: 10 });
      service.recordUsage('p', 'm');

      expect(service.checkLimit('p', 'm').allowed).toBe(true);
      service.recordUsage('p', 'm');

      expect(service.checkLimit('p', 'm').allowed).toBe(false);
    });

    it('should skip token counters when tokens is 0', () => {
      service.setConfig('p', 'm', { rpm: 10, tpm: 500 });
      service.recordUsage('p', 'm', 0);
      service.recordUsage('p', 'm', 0);
      service.recordUsage('p', 'm', 0);

      expect(service.checkLimit('p', 'm', 500).allowed).toBe(true);
    });

    it('should increment both request and token counters when tokens > 0', () => {
      service.setConfig('p', 'm', { rpm: 10, tpm: 1000 });
      service.recordUsage('p', 'm', 600);
      service.recordUsage('p', 'm', 600);

      const result = service.checkLimit('p', 'm', 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('TPM');
    });
  });

  // ── addPenalty / getPenaltyPoints ──────────────────────────────────────

  describe('addPenalty / getPenaltyPoints', () => {
    it('should start with 0 penalty points', () => {
      expect(service.getPenaltyPoints('p', 'm')).toBe(0);
    });

    it('should add 3 penalty points per call', () => {
      service.addPenalty('p', 'm');
      expect(service.getPenaltyPoints('p', 'm')).toBe(3);

      service.addPenalty('p', 'm');
      expect(service.getPenaltyPoints('p', 'm')).toBe(6);
    });

    it('should cap penalty points at 10', () => {
      service.addPenalty('p', 'm');
      service.addPenalty('p', 'm');
      service.addPenalty('p', 'm');
      service.addPenalty('p', 'm');

      expect(service.getPenaltyPoints('p', 'm')).toBe(10);
    });

    it('should return different points for different provider-model pairs', () => {
      service.addPenalty('p1', 'm1');
      service.addPenalty('p1', 'm1');
      service.addPenalty('p2', 'm2');

      expect(service.getPenaltyPoints('p1', 'm1')).toBe(6);
      expect(service.getPenaltyPoints('p2', 'm2')).toBe(3);
    });
  });

  // ── startDecay / stopDecay ─────────────────────────────────────────────

  describe('startDecay / stopDecay', () => {
    it('should decay penalty points by 1 per interval', () => {
      service.addPenalty('p', 'm');
      service.startDecay(1000);

      vi.advanceTimersByTime(1000);
      expect(service.getPenaltyPoints('p', 'm')).toBe(2);

      vi.advanceTimersByTime(1000);
      expect(service.getPenaltyPoints('p', 'm')).toBe(1);

      vi.advanceTimersByTime(1000);
      expect(service.getPenaltyPoints('p', 'm')).toBe(0);
    });

    it('should stop decaying after stopDecay is called', () => {
      service.addPenalty('p', 'm');
      service.startDecay(1000);
      vi.advanceTimersByTime(1000);

      const pointsAfterDecay = service.getPenaltyPoints('p', 'm');
      service.stopDecay();

      vi.advanceTimersByTime(10_000);
      expect(service.getPenaltyPoints('p', 'm')).toBe(pointsAfterDecay);
    });

    it('should evict penalty entries older than 30 minutes', () => {
      service.addPenalty('p', 'm');
      service.startDecay(1000);

      vi.advanceTimersByTime(31 * 60 * 1000);

      expect(service.getPenaltyPoints('p', 'm')).toBe(0);
    });

    it('should not create duplicate intervals when startDecay is called twice', () => {
      service.addPenalty('p', 'm');
      service.startDecay(1000);
      service.startDecay(500);

      vi.advanceTimersByTime(1000);
      expect(service.getPenaltyPoints('p', 'm')).toBe(2);
    });
  });

  // ── Cooldown Methods ───────────────────────────────────────────────────

  describe('cooldown methods', () => {
    it('should set and report cooldown via setCooldown', () => {
      expect(service.isOnCooldown('p', 'm')).toBe(false);
      service.setCooldown('p', 'm', 60_000);
      expect(service.isOnCooldown('p', 'm')).toBe(true);
    });

    it('should expire cooldown after the duration', () => {
      service.setCooldown('p', 'm', 60_000);
      vi.advanceTimersByTime(59_000);
      expect(service.isOnCooldown('p', 'm')).toBe(true);

      vi.advanceTimersByTime(2000);
      expect(service.isOnCooldown('p', 'm')).toBe(false);
    });

    it('should set transient cooldown of 90 seconds', () => {
      service.setTransientCooldown('p', 'm');
      expect(service.isOnCooldown('p', 'm')).toBe(true);

      vi.advanceTimersByTime(90_001);
      expect(service.isOnCooldown('p', 'm')).toBe(false);
    });

    it('should set payment-required cooldown of 24 hours', () => {
      service.setPaymentRequiredCooldown('p', 'm');
      expect(service.isOnCooldown('p', 'm')).toBe(true);

      vi.advanceTimersByTime(24 * 60 * 60_000 + 1);
      expect(service.isOnCooldown('p', 'm')).toBe(false);
    });

    it('should set model-forbidden cooldown of 24 hours', () => {
      service.setModelForbiddenCooldown('p', 'm');
      expect(service.isOnCooldown('p', 'm')).toBe(true);

      vi.advanceTimersByTime(24 * 60 * 60_000 + 1);
      expect(service.isOnCooldown('p', 'm')).toBe(false);
    });

    it('should clear cooldown', () => {
      service.setCooldown('p', 'm', 60_000);
      expect(service.isOnCooldown('p', 'm')).toBe(true);

      service.clearCooldown('p', 'm');
      expect(service.isOnCooldown('p', 'm')).toBe(false);
    });

    it('should return cooldown expiry timestamp', () => {
      service.setCooldown('p', 'm', 60_000);
      const expiry = service.getCooldownExpiry('p', 'm');
      expect(expiry).not.toBeNull();
      expect(typeof expiry).toBe('number');
      expect(expiry!).toBeGreaterThan(Date.now());
    });

    it('should return null from getCooldownExpiry when no cooldown is set', () => {
      expect(service.getCooldownExpiry('p', 'm')).toBeNull();
    });

    it('should return null from getCooldownExpiry after expiry', () => {
      service.setCooldown('p', 'm', 1000);
      vi.advanceTimersByTime(2000);
      expect(service.getCooldownExpiry('p', 'm')).toBeNull();
    });
  });

  // ── Escalating Cooldown (rateLimitHit) ─────────────────────────────────

  describe('rateLimitHit tracking', () => {
    it('should return escalating cooldown durations for successive hits', () => {
      expect(service.recordRateLimitHit('p', 'm')).toBe(2 * 60_000);
      expect(service.recordRateLimitHit('p', 'm')).toBe(10 * 60_000);
      expect(service.recordRateLimitHit('p', 'm')).toBe(60 * 60_000);
      expect(service.recordRateLimitHit('p', 'm')).toBe(24 * 60 * 60_000);
      expect(service.recordRateLimitHit('p', 'm')).toBe(24 * 60 * 60_000);
    });

    it('should apply cooldown after recording a rate limit hit', () => {
      service.recordRateLimitHit('p', 'm');
      expect(service.isOnCooldown('p', 'm')).toBe(true);
    });

    it('should prune hits older than 24 hours', () => {
      service.recordRateLimitHit('p', 'm');
      service.recordRateLimitHit('p', 'm');
      service.recordRateLimitHit('p', 'm');
      service.recordRateLimitHit('p', 'm');

      vi.advanceTimersByTime(24 * 60 * 60_000 + 1000);

      expect(service.recordRateLimitHit('p', 'm')).toBe(2 * 60_000);
    });

    it('should clear hit tracking on clearCooldown', () => {
      service.recordRateLimitHit('p', 'm');
      service.clearCooldown('p', 'm');

      expect(service.recordRateLimitHit('p', 'm')).toBe(2 * 60_000);
    });
  });

  // ── Provider Daily Caps ────────────────────────────────────────────────

  describe('provider daily caps', () => {
    it('should return default daily cap for known providers', () => {
      expect(service.getProviderDailyCap('openrouter')).toBe(1000);
    });

    it('should return null for unknown providers with no env override', () => {
      expect(service.getProviderDailyCap('unknown')).toBeNull();
    });

    it('should use env var override for daily cap', () => {
      vi.stubEnv('PROVIDER_DAILY_CAP_TESTP', '500');
      expect(service.getProviderDailyCap('testp')).toBe(500);
    });

    it('should return null when env var is set to 0', () => {
      vi.stubEnv('PROVIDER_DAILY_CAP_TESTP', '0');
      expect(service.getProviderDailyCap('testp')).toBeNull();
    });

    it('should track and enforce daily cap', () => {
      vi.stubEnv('PROVIDER_DAILY_CAP_TESTP', '2');

      let result = service.checkProviderDailyCap('testp');
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(0);
      expect(result.cap).toBe(2);

      service.recordProviderDailyRequest('testp');
      result = service.checkProviderDailyCap('testp');
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(1);

      service.recordProviderDailyRequest('testp');
      result = service.checkProviderDailyCap('testp');
      expect(result.allowed).toBe(false);
      expect(result.used).toBe(2);
    });

    it('should reset daily cap after 24 hours', () => {
      vi.stubEnv('PROVIDER_DAILY_CAP_TESTP', '2');
      service.recordProviderDailyRequest('testp');
      service.recordProviderDailyRequest('testp');
      expect(service.checkProviderDailyCap('testp').allowed).toBe(false);

      vi.advanceTimersByTime(86_400_000 + 1000);

      const result = service.checkProviderDailyCap('testp');
      expect(result.allowed).toBe(true);
      expect(result.used).toBe(0);
    });
  });

  // ── Concurrent Request Tracking ────────────────────────────────────────

  describe('concurrent request tracking', () => {
    it('should acquire and release concurrency slots', () => {
      expect(service.acquireConcurrencySlot('p', 'req-1')).toBe(true);
      expect(service.getConcurrentCount('p')).toBe(1);

      service.releaseConcurrencySlot('p', 'req-1');
      expect(service.getConcurrentCount('p')).toBe(0);
    });

    it('should track multiple concurrent slots for the same provider', () => {
      service.acquireConcurrencySlot('p', 'req-1');
      service.acquireConcurrencySlot('p', 'req-2');
      service.acquireConcurrencySlot('p', 'req-3');
      expect(service.getConcurrentCount('p')).toBe(3);

      service.releaseConcurrencySlot('p', 'req-2');
      expect(service.getConcurrentCount('p')).toBe(2);
    });

    it('should release only the specific request ID', () => {
      service.acquireConcurrencySlot('p', 'req-1');
      service.acquireConcurrencySlot('p', 'req-2');
      service.releaseConcurrencySlot('p', 'req-1');
      expect(service.getConcurrentCount('p')).toBe(1);
    });

    it('should track separate counts for different providers', () => {
      service.acquireConcurrencySlot('p1', 'req-1');
      service.acquireConcurrencySlot('p1', 'req-2');
      service.acquireConcurrencySlot('p2', 'req-1');

      expect(service.getConcurrentCount('p1')).toBe(2);
      expect(service.getConcurrentCount('p2')).toBe(1);
    });

    it('should deny when concurrent limit from config is reached', () => {
      service.setConfig('p', 'm', { maxConcurrent: 2 });
      service.acquireConcurrencySlot('p', 'req-1');
      service.acquireConcurrencySlot('p', 'req-2');

      const result = service.checkLimit('p', 'm');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Concurrent');
    });

    it('should use env var for concurrent limit when config is unset', () => {
      vi.stubEnv('PROVIDER_MAX_CONCURRENT_P', '1');
      service.setConfig('p', 'm', {});

      service.acquireConcurrencySlot('p', 'req-1');
      const result = service.checkLimit('p', 'm');
      expect(result.allowed).toBe(false);

      vi.unstubAllEnvs();
    });

    it('should disable concurrent limit when env var is set to 0', () => {
      vi.stubEnv('PROVIDER_MAX_CONCURRENT_P', '0');
      service.setConfig('p', 'm', {});

      service.acquireConcurrencySlot('p', 'req-1');
      service.acquireConcurrencySlot('p', 'req-2');
      const result = service.checkLimit('p', 'm');
      expect(result.allowed).toBe(true);

      vi.unstubAllEnvs();
    });

    it('should allow acquiring when no limit is configured', () => {
      expect(service.acquireConcurrencySlot('p', 'req-1')).toBe(true);
    });

    it('should return 0 for providers with no concurrent requests', () => {
      expect(service.getConcurrentCount('unknown')).toBe(0);
    });
  });

  // ── parseProviderLimit ─────────────────────────────────────────────────

  describe('parseProviderLimit', () => {
    it('should parse TPM limit from message containing tpm keyword', () => {
      const result = service.parseProviderLimit('tpm limit 30000, requested 33476');
      expect(result).toEqual({ kind: 'tpm', limit: 30000 });
    });

    it('should parse RPM limit from message containing rpm keyword', () => {
      const result = service.parseProviderLimit('rpm limit 10, requested 15');
      expect(result).toEqual({ kind: 'rpm', limit: 10 });
    });

    it('should parse TPD limit from message containing tokens per day', () => {
      const result = service.parseProviderLimit('tokens per day limit 500000');
      expect(result).toEqual({ kind: 'tpd', limit: 500000 });
    });

    it('should parse RPD limit from message containing requests per day', () => {
      const result = service.parseProviderLimit('requests per day limit 1000');
      expect(result).toEqual({ kind: 'rpd', limit: 1000 });
    });

    it('should parse limit with comma-formatted numbers', () => {
      const result = service.parseProviderLimit('tpm limit 1,000,000');
      expect(result).toEqual({ kind: 'tpm', limit: 1000000 });
    });

    it('should return null for messages without a limit number', () => {
      expect(service.parseProviderLimit('some random error')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(service.parseProviderLimit('')).toBeNull();
    });

    it('should return null for null or undefined', () => {
      expect(service.parseProviderLimit(null)).toBeNull();
      expect(service.parseProviderLimit(undefined)).toBeNull();
    });
  });

  // ── getState ───────────────────────────────────────────────────────────

  describe('getState', () => {
    it('should return current state with counters', () => {
      service.setConfig('p', 'm', { rpm: 10, rpd: 100, tpm: 10000 });
      service.recordUsage('p', 'm', 500);

      const state = service.getState('p', 'm');
      expect(state.providerId).toBe('p');
      expect(state.modelId).toBe('m');
      expect(state.currentRPM).toBe(1);
      expect(state.currentRPD).toBe(1);
      expect(state.currentTPM).toBe(500);
      expect(state.currentTPD).toBe(0);
      expect(state.penaltyPoints).toBe(0);
    });

    it('should include concurrent count and penalty points', () => {
      service.setConfig('p', 'm', {});
      service.acquireConcurrencySlot('p', 'req-1');
      service.addPenalty('p', 'm');

      const state = service.getState('p', 'm');
      expect(state.currentConcurrent).toBe(1);
      expect(state.penaltyPoints).toBe(3);
    });
  });

  // ── getActiveCooldowns ─────────────────────────────────────────────────

  describe('getActiveCooldowns', () => {
    it('should return empty array when no cooldowns are active', () => {
      expect(service.getActiveCooldowns()).toEqual([]);
    });

    it('should return active cooldowns', () => {
      service.setCooldown('p1', 'm1', 60_000);
      service.setCooldown('p2', 'm2', 30_000);

      const cooldowns = service.getActiveCooldowns();
      expect(cooldowns).toHaveLength(2);
      expect(cooldowns[0].providerId).toBe('p1');
      expect(cooldowns[0].modelId).toBe('m1');
      expect(cooldowns[1].providerId).toBe('p2');
      expect(cooldowns[1].modelId).toBe('m2');
    });

    it('should exclude expired cooldowns', () => {
      service.setCooldown('p', 'm', 1000);
      service.setCooldown('p2', 'm2', 60_000);

      vi.advanceTimersByTime(2000);

      const cooldowns = service.getActiveCooldowns();
      expect(cooldowns).toHaveLength(1);
      expect(cooldowns[0].providerId).toBe('p2');
    });
  });
});
