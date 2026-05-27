"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const availability_filter_js_1 = require("../../services/router/src/pipeline/availability-filter.js");
function makeCandidate(overrides = {}) {
    return {
        providerId: 'test-provider',
        providerName: 'test',
        modelId: 'test-model',
        modality: 'llm',
        intelligenceLayer: 'executor',
        capabilities: [],
        costPerInputToken: 0.001,
        costPerOutputToken: 0.002,
        costPerImage: 0,
        avgLatencyMs: 1000,
        qualityScore: 0.8,
        isHealthy: true,
        ...overrides,
    };
}
(0, vitest_1.describe)('availabilityFilter', () => {
    (0, vitest_1.it)('should keep only healthy candidates', () => {
        const candidates = [
            makeCandidate({ modelId: 'healthy-1', isHealthy: true }),
            makeCandidate({ modelId: 'unhealthy', isHealthy: false }),
            makeCandidate({ modelId: 'healthy-2', isHealthy: true }),
        ];
        const result = (0, availability_filter_js_1.availabilityFilter)(candidates);
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result.map(c => c.modelId)).toEqual(['healthy-1', 'healthy-2']);
    });
    (0, vitest_1.it)('should return empty if all candidates are unhealthy', () => {
        const candidates = [
            makeCandidate({ isHealthy: false }),
            makeCandidate({ isHealthy: false }),
        ];
        const result = (0, availability_filter_js_1.availabilityFilter)(candidates);
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
    (0, vitest_1.it)('should return all if all are healthy', () => {
        const candidates = [
            makeCandidate({ isHealthy: true }),
            makeCandidate({ isHealthy: true }),
        ];
        const result = (0, availability_filter_js_1.availabilityFilter)(candidates);
        (0, vitest_1.expect)(result).toHaveLength(2);
    });
    (0, vitest_1.it)('should handle empty input', () => {
        const result = (0, availability_filter_js_1.availabilityFilter)([]);
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
});
//# sourceMappingURL=availability-filter.test.js.map