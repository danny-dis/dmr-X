/**
 * Issue #16 Task 6 — free-only guard: zero paid selections under free_only.
 *
 * The free-provider catalog is authoritative: even if a candidate carries
 * free-looking pricing metadata, a catalog verdict of paid/unknown must veto
 * it. And a paid pricingTier must veto even when the catalog says free.
 */
import { describe, it, expect } from 'vitest';
import { EligibilityEngine } from '../services/router/src/eligibility/eligibility-engine.js';
import { FreeProviderCatalog } from '../services/quota/src/free-provider-catalog.js';
import type { CandidateSet } from '../packages/core/src/index.js';

function candidate(providerId: string, modelId: string, pricingTier: string): any {
  return {
    providerId,
    providerName: providerId,
    modelId,
    modality: 'llm',
    capabilities: [],
    intelligenceLayer: 'executor',
    capabilityTier: 'executor',
    costPerInputToken: pricingTier === 'paid' ? 0.001 : 0,
    costPerOutputToken: pricingTier === 'paid' ? 0.002 : 0,
    costPerImage: 0,
    avgLatencyMs: 1000,
    pricingTier,
    qualityScore: 0.9,
    isHealthy: true,
  };
}

function catalogWith(records: Array<{ providerId: string; modelId: string; freeEligibility: any }>): FreeProviderCatalog {
  const catalog = new FreeProviderCatalog(Date.now());
  catalog.loadCatalogSync(
    records.map((r) => ({
      providerId: r.providerId,
      modelId: r.modelId,
      endpoint: 'https://example.test',
      plan: 'free',
      freeEligibility: r.freeEligibility,
      publishedLimits: {},
      quotaDimensions: [],
      scope: 'key' as const,
      resetSemantics: 'unknown' as const,
      sourceUrls: [],
      sourceVerifiedAt: new Date().toISOString(),
      catalogRevision: 1,
      confidence: 0.95,
      status: 'active' as const,
    })),
  );
  return catalog;
}

describe('free-only guard (catalog authoritative)', () => {
  it('zero paid selections under free_only across a mixed pool', () => {
    const catalog = catalogWith([
      { providerId: 'free-p', modelId: 'm1', freeEligibility: 'free' },
      { providerId: 'limits-p', modelId: 'm2', freeEligibility: 'free_with_limits' },
      { providerId: 'paid-p', modelId: 'm3', freeEligibility: 'paid' },
    ]);
    const engine = new EligibilityEngine({ freeOnly: true }, catalog as any);
    const candidates = [
      candidate('free-p', 'm1', 'free'),
      candidate('limits-p', 'm2', 'free_with_limits'),
      candidate('paid-p', 'm3', 'paid'),
      candidate('ghost-p', 'm4', 'free'), // no catalog record → vetoed
    ] as unknown as CandidateSet;

    const { eligible } = engine.filter(candidates);
    expect(eligible).toHaveLength(2);
    expect(engine.assertNoPaidLeakage(eligible)).toBe(0);
    for (const c of eligible as any[]) {
      expect(c.pricingTier).not.toBe('paid');
    }
  });

  it('catalog paid verdict vetoes free-looking pricing metadata', () => {
    const catalog = catalogWith([
      { providerId: 'sneaky', modelId: 'flagship', freeEligibility: 'paid' },
    ]);
    const engine = new EligibilityEngine({ freeOnly: true }, catalog as any);
    const candidates = [candidate('sneaky', 'flagship', 'free')] as unknown as CandidateSet;
    const { eligible } = engine.filter(candidates);
    expect(eligible).toHaveLength(0);
  });

  it('paid pricingTier vetoes even when catalog says free', () => {
    const catalog = catalogWith([
      { providerId: 'x', modelId: 'y', freeEligibility: 'free' },
    ]);
    const engine = new EligibilityEngine({ freeOnly: true }, catalog as any);
    const candidates = [candidate('x', 'y', 'paid')] as unknown as CandidateSet;
    const { eligible } = engine.filter(candidates);
    expect(eligible).toHaveLength(0);
    expect(engine.assertNoPaidLeakage(eligible)).toBe(0);
  });
});
