export function capabilityFilter(candidates, requiredCapabilities, modality) {
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
//# sourceMappingURL=capability-filter.js.map