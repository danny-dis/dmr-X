// services/router/src/eligibility/eligibility-engine.ts
import type { CandidateSet, ProviderModel } from '@dmr-x/core';
import { incFreeOnlyViolations } from '../../../quota/src/free-inference-metrics.js';

export interface EligibilityConfig {
  freeOnly: boolean;
  strictFree?: boolean;
  minConfidence?: number;
}

/**
 * Structural catalog contract (Issue #16 Task 6). Uses structural typing —
 * not a direct import of `@dmr-x/quota` — so the router does not create a
 * runtime cycle with the quota package. Any object exposing
 * `checkEligibility(providerId, modelId, policy)` (e.g. FreeProviderCatalog)
 * can be attached via constructor or `setCatalog()`.
 */
export interface FreeEligibilityCatalog {
  checkEligibility(
    providerId: string,
    modelId: string,
    policy?: { strictFree?: boolean; minConfidence?: number },
  ): { eligible: boolean; reason: string };
}

export interface RejectionReason {
  providerId: string;
  modelId: string;
  reason: string;
}

export interface EligibilityResult {
  eligible: CandidateSet;
  rejected: RejectionReason[];
}

export class EligibilityEngine {
  private catalog: FreeEligibilityCatalog | null = null;

  constructor(
    private config: EligibilityConfig,
    catalog?: FreeEligibilityCatalog,
  ) {
    if (catalog) this.catalog = catalog;
  }

  /** Attach (or replace) the authoritative free-provider catalog. */
  setCatalog(catalog: FreeEligibilityCatalog | null): void {
    this.catalog = catalog;
  }

  filter(candidates: CandidateSet): EligibilityResult {
    const eligible: CandidateSet = [];
    const rejected: RejectionReason[] = [];

    for (const candidate of candidates) {
      const reason = this.checkCandidate(candidate);
      if (reason) {
        rejected.push({
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          reason,
        });
      } else {
        eligible.push(candidate);
      }
    }

    // Defense-in-depth (Issue #16 Task 6/7): under free_only, a paid-tier
    // candidate in the eligible set is a violation — it must be impossible.
    // Count it (metric must stay zero) and strip it rather than leaking.
    if (this.config.freeOnly) {
      for (let i = eligible.length - 1; i >= 0; i--) {
        if ((eligible[i] as ProviderModel).pricingTier === 'paid') {
          const leaked = eligible.splice(i, 1)[0] as ProviderModel;
          rejected.push({
            providerId: leaked.providerId,
            modelId: leaked.modelId,
            reason: 'Free-only violation blocked: paid-tier candidate reached eligible set',
          });
          try {
            incFreeOnlyViolations(1);
          } catch {
            // Metrics must never break routing.
          }
        }
      }
    }

    return { eligible, rejected };
  }

  /**
   * Assert zero paid selections under free_only. Returns the count of paid
   * candidates in `eligible` (expected 0). Used by tests and audits.
   */
  assertNoPaidLeakage(eligible: CandidateSet): number {
    if (!this.config.freeOnly) return 0;
    return eligible.filter((c) => (c as ProviderModel).pricingTier === 'paid').length;
  }

  private checkCandidate(candidate: ProviderModel): string | null {
    if (!this.config.freeOnly) return null;

    // Catalog is authoritative when attached (Issue #16 Task 6): a candidate
    // is eligible under free_only ONLY if the catalog says so. This closes
    // the gap where pricingTier/freeTierMetadata alone could elect a paid
    // model the catalog knows is paid (or unknown).
    if (this.catalog) {
      let verdict: { eligible: boolean; reason: string };
      try {
        verdict = this.catalog.checkEligibility(candidate.providerId, candidate.modelId, {
          strictFree: this.config.strictFree,
          minConfidence: this.config.minConfidence,
        });
      } catch {
        return 'Free-provider catalog unavailable; failing closed for free_only';
      }
      if (!verdict.eligible) {
        return `Free-provider catalog rejects ${candidate.providerId}/${candidate.modelId}: ${verdict.reason}`;
      }
      // Catalog says free — paid pricingTier still vetoes (both must agree).
      if (candidate.pricingTier === 'paid') {
        return 'Candidate is paid-tier; free_only requires free eligibility';
      }
      return null;
    }

    const tier = candidate.pricingTier;
    const hasFreeMetadata = candidate.freeTierMetadata != null;
    const hasZeroCost = (candidate.costPerInputToken ?? 0) === 0 &&
                        (candidate.costPerOutputToken ?? 0) === 0;

    // Explicitly paid
    if (tier === 'paid') {
      return 'Candidate is paid-tier; free_only requires free eligibility';
    }

    // Explicitly free
    if (tier === 'free' || tier === 'free_with_limits' || hasFreeMetadata) {
      return null;
    }

    // Zero cost but no explicit tier
    if (hasZeroCost && !this.config.strictFree) {
      return null;
    }

    // Unknown eligibility
    if (this.config.strictFree && !tier && !hasFreeMetadata) {
      return 'Candidate has unknown free eligibility; strictFree requires explicit free tier';
    }

    return null;
  }
}