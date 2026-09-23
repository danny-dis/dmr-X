// services/router/src/eligibility/eligibility-engine.ts
import type { CandidateSet, ProviderModel } from '@dmr-x/core';

export interface EligibilityConfig {
  freeOnly: boolean;
  strictFree?: boolean;
  minConfidence?: number;
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
  constructor(private config: EligibilityConfig) {}

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

    return { eligible, rejected };
  }

  private checkCandidate(candidate: ProviderModel): string | null {
    if (!this.config.freeOnly) return null;

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