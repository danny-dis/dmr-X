import type { CandidateSet } from '@dmr-x/core';

export function availabilityFilter(candidates: CandidateSet): CandidateSet {
  return candidates.filter((model) => model.isHealthy);
}
