import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import {
  FreeProviderCatalog,
  computeAgeConfidence,
  DEFAULT_POLICY,
  type CatalogRecord,
  type EligibilityPolicy,
} from '../../services/quota/src/free-provider-catalog.js';

const SEED_FILE = resolve(
  __dirname,
  '../../services/quota/src/free-provider-catalog-seed.json',
);

function makeRecord(overrides: Partial<CatalogRecord> = {}): CatalogRecord {
  return {
    providerId: 'test-provider',
    modelId: 'test-model',
    endpoint: 'https://api.test.com/v1',
    plan: 'free',
    freeEligibility: 'free_with_limits',
    publishedLimits: { rpm: 100 },
    quotaDimensions: ['requests'],
    scope: 'key',
    resetSemantics: 'fixed_window',
    sourceUrls: ['https://test.com/docs'],
    sourceVerifiedAt: new Date().toISOString(),
    catalogRevision: 1,
    confidence: 0.9,
    status: 'active',
    ...overrides,
  };
}

describe('computeAgeConfidence', () => {
  const NOW = Date.parse('2026-09-07T00:00:00Z');

  it('returns 1.0 for future-dated verification (clock skew)', () => {
    const future = new Date(NOW + 60_000).toISOString();
    expect(computeAgeConfidence(future, NOW)).toBe(1.0);
  });

  it('returns 0 for unparseable date', () => {
    expect(computeAgeConfidence('not-a-date', NOW)).toBe(0);
  });

  it('returns ~1.0 for very recent verification (< 24h)', () => {
    const recent = new Date(NOW - 60_000).toISOString(); // 1 minute ago
    const c = computeAgeConfidence(recent, NOW);
    expect(c).toBeGreaterThan(0.9);
    expect(c).toBeLessThanOrEqual(1.0);
  });

  it('returns ~0.9 at exactly 24h', () => {
    const dayAgo = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    const c = computeAgeConfidence(dayAgo, NOW);
    expect(c).toBeCloseTo(0.9, 1);
  });

  it('returns ~0.5 at 7 days', () => {
    const weekAgo = new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString();
    const c = computeAgeConfidence(weekAgo, NOW);
    expect(c).toBeCloseTo(0.5, 1);
  });

  it('returns < 0.5 beyond 7 days', () => {
    const old = new Date(NOW - 14 * 24 * 60 * 60 * 1000).toISOString();
    const c = computeAgeConfidence(old, NOW);
    expect(c).toBeLessThan(0.5);
  });

  it('never returns negative', () => {
    const ancient = new Date(NOW - 365 * 24 * 60 * 60 * 1000).toISOString();
    const c = computeAgeConfidence(ancient, NOW);
    expect(c).toBeGreaterThanOrEqual(0);
  });
});

describe('FreeProviderCatalog — loadCatalog', () => {
  it('loads records from JSON file', () => {
    const catalog = new FreeProviderCatalog();
    const count = catalog.loadCatalog(SEED_FILE);
    expect(count).toBeGreaterThanOrEqual(5);
    expect(catalog.getAllRecords().length).toBe(count);
  });

  it('loads records synchronously from array', () => {
    const catalog = new FreeProviderCatalog();
    const records = [
      makeRecord({ providerId: 'p1', modelId: 'm1' }),
      makeRecord({ providerId: 'p2', modelId: 'm2' }),
    ];
    const count = catalog.loadCatalogSync(records);
    expect(count).toBe(2);
    expect(catalog.getRecord('p1', 'm1')).toBeDefined();
    expect(catalog.getRecord('p2', 'm2')).toBeDefined();
  });

  it('creates audit entries on load', () => {
    const catalog = new FreeProviderCatalog();
    catalog.loadCatalogSync([makeRecord()]);
    const log = catalog.getAuditLog();
    expect(log.length).toBe(1);
    expect(log[0].action).toBe('load');
  });
});

