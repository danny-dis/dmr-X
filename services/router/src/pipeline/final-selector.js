export function finalSelector(candidates, epsilon) {
    if (candidates.length === 0) {
        throw new Error('No candidates available for selection');
    }
    // Epsilon-greedy: with probability epsilon, explore top-3 instead of always picking top-1
    let selectedIndex = 0;
    if (Math.random() < epsilon && candidates.length > 1) {
        selectedIndex = Math.floor(Math.random() * Math.min(3, candidates.length));
    }
    const selected = candidates[selectedIndex];
    const remaining = candidates.filter((_, i) => i !== selectedIndex);
    return {
        selected: {
            providerId: selected.providerId,
            modelId: selected.modelId,
            adapterType: selected.providerName,
            score: selected.compositeScore ?? selected.qualityScore,
        },
        remaining,
    };
}
//# sourceMappingURL=final-selector.js.map