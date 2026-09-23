// tests/unit/eligibility-engine.test.ts
import { describe, it, expect } from 'vitest';
import { EligibilityEngine } from '../../services/router/src/eligibility/eligibility-engine.js';
import type { CandidateSet } from '@dmr-x/core';

describe('EligibilityEngine', () => {
  it('rejects paid candidates when free_only is true', () => {
    const engine = new EligibilityEngine({ freeOnly: true });
    const candidates: CandidateSet = [
      { providerId: 'p1', modelId: 'm1', pricingTier: 'free' } as any,
      { providerId: 'p2', modelId: 'm2', pricingTier: 'paid' } as any,
    ];
    const result = engine.filter(candidates);
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0].providerId).toBe('p1');
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('paid');
  });

  it('allows all candidates when free_only is false', () => {
    const engine = new EligibilityEngine({ freeOnly: false });
    const candidates: CandidateSet = [
      { providerId: 'p1', modelId: 'm1', pricingTier: 'free' } as any,
      { providerId: 'p2', modelId: 'm2', pricingTier: 'paid' } as any,
    ];
    const result = engine.filter(candidates);
    expect(result.eligible).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects candidates with unknown free eligibility when strictFree is true', () => {
    const engine = new EligibilityEngine({ freeOnly: true, strictFree: true });
    const candidates: CandidateSet = [
      { providerId: 'p1', modelId: 'm1', pricingTier: 'free' } as any,
      { providerId: 'p2', modelId: 'm2', pricingTier: undefined } as any,
    ];
    const result = engine.filter(candidates);
    expect(result.eligible).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('unknown');
  });
});