describe('FreeProviderCatalog — checkEligibility', () => {
  let catalog: FreeProviderCatalog;

  beforeEach(() => {
    catalog = new FreeProviderCatalog();
    catalog.loadCatalogSync([
      makeRecord({
        providerId: 'groq',
        modelId: 'llama-3.1-70b',
        freeEligibility: 'free_with_limits',
        status: 'active',
        confidence: 0.9,
      }),
      makeRecord({
        providerId: 'paid-pro',
        modelId: 'paid-model',
        freeEligibility: 'paid',
        status: 'active',
        confidence: 1.0,
      }),
      makeRecord({
        providerId: 'unknown-pro',
        modelId: 'unknown-model',
        freeEligibility: 'unknown',
        status: 'active',
        confidence: 0.5,
      }),
      makeRecord({
        providerId: 'stale-pro',
        modelId: 'stale-model',
        freeEligibility: 'free_with_limits',
        status: 'stale',
        confidence: 0.9,
      }),
      makeRecord({
        providerId: 'discovered-pro',
        modelId: 'discovered-model',
        freeEligibility: 'free_with_limits',
        status: 'discovered',
        confidence: 0.9,
      }),
    ]);
  });

  it('returns eligible for active free_with_limits', () => {
    const result = catalog.checkEligibility('groq', 'llama-3.1-70b');
    expect(result.eligible).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.record).toBeDefined();
  });

  it('returns ineligible for paid', () => {
    const result = catalog.checkEligibility('paid-pro', 'paid-model');
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('paid');
  });

  it('returns ineligible for unknown', () => {
    const result = catalog.checkEligibility('unknown-pro', 'unknown-model');
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('unknown');
  });

  it('returns ineligible for stale status', () => {
    const result = catalog.checkEligibility('stale-pro', 'stale-model');
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('stale');
  });

  it('returns ineligible for discovered status', () => {
    const result = catalog.checkEligibility('discovered-pro', 'discovered-model');
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('discovered');
  });

  it('returns ineligible for non-existent record', () => {
    const result = catalog.checkEligibility('nonexistent', 'model');
    expect(result.eligible).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.reason).toContain('No catalog record');
  });

  it('strictFree policy rejects free_with_limits', () => {
    const result = catalog.checkEligibility('groq', 'llama-3.1-70b', {
      strictFree: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('Strict-free');
  });

  it('minConfidence policy rejects low confidence', () => {
    const result = catalog.checkEligibility('groq', 'llama-3.1-70b', {
      minConfidence: 0.95,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('Confidence');
  });

  it('uses default policy when none provided', () => {
    const result = catalog.checkEligibility('groq', 'llama-3.1-70b');
    expect(result.eligible).toBe(true);
  });
});

describe('FreeProviderCatalog — recordObservation', () => {
  let catalog: FreeProviderCatalog;

  beforeEach(() => {
    catalog = new FreeProviderCatalog();
    catalog.loadCatalogSync([
      makeRecord({
        providerId: 'groq',
        modelId: 'llama-3.1-70b',
        status: 'active',
        confidence: 0.8,
      }),
    ]);
  });

  it('boosts confidence on observation', () => {
    const before = catalog.getRecord('groq', 'llama-3.1-70b')!.confidence;
    catalog.recordObservation('groq', 'llama-3.1-70b', {
      remainingRequests: 10,
      limitRequests: 30,
    });
    const after = catalog.getRecord('groq', 'llama-3.1-70b')!.confidence;
    expect(after).toBeGreaterThan(before);
  });

  it('transitions status from active to observed', () => {
    catalog.recordObservation('groq', 'llama-3.1-70b', {
      remainingRequests: 10,
    });
    expect(catalog.getRecord('groq', 'llama-3.1-70b')!.status).toBe('observed');
  });

  it('transitions status from discovered to observed', () => {
    catalog.loadCatalogSync([
      makeRecord({
        providerId: 'new-pro',
        modelId: 'new-model',
        status: 'discovered',
        confidence: 0.5,
      }),
    ]);
    catalog.recordObservation('new-pro', 'new-model', {
      remainingRequests: 5,
    });
    expect(catalog.getRecord('new-pro', 'new-model')!.status).toBe('observed');
  });

  it('transitions status from verified to observed', () => {
    catalog.loadCatalogSync([
      makeRecord({
        providerId: 'verified-pro',
        modelId: 'verified-model',
        status: 'verified',
        confidence: 0.7,
      }),
    ]);
    catalog.recordObservation('verified-pro', 'verified-model', {
      remainingRequests: 5,
    });
    expect(catalog.getRecord('verified-pro', 'verified-model')!.status).toBe(
      'observed',
    );
  });

  it('boosts more with rate-limit headers', () => {
    const cat1 = new FreeProviderCatalog();
    cat1.loadCatalogSync([
      makeRecord({
        providerId: 'p1',
        modelId: 'm1',
        status: 'active',
        confidence: 0.5,
      }),
    ]);
    cat1.recordObservation('p1', 'm1', { remainingRequests: 10 });
    const boost1 = cat1.getRecord('p1', 'm1')!.confidence - 0.5;

    const cat2 = new FreeProviderCatalog();
    cat2.loadCatalogSync([
      makeRecord({
        providerId: 'p2',
        modelId: 'm2',
        status: 'active',
        confidence: 0.5,
      }),
    ]);
    cat2.recordObservation('p2', 'm2', {
      remainingRequests: 10,
      rateLimitHeaders: { 'x-ratelimit-remaining': '10' },
    });
    const boost2 = cat2.getRecord('p2', 'm2')!.confidence - 0.5;

    expect(boost2).toBeGreaterThan(boost1);
  });

  it('never exceeds confidence 1.0', () => {
    catalog.loadCatalogSync([
      makeRecord({
        providerId: 'max-pro',
        modelId: 'max-model',
        status: 'active',
        confidence: 0.99,
      }),
    ]);
    catalog.recordObservation('max-pro', 'max-model', {
      rateLimitHeaders: { 'x-ratelimit-remaining': '10' },
    });
    expect(catalog.getRecord('max-pro', 'max-model')!.confidence).toBeLessThanOrEqual(
      1.0,
    );
  });

  it('returns null for non-existent record', () => {
    const result = catalog.recordObservation('nonexistent', 'model', {});
    expect(result).toBeNull();
  });

  it('creates audit entry on observation', () => {
    catalog.recordObservation('groq', 'llama-3.1-70b', { remainingRequests: 10 });
    const history = catalog.getRevisionHistory('groq', 'llama-3.1-70b');
    const obsEntry = history.find(e => e.action === 'observation');
    expect(obsEntry).toBeDefined();
    expect(obsEntry!.previousConfidence).toBe(0.8);
    expect(obsEntry!.newConfidence).toBeGreaterThan(0.8);
  });

  it('updates sourceVerifiedAt for fresh observations', () => {
    const now = Date.now();
    catalog.recordObservation('groq', 'llama-3.1-70b', {
      observedAtMs: now,
      remainingRequests: 10,
    });
    const record = catalog.getRecord('groq', 'llama-3.1-70b')!;
    const verifiedMs = new Date(record.sourceVerifiedAt).getTime();
    expect(Math.abs(verifiedMs - now)).toBeLessThan(1000);
  });
});

describe('FreeProviderCatalog — getRevisionHistory', () => {
  it('returns only entries for the specified provider+model', () => {
    const catalog = new FreeProviderCatalog();
    catalog.loadCatalogSync([
      makeRecord({ providerId: 'p1', modelId: 'm1' }),
      makeRecord({ providerId: 'p2', modelId: 'm2' }),
    ]);
    catalog.recordObservation('p1', 'm1', { remainingRequests: 5 });

    const history = catalog.getRevisionHistory('p1', 'm1');
    expect(history.length).toBe(2); // load + observation
    expect(history.every(e => e.providerId === 'p1' && e.modelId === 'm1')).toBe(
      true,
    );
  });

  it('returns empty array for unknown provider', () => {
    const catalog = new FreeProviderCatalog();
    expect(catalog.getRevisionHistory('nonexistent', 'model')).toEqual([]);
  });
});

describe('FreeProviderCatalog — startVerificationJob', () => {
  it('returns a stoppable job', () => {
    const catalog = new FreeProviderCatalog();
    const job = catalog.startVerificationJob(100000);
    expect(job.intervalMs).toBe(100000);
    expect(typeof job.stop).toBe('function');
    job.stop();
  });

  it('replaces existing job for same target', () => {
    const catalog = new FreeProviderCatalog();
    const job1 = catalog.startVerificationJob(100000, 'groq', 'llama-3.1-70b');
    const job2 = catalog.startVerificationJob(100000, 'groq', 'llama-3.1-70b');
    expect(job1).not.toBe(job2);
    job2.stop();
  });

  it('stops cleanly without errors', () => {
    const catalog = new FreeProviderCatalog();
    const job = catalog.startVerificationJob(100000);
    expect(() => job.stop()).not.toThrow();
  });
});

describe('FreeProviderCatalog — getFreeProviders', () => {
  let catalog: FreeProviderCatalog;

  beforeEach(() => {
    catalog = new FreeProviderCatalog();
    catalog.loadCatalogSync([
      makeRecord({
        providerId: 'groq',
        modelId: 'llama-3.1-70b',
        freeEligibility: 'free_with_limits',
        status: 'active',
        confidence: 0.9,
      }),
      makeRecord({
        providerId: 'gemini',
        modelId: 'gemini-2.0-flash',
        freeEligibility: 'free_with_limits',
        status: 'active',
        confidence: 0.85,
      }),
      makeRecord({
        providerId: 'paid-pro',
        modelId: 'paid-model',
        freeEligibility: 'paid',
        status: 'active',
        confidence: 1.0,
      }),
      makeRecord({
        providerId: 'stale-pro',
        modelId: 'stale-model',
        freeEligibility: 'free_with_limits',
        status: 'stale',
        confidence: 0.9,
      }),
    ]);
  });

  it('returns only eligible providers', () => {
    const results = catalog.getFreeProviders();
    expect(results.length).toBe(2);
    const ids = results.map(r => r.record?.providerId).sort();
    expect(ids).toEqual(['gemini', 'groq']);
  });

  it('respects strictFree policy', () => {
    catalog.loadCatalogSync([
      makeRecord({
        providerId: 'strict-free',
        modelId: 'strict-model',
        freeEligibility: 'free',
        status: 'active',
        confidence: 0.9,
      }),
    ]);
    const results = catalog.getFreeProviders({ strictFree: true });
    expect(results.length).toBe(1);
    expect(results[0].record?.providerId).toBe('strict-free');
  });

  it('respects minConfidence policy', () => {
    const results = catalog.getFreeProviders({ minConfidence: 0.88 });
    expect(results.length).toBe(1);
    expect(results[0].record?.providerId).toBe('groq');
  });

  it('returns empty array when no providers match', () => {
    const results = catalog.getFreeProviders({ minConfidence: 0.99 });
    expect(results).toEqual([]);
  });
});

describe('FreeProviderCatalog — seed data integration', () => {
  it('loads all 8 seed providers', () => {
    const catalog = new FreeProviderCatalog();
    const count = catalog.loadCatalog(SEED_FILE);
    expect(count).toBe(8);
  });

  it('all seed providers are eligible with default policy', () => {
    const catalog = new FreeProviderCatalog();
    catalog.loadCatalog(SEED_FILE);
    const results = catalog.getFreeProviders();
    expect(results.length).toBe(8);
  });

  it('seed providers have valid structure', () => {
    const catalog = new FreeProviderCatalog();
    catalog.loadCatalog(SEED_FILE);
    const records = catalog.getAllRecords();
    for (const rec of records) {
      expect(rec.providerId).toBeTruthy();
      expect(rec.modelId).toBeTruthy();
      expect(rec.endpoint).toBeTruthy();
      expect(rec.plan).toBeTruthy();
      expect(['free', 'free_with_limits', 'paid', 'unknown']).toContain(
        rec.freeEligibility,
      );
      expect(Array.isArray(rec.quotaDimensions)).toBe(true);
      expect(rec.quotaDimensions.length).toBeGreaterThan(0);
      expect(Array.isArray(rec.sourceUrls)).toBe(true);
      expect(rec.sourceUrls.length).toBeGreaterThan(0);
      expect(rec.confidence).toBeGreaterThanOrEqual(0);
      expect(rec.confidence).toBeLessThanOrEqual(1);
      expect(typeof rec.catalogRevision).toBe('number');
    }
  });

  it('observations update seed records', () => {
    const catalog = new FreeProviderCatalog();
    catalog.loadCatalog(SEED_FILE);
    const result = catalog.recordObservation('groq', 'llama-3.1-70b-versatile', {
      remainingRequests: 15,
      limitRequests: 30,
      rateLimitHeaders: { 'x-ratelimit-remaining': '15' },
    });
    expect(result).not.toBeNull();
    expect(result!.status).toBe('observed');
  });
});

describe('DEFAULT_POLICY', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_POLICY.strictFree).toBe(false);
    expect(DEFAULT_POLICY.minConfidence).toBe(0.5);
    expect(DEFAULT_POLICY.maxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});