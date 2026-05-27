import type { CandidateSet, ProviderModel } from '@dmr-x/core';
import type { SpecializationProfile } from '@dmr-x/core';
import type { SubTask } from './task-decomposer.js';
/**
 * Routes a sub-task to the best specialist model
 */
export declare class SpecialistRouter {
    private specializationProfiles;
    constructor();
    /**
     * Add a custom specialization profile
     */
    addProfile(profile: SpecializationProfile): void;
    /**
     * Route a sub-task to the best model from candidates
     */
    routeSubTask(subTask: SubTask, candidates: CandidateSet, qualityTarget?: 'frontier' | 'balanced' | 'economy'): ProviderModel | null;
    /**
     * Route all sub-tasks to their best models
     */
    routeAllSubTasks(subTasks: SubTask[], candidates: CandidateSet, qualityTarget?: 'frontier' | 'balanced' | 'economy'): Map<string, ProviderModel>;
    /**
     * Score a candidate for a specific sub-task
     */
    private scoreCandidate;
    /**
     * Calculate how well a candidate matches the required specializations
     */
    private calculateSpecializationScore;
    /**
     * Calculate cost score (higher = cheaper)
     */
    private calculateCostScore;
    /**
     * Calculate latency score (higher = faster)
     */
    private calculateLatencyScore;
}
//# sourceMappingURL=specialist-router.d.ts.map