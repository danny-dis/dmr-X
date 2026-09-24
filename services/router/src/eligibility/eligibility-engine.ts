// services/router/src/eligibility/eligibility-engine.ts
import type { CandidateSet, ProviderModel } from '@dmr-x/core';

export interface EligibilityConfig {
  freeOnly: boolean;
  strictFree?: boolean;
  minConfidence?: number;
}

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
  private onViolation?: (count: number) => void;

  constructor(
    private config: EligibilityConfig,
    catalog?: FreeEligibilityCatalog,
    onViolation?: (count: number) => void,
  ) {
    if (catalog) this.catalog = catalog;
    if (onViolation) this.onViolation = onViolation;
  }

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

    if (this.config.freeOnly) {
      for (let i = eligible.length - 1; i >= 0; i--) {
        if ((eligible[i] as ProviderModel).pricingTier === 'paid') {
          const leaked = eligible.splice(i, 1) as ProviderModel[];
          rejected.push({
            providerId: leaked[0].providerId,
            modelId: leaked[0].modelId,
            reason: 'Free-only violation blocked: paid-tier candidate reached eligible set',
          });
          try {
            this.onViolation?.(1);
          } catch {
            // Metrics must never break routing.
          }
        }
      }
    }

    return { eligible, rejected };
  }

  assertNoPaidLeakage(eligible: CandidateSet): number {
    if (!this.config.freeOnly) return 0;
    return eligible.filter((c) => (c as ProviderModel).pricingTier === 'paid').length;
  }

  private checkCandidate(candidate: ProviderModel): string | null {
    if (!this.config.freeOnly) return null;

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
      if (candidate.pricingTier === 'paid') {
        return 'Candidate is paid-tier; free_only requires free eligibility';
      }
      return null;
    }

    const tier = candidate.pricingTier;
    const hasFreeMetadata = candidate.freeTierMetadata != null;
    const hasZeroCost = (candidate.costPerInputToken ?? 0) === 0 && (candidate.costPerOutputToken ?? 0) === 0;

    if (tier === 'free') return null;
    if (tier === 'paid') return 'Candidate is paid-tier; free_only requires free eligibility';
    if (hasFreeMetadata && !this.config.strictFree) return null;
    if (hasZeroCost) return null;

    if (this.config.strictFree) {
      return 'Candidate free eligibility unknown; strictFree requires known free status';
    }

    return 'Candidate is paid-tier; free_only requires free eligibility';
  }
}
