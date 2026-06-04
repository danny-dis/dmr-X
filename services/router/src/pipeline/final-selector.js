export function finalSelector(candidates, epsilon, qualityTarget, thompsonSampler) {
    if (candidates.length === 0) {
        throw new Error('No candidates available for selection');
    }
    // Check if all candidates are free models
    const allFree = candidates.every(c => c.costPerInputToken === 0 && c.costPerOutputToken === 0);
    let selectedModel;
    // Use Thompson sampling for free models when sampler is available
    if (allFree && thompsonSampler && qualityTarget) {
        selectedModel = thompsonSampler.select(candidates, qualityTarget);
    }
    else {
        // Epsilon-greedy: with probability epsilon, explore top-3 instead of always picking top-1
        let selectedIndex = 0;
        if (Math.random() < epsilon && candidates.length > 1) {
            // Uniformly pick from top-3 (not biased toward index 0)
            const explorePool = Math.min(3, candidates.length);
            selectedIndex = Math.floor(Math.random() * explorePool);
        }
        selectedModel = candidates[selectedIndex];
    }
    const remaining = candidates.filter(c => c !== selectedModel);
    return {
        selected: {
            providerId: selectedModel.providerId,
            modelId: selectedModel.modelId,
            adapterType: selectedModel.providerName,
            score: selectedModel.compositeScore ?? selectedModel.qualityScore,
        },
        remaining,
    };
}
//# sourceMappingURL=final-selector.js.map