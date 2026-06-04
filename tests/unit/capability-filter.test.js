"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const capability_filter_js_1 = require("../../services/router/src/pipeline/capability-filter.js");
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
(0, vitest_1.describe)('capabilityFilter', () => {
    (0, vitest_1.it)('should filter by modality', () => {
        const candidates = [
            makeCandidate({ modality: 'llm', modelId: 'llm-model' }),
            makeCandidate({ modality: 'diffusion', modelId: 'diffusion-model' }),
            makeCandidate({ modality: 'embedding', modelId: 'embedding-model' }),
        ];
        const result = (0, capability_filter_js_1.capabilityFilter)(candidates, [], 'llm');
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].modelId).toBe('llm-model');
    });
    (0, vitest_1.it)('should filter by required capabilities', () => {
        const candidates = [
            makeCandidate({ modelId: 'no-vision', capabilities: [] }),
            makeCandidate({ modelId: 'with-vision', capabilities: ['vision'] }),
            makeCandidate({ modelId: 'with-vision-tools', capabilities: ['vision', 'tool_use'] }),
        ];
        const result = (0, capability_filter_js_1.capabilityFilter)(candidates, ['vision'], 'llm');
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result.map(c => c.modelId)).toEqual(['with-vision', 'with-vision-tools']);
    });
    (0, vitest_1.it)('should filter by multiple capabilities', () => {
        const candidates = [
            makeCandidate({ modelId: 'vision-only', capabilities: ['vision'] }),
            makeCandidate({ modelId: 'vision-tools', capabilities: ['vision', 'tool_use'] }),
            makeCandidate({ modelId: 'all', capabilities: ['vision', 'tool_use', 'json_mode'] }),
        ];
        const result = (0, capability_filter_js_1.capabilityFilter)(candidates, ['vision', 'tool_use'], 'llm');
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result.map(c => c.modelId)).toEqual(['vision-tools', 'all']);
    });
    (0, vitest_1.it)('should return empty if no candidates match modality', () => {
        const candidates = [
            makeCandidate({ modality: 'diffusion' }),
        ];
        const result = (0, capability_filter_js_1.capabilityFilter)(candidates, [], 'llm');
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
    (0, vitest_1.it)('should return empty if no candidates have required capabilities', () => {
        const candidates = [
            makeCandidate({ capabilities: [] }),
        ];
        const result = (0, capability_filter_js_1.capabilityFilter)(candidates, ['vision'], 'llm');
        (0, vitest_1.expect)(result).toHaveLength(0);
    });
    (0, vitest_1.it)('should pass all candidates when no capabilities required', () => {
        const candidates = [
            makeCandidate({ modelId: 'a' }),
            makeCandidate({ modelId: 'b' }),
            makeCandidate({ modelId: 'c' }),
        ];
        const result = (0, capability_filter_js_1.capabilityFilter)(candidates, [], 'llm');
        (0, vitest_1.expect)(result).toHaveLength(3);
    });
});
//# sourceMappingURL=capability-filter.test.js.map