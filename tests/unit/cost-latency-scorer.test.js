"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const cost_latency_scorer_js_1 = require("../../services/router/src/pipeline/cost-latency-scorer.js");
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
(0, vitest_1.describe)('costLatencyScorer', () => {
    (0, vitest_1.it)('should score and sort candidates by composite score', () => {
        const candidates = [
            makeCandidate({ modelId: 'cheap', qualityScore: 0.5, costPerInputToken: 0.001, avgLatencyMs: 500 }),
            makeCandidate({ modelId: 'expensive', qualityScore: 0.9, costPerInputToken: 0.01, avgLatencyMs: 2000 }),
            makeCandidate({ modelId: 'balanced', qualityScore: 0.7, costPerInputToken: 0.005, avgLatencyMs: 1000 }),
        ];
        const result = (0, cost_latency_scorer_js_1.costLatencyScorer)(candidates, 'balanced');
        (0, vitest_1.expect)(result).toHaveLength(3);
        // Should be sorted by composite score (highest first)
        (0, vitest_1.expect)(result[0].compositeScore).toBeGreaterThanOrEqual(result[1].compositeScore);
        (0, vitest_1.expect)(result[1].compositeScore).toBeGreaterThanOrEqual(result[2].compositeScore);
    });
    (0, vitest_1.it)('should prioritize quality for frontier target', () => {
        const candidates = [
            makeCandidate({ modelId: 'high-quality', qualityScore: 0.95, costPerInputToken: 0.01, avgLatencyMs: 2000 }),
            makeCandidate({ modelId: 'cheap-fast', qualityScore: 0.6, costPerInputToken: 0.001, avgLatencyMs: 500 }),
        ];
        const result = (0, cost_latency_scorer_js_1.costLatencyScorer)(candidates, 'frontier');
        (0, vitest_1.expect)(result[0].modelId).toBe('high-quality');
    });
    (0, vitest_1.it)('should prioritize cost for economy target', () => {
        const candidates = [
            makeCandidate({ modelId: 'high-quality', qualityScore: 0.95, costPerInputToken: 0.01, avgLatencyMs: 2000 }),
            makeCandidate({ modelId: 'cheap-fast', qualityScore: 0.6, costPerInputToken: 0.001, avgLatencyMs: 500 }),
        ];
        const result = (0, cost_latency_scorer_js_1.costLatencyScorer)(candidates, 'economy');
        (0, vitest_1.expect)(result[0].modelId).toBe('cheap-fast');
    });
    (0, vitest_1.it)('should handle single candidate', () => {
        const candidates = [
            makeCandidate({ modelId: 'only-one' }),
        ];
        const result = (0, cost_latency_scorer_js_1.costLatencyScorer)(candidates, 'balanced');
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].compositeScore).toBeDefined();
    });
    (0, vitest_1.it)('should handle diffusion models with costPerImage', () => {
        const candidates = [
            makeCandidate({
                modelId: 'diffusion-a',
                modality: 'diffusion',
                costPerInputToken: 0,
                costPerImage: 0.02,
                qualityScore: 0.8,
            }),
            makeCandidate({
                modelId: 'diffusion-b',
                modality: 'diffusion',
                costPerInputToken: 0,
                costPerImage: 0.05,
                qualityScore: 0.9,
            }),
        ];
        const result = (0, cost_latency_scorer_js_1.costLatencyScorer)(candidates, 'balanced');
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result[0].compositeScore).toBeDefined();
    });
});
//# sourceMappingURL=cost-latency-scorer.test.js.map