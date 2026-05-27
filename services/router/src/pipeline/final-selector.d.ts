import type { CandidateSet, SelectedProvider } from '@dmr-x/core';
export interface SelectorOutput {
    selected: SelectedProvider;
    remaining: CandidateSet;
}
export declare function finalSelector(candidates: CandidateSet, epsilon: number): SelectorOutput;
//# sourceMappingURL=final-selector.d.ts.map