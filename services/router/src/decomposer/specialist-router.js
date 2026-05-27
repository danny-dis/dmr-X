import { KNOWN_MODEL_SPECIALIZATIONS, getCostMultiplier, getLatencyWeight, } from '@dmr-x/core';
/**
 * Routes a sub-task to the best specialist model
 */
export class SpecialistRouter {
    specializationProfiles = new Map();
    constructor() {
        // Load known model specializations
        for (const [modelId, profile] of Object.entries(KNOWN_MODEL_SPECIALIZATIONS)) {
            this.specializationProfiles.set(modelId, {
                modelId,
                providerId: 'unknown',
                strengths: profile.strengths || {},
                recommendedFor: profile.recommendedFor || [],
                costTier: profile.costTier || 'standard',
                speedTier: profile.speedTier || 'standard',
            });
        }
    }
    /**
     * Add a custom specialization profile
     */
    addProfile(profile) {
        this.specializationProfiles.set(profile.modelId, profile);
    }
    /**
     * Route a sub-task to the best model from candidates
     */
    routeSubTask(subTask, candidates, qualityTarget = 'balanced') {
        if (candidates.length === 0)
            return null;
        // Score each candidate for this sub-task
        const scored = candidates.map((candidate) => ({
            candidate,
            score: this.scoreCandidate(candidate, subTask, qualityTarget),
        }));
        // Sort by score (highest first)
        scored.sort((a, b) => b.score - a.score);
        return scored[0].candidate;
    }
    /**
     * Route all sub-tasks to their best models
     */
    routeAllSubTasks(subTasks, candidates, qualityTarget = 'balanced') {
        const assignments = new Map();
        // Sort sub-tasks by priority (highest first)
        const sorted = [...subTasks].sort((a, b) => b.priority - a.priority);
        for (const subTask of sorted) {
            // Filter candidates by modality
            const modalityCandidates = candidates.filter((c) => c.modality === subTask.modality);
            // Filter by required capabilities (if any)
            const capableCandidates = modalityCandidates.filter((c) => subTask.specializations.every((spec) => {
                // Check if candidate has matching capability or specialization
                return c.capabilities.includes(spec) || c.capabilities.includes('general');
            }));
            // Route to best specialist
            const best = this.routeSubTask(subTask, capableCandidates.length > 0 ? capableCandidates : modalityCandidates, qualityTarget);
            if (best) {
                assignments.set(subTask.id, best);
            }
        }
        return assignments;
    }
    /**
     * Score a candidate for a specific sub-task
     */
    scoreCandidate(candidate, subTask, qualityTarget) {
        // Base quality score
        let score = candidate.qualityScore * 0.3;
        // Specialization match score
        const specScore = this.calculateSpecializationScore(candidate, subTask.specializations);
        score += specScore * 0.4;
        // Cost score (based on quality target)
        const costScore = this.calculateCostScore(candidate, qualityTarget);
        score += costScore * 0.15;
        // Latency score
        const latencyScore = this.calculateLatencyScore(candidate);
        score += latencyScore * 0.1;
        // Health bonus
        if (candidate.isHealthy) {
            score += 0.05;
        }
        return score;
    }
    /**
     * Calculate how well a candidate matches the required specializations
     */
    calculateSpecializationScore(candidate, specializations) {
        if (specializations.length === 0)
            return 0.5;
        const profile = this.specializationProfiles.get(candidate.modelId);
        if (!profile) {
            // Unknown model, check capabilities
            const matchingCaps = specializations.filter((spec) => candidate.capabilities.includes(spec));
            return matchingCaps.length / specializations.length;
        }
        // Average strength across required specializations
        let totalStrength = 0;
        for (const spec of specializations) {
            const strength = profile.strengths[spec] || 0;
            totalStrength += strength;
        }
        return totalStrength / specializations.length;
    }
    /**
     * Calculate cost score (higher = cheaper)
     */
    calculateCostScore(candidate, qualityTarget) {
        const profile = this.specializationProfiles.get(candidate.modelId);
        const costMultiplier = profile ? getCostMultiplier(profile.costTier) : 0.5;
        // For economy, cheap is better
        if (qualityTarget === 'economy') {
            return 1 - costMultiplier;
        }
        // For frontier, cost doesn't matter as much
        if (qualityTarget === 'frontier') {
            return 0.5;
        }
        // Balanced: moderate preference for cheaper
        return 0.7 - costMultiplier * 0.5;
    }
    /**
     * Calculate latency score (higher = faster)
     */
    calculateLatencyScore(candidate) {
        const profile = this.specializationProfiles.get(candidate.modelId);
        if (profile) {
            return getLatencyWeight(profile.speedTier);
        }
        // Fallback: use avgLatencyMs
        if (candidate.avgLatencyMs) {
            return Math.max(0, 1 - candidate.avgLatencyMs / 10000);
        }
        return 0.5;
    }
}
//# sourceMappingURL=specialist-router.js.map