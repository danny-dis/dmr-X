"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const final_selector_js_1 = require("../../services/router/src/pipeline/final-selector.js");
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
        compositeScore: 0.8,
        ...overrides,
    };
}
(0, vitest_1.describe)('finalSelector', () => {
    (0, vitest_1.it)('should select top candidate when epsilon is 0', () => {
        const candidates = [
            makeCandidate({ modelId: 'best', compositeScore: 0.9 }),
            makeCandidate({ modelId: 'second', compositeScore: 0.8 }),
            makeCandidate({ modelId: 'third', compositeScore: 0.7 }),
        ];
        const result = (0, final_selector_js_1.finalSelector)(candidates, 0);
        (0, vitest_1.expect)(result.selected.modelId).toBe('best');
        (0, vitest_1.expect)(result.remaining).toHaveLength(2);
    });
    (0, vitest_1.it)('should return remaining candidates excluding selected', () => {
        const candidates = [
            makeCandidate({ modelId: 'a', compositeScore: 0.9 }),
            makeCandidate({ modelId: 'b', compositeScore: 0.8 }),
            makeCandidate({ modelId: 'c', compositeScore: 0.7 }),
        ];
        const result = (0, final_selector_js_1.finalSelector)(candidates, 0);
        (0, vitest_1.expect)(result.remaining.map(c => c.modelId)).toEqual(['b', 'c']);
    });
    (0, vitest_1.it)('should throw on empty candidates', () => {
        (0, vitest_1.expect)(() => (0, final_selector_js_1.finalSelector)([], 0)).toThrow('No candidates available');
    });
    (0, vitest_1.it)('should handle single candidate', () => {
        const candidates = [
            makeCandidate({ modelId: 'only-one' }),
        ];
        const result = (0, final_selector_js_1.finalSelector)(candidates, 0);
        (0, vitest_1.expect)(result.selected.modelId).toBe('only-one');
        (0, vitest_1.expect)(result.remaining).toHaveLength(0);
    });
    (0, vitest_1.it)('should use qualityScore as fallback when compositeScore is undefined', () => {
        const candidates = [
            makeCandidate({ modelId: 'test', qualityScore: 0.85, compositeScore: undefined }),
        ];
        const result = (0, final_selector_js_1.finalSelector)(candidates, 0);
        (0, vitest_1.expect)(result.selected.score).toBe(0.85);
    });
});
//# sourceMappingURL=final-selector.test.js.map