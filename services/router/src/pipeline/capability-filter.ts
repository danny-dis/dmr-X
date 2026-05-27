import type { CandidateSet, Modality } from '@dmr-x/core';

export function capabilityFilter(
  candidates: CandidateSet,
  requiredCapabilities: string[],
  modality: Modality
): CandidateSet {
  return candidates.filter((model) => {
    // Must match modality
    if (model.modality !== modality) {
      return false;
    }

    // Must have all required capabilities
    for (const cap of requiredCapabilities) {
      if (!model.capabilities.includes(cap)) {
        return false;
      }
    }

    return true;
  });
}
