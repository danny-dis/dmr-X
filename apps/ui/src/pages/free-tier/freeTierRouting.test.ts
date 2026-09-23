import { describe, expect, it } from 'vitest';

import {
  computeTrafficDistribution,
  predictExhaustionDays,
  resolveFallbackPath,
  resolvePaidFallback,
} from './FreeTierPage';

import type { LiveUsage } from '@/lib/queries/usage';

function live(freeRequests: number, paidRequests: number): LiveUsage {
  return {
    window: '24h',
    windowStart: new Date(0).toISOString(),
    free: { tokens: freeRequests * 100, requests: freeRequests },
    paid: { tokens: paidRequests * 100, requests: paidRequests, costUsd: paidRequests * 0.01 },
    costAvoidedUsd: 0,
    savingsBasis: { method: 'test', referenceModels: [], warning: null },
  };
}

describe('computeTrafficDistribution', () => {
  it('derives the free share from real request telemetry (80 free / 20 paid -> 80%)', () => {
    const dist = computeTrafficDistribution(live(80, 20));
    expect(dist).not.toBeNull();
    expect(dist!.free).toBe(80);
    expect(dist!.nonFreeOrUnclassified).toBe(20);
    expect(dist!.freePercent).toBeCloseTo(80, 5);
  });

  it('treats the gateway paid bucket as non-free or unclassified traffic', () => {
    const dist = computeTrafficDistribution(live(8, 12));
    expect(dist!.nonFreeOrUnclassified).toBe(12);
  });

  it('returns null when telemetry is unavailable instead of fabricating a split', () => {
    expect(computeTrafficDistribution(null)).toBeNull();
    expect(computeTrafficDistribution(undefined)).toBeNull();
  });

  it('returns null when no requests flowed instead of showing 0%/100% as traffic', () => {
    expect(computeTrafficDistribution(live(0, 0))).toBeNull();
  });

  it('never derives a traffic share from model counts', () => {
    // A summary-shaped object carrying total_free_models is NOT request
    // telemetry — the helper must refuse it rather than render it as %.
    const modelCountShape = {
      total_free_models: 5,
      total_monthly_budget: 1_000,
    } as unknown as LiveUsage;
    expect(computeTrafficDistribution(modelCountShape)).toBeNull();
  });
});

describe('predictExhaustionDays', () => {
  it('returns null when this view lacks the per-key consumption and reset data needed for a forecast', () => {
    expect(
      predictExhaustionDays({ total_monthly_budget: 1_000_000, monthly_token_budget: 1_000_000 }),
    ).toBeNull();
    expect(predictExhaustionDays(null)).toBeNull();
  });
});

describe('resolvePaidFallback', () => {
  it('never claims policy permits paid fallback — tier presence is not policy', () => {
    // Review finding (3): no endpoint this page reads exposes a routing
    // policy field. A paid/mixed tier proves a key exists, not that
    // policy allows paid fallback — availability must stay unknown.
    expect(resolvePaidFallback([{ tier: 'paid' }]).available).toBeNull();
    expect(resolvePaidFallback([{ tier: 'mixed' }]).available).toBeNull();
    expect(resolvePaidFallback([{ tier: 'free' }]).available).toBeNull();
    expect(resolvePaidFallback([]).available).toBeNull();
    expect(resolvePaidFallback(null).available).toBeNull();
    expect(resolvePaidFallback(undefined).available).toBeNull();
  });

  it('still reports paid-tier inventory as a fact without asserting policy', () => {
    expect(resolvePaidFallback([{ tier: 'paid' }]).paidTierConfigured).toBe(true);
    expect(resolvePaidFallback([{ tier: 'mixed' }]).paidTierConfigured).toBe(true);
    expect(resolvePaidFallback([{ tier: 'free' }]).paidTierConfigured).toBe(false);
    expect(resolvePaidFallback([]).paidTierConfigured).toBe(false);
    expect(resolvePaidFallback(null).paidTierConfigured).toBe(false);
  });
});

describe('resolveFallbackPath', () => {
  it('marks free-first ordering unknown — never asserted as an always-on path', () => {
    const step = resolveFallbackPath(null).steps.find((s) => s.id === 'free_first');
    expect(step).toBeDefined();
    expect(step!.status).toBe('unknown');
  });

  it('marks rate-limit retry unknown — no live rate-limit state or window-reset cadence', () => {
    const step = resolveFallbackPath(null).steps.find((s) => s.id === 'rate_limit_retry');
    expect(step).toBeDefined();
    expect(step!.status).toBe('unknown');
  });

  it('marks paid fallback unknown even when a paid/mixed provider is configured', () => {
    const path = resolveFallbackPath([{ tier: 'paid' }, { tier: 'mixed' }]);
    const step = path.steps.find((s) => s.id === 'paid_fallback');
    expect(step).toBeDefined();
    expect(step!.status).toBe('unknown');
    expect(path.policyDataAvailable).toBe(false);
  });

  it('marks budget reset unknown — no per-provider reset cadence on the wire', () => {
    const step = resolveFallbackPath([{ tier: 'free' }]).steps.find(
      (s) => s.id === 'budget_reset',
    );
    expect(step).toBeDefined();
    expect(step!.status).toBe('unknown');
  });

  it('every step is unknown while no policy/rate-limit/quota data is typed', () => {
    for (const providers of [null, [], [{ tier: 'paid' }], [{ tier: 'free' }]]) {
      const path = resolveFallbackPath(providers);
      expect(path.steps.map((s) => s.id).sort()).toEqual([
        'budget_reset',
        'free_first',
        'paid_fallback',
        'rate_limit_retry',
      ]);
      expect(path.steps.every((s) => s.status === 'unknown')).toBe(true);
      expect(path.policyDataAvailable).toBe(false);
    }
  });
});
