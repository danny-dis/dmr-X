import { describe, expect, it } from 'vitest';

import { computeProviderStatusCounts } from './Providers';

import type { ApiProvider } from '@/types/api';

function provider(partial: Partial<ApiProvider> & { id: string; name: string }): ApiProvider {
  return { modality: undefined, ...partial } as unknown as ApiProvider;
}

describe('computeProviderStatusCounts', () => {
  it('does not crash when consecutiveFailures is null', () => {
    const list = [
      provider({ id: 'a', name: 'a', status: 'healthy', consecutiveFailures: null }),
    ];
    expect(() => computeProviderStatusCounts(list)).not.toThrow();
  });

  it('never fabricates a rate-limited count from null/undefined consecutiveFailures', () => {
    // No rate-limit field exists on the providers wire. Absent data must
    // render as unknown (null → N/A), not as a fabricated 0.
    const withNull = [provider({ id: 'a', name: 'a', status: 'healthy', consecutiveFailures: null })];
    const withUndefined = [provider({ id: 'a', name: 'a', status: 'healthy' })];
    expect(computeProviderStatusCounts(withNull).rateLimited).toBeNull();
    expect(computeProviderStatusCounts(withUndefined).rateLimited).toBeNull();
  });

  it('does NOT report consecutiveFailures > 0 as rate-limited', () => {
    // Review finding (1): consecutiveFailures counts upstream failures
    // (timeouts, 5xx), not 429s. It must never feed a "Rate limited" KPI.
    const list = [
      provider({ id: 'a', name: 'a', status: 'healthy', consecutiveFailures: 3 }),
      provider({ id: 'b', name: 'b', status: 'healthy', consecutiveFailures: 0 }),
    ];
    expect(computeProviderStatusCounts(list).rateLimited).toBeNull();
  });

  it('does NOT report tier inactive as quota exhausted', () => {
    // Review finding (2): tier 'inactive' means "no active keys attached"
    // (see ProviderTier docs) — it is not evidence of quota exhaustion.
    const list = [
      provider({ id: 'a', name: 'a', status: 'healthy', tier: 'inactive' }),
      provider({ id: 'b', name: 'b', status: 'healthy', tier: 'paid' }),
      provider({ id: 'c', name: 'c', status: 'healthy', tier: 'free' }),
    ];
    expect(computeProviderStatusCounts(list).quotaExhausted).toBeNull();
  });

  it('buckets healthy / degraded / unavailable statuses from the typed wire status', () => {
    const list = [
      provider({ id: 'a', name: 'a', status: 'healthy' }),
      provider({ id: 'b', name: 'b', status: 'online' }),
      provider({ id: 'c', name: 'c', status: 'degraded' }),
      provider({ id: 'd', name: 'd', status: 'unavailable' }),
      provider({ id: 'e', name: 'e', status: 'offline' }),
    ];
    const counts = computeProviderStatusCounts(list);
    expect(counts.configured).toBe(5);
    expect(counts.healthy).toBe(2);
    expect(counts.degraded).toBe(1);
    expect(counts.unavailable).toBe(2);
  });

  it('returns unknown counts while the provider query has no data', () => {
    const counts = computeProviderStatusCounts(undefined);
    expect(counts.configured).toBeNull();
    expect(counts.healthy).toBeNull();
    expect(counts.degraded).toBeNull();
    expect(counts.unavailable).toBeNull();
  });

  it('returns actual zero counts after an empty successful response', () => {
    const counts = computeProviderStatusCounts([]);
    expect(counts.configured).toBe(0);
    expect(counts.healthy).toBe(0);
    expect(counts.unavailable).toBe(0);
  });
});
