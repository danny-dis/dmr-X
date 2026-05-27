"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pipeline_js_1 = require("../../services/router/src/pipeline/pipeline.js");
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
function makeTaskProfile(overrides = {}) {
    return {
        modality: 'llm',
        capabilities: [],
        sizeEstimate: { inputTokens: 100, outputTokensEst: 500 },
        priority: 5,
        streaming: false,
        qualityTarget: 'balanced',
        ...overrides,
    };
}
(0, vitest_1.describe)('pipeline', () => {
    (0, vitest_1.it)('should run full pipeline and select best candidate', async () => {
        const candidates = [
            makeCandidate({ modelId: 'good', qualityScore: 0.9, costPerInputToken: 0.002, avgLatencyMs: 800 }),
            makeCandidate({ modelId: 'medium', qualityScore: 0.7, costPerInputToken: 0.001, avgLatencyMs: 1200 }),
            makeCandidate({ modelId: 'low', qualityScore: 0.5, costPerInputToken: 0.0005, avgLatencyMs: 2000 }),
        ];
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile(),
            candidates,
            epsilon: 0, // No exploration for deterministic test
        });
        (0, vitest_1.expect)(result.selected).toBeDefined();
        (0, vitest_1.expect)(result.chain).toBeDefined();
        (0, vitest_1.expect)(result.scoredCandidates).toHaveLength(3);
    });
    (0, vitest_1.it)('should filter out unhealthy candidates', async () => {
        const candidates = [
            makeCandidate({ modelId: 'healthy', isHealthy: true, qualityScore: 0.7 }),
            makeCandidate({ modelId: 'unhealthy', isHealthy: false, qualityScore: 0.9 }),
        ];
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile(),
            candidates,
            epsilon: 0,
        });
        (0, vitest_1.expect)(result.selected.modelId).toBe('healthy');
    });
    (0, vitest_1.it)('should filter by modality', async () => {
        const candidates = [
            makeCandidate({ modelId: 'llm', modality: 'llm' }),
            makeCandidate({ modelId: 'diffusion', modality: 'diffusion' }),
        ];
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile({ modality: 'llm' }),
            candidates,
            epsilon: 0,
        });
        (0, vitest_1.expect)(result.selected.modelId).toBe('llm');
    });
    (0, vitest_1.it)('should filter by required capabilities', async () => {
        const candidates = [
            makeCandidate({ modelId: 'no-vision', capabilities: [] }),
            makeCandidate({ modelId: 'with-vision', capabilities: ['vision'] }),
        ];
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile({ capabilities: ['vision'] }),
            candidates,
            epsilon: 0,
        });
        (0, vitest_1.expect)(result.selected.modelId).toBe('with-vision');
    });
    (0, vitest_1.it)('should throw when no candidates survive filtering', async () => {
        const candidates = [
            makeCandidate({ modality: 'diffusion' }),
        ];
        await (0, vitest_1.expect)(() => (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile({ modality: 'llm' }),
            candidates,
            epsilon: 0,
        })).rejects.toThrow('No available providers');
    });
    (0, vitest_1.it)('should build fallback chain from remaining candidates', async () => {
        const candidates = [
            makeCandidate({ modelId: 'first', qualityScore: 0.9 }),
            makeCandidate({ modelId: 'second', qualityScore: 0.8 }),
            makeCandidate({ modelId: 'third', qualityScore: 0.7 }),
        ];
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile(),
            candidates,
            epsilon: 0,
        });
        (0, vitest_1.expect)(result.chain).toHaveLength(2);
        (0, vitest_1.expect)(result.chain[0].provider.modelId).toBe('second');
        (0, vitest_1.expect)(result.chain[1].provider.modelId).toBe('third');
    });
    (0, vitest_1.it)('should handle single candidate', async () => {
        const candidates = [
            makeCandidate({ modelId: 'only-one' }),
        ];
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile(),
            candidates,
            epsilon: 0,
        });
        (0, vitest_1.expect)(result.selected.modelId).toBe('only-one');
        (0, vitest_1.expect)(result.chain).toHaveLength(0);
    });
});
(0, vitest_1.describe)('free-tier strategy', () => {
    const freeA = makeCandidate({ modelId: 'free-a', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.8 });
    const freeB = makeCandidate({ modelId: 'free-b', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.6 });
    const paidA = makeCandidate({ modelId: 'paid-a', costPerInputToken: 0.002, costPerOutputToken: 0.004, qualityScore: 0.9 });
    const paidB = makeCandidate({ modelId: 'paid-b', costPerInputToken: 0.001, costPerOutputToken: 0.002, qualityScore: 0.7 });
    const mixedCandidates = [paidA, freeA, paidB, freeB];
    (0, vitest_1.it)('none: keeps normal scoring order', async () => {
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile(),
            candidates: mixedCandidates,
            epsilon: 0,
            freeTierStrategy: 'none',
        });
        // With balanced weights, paid-a (high quality) should rank first
        (0, vitest_1.expect)(result.selected.modelId).toBe('paid-a');
    });
    (0, vitest_1.it)('prioritize: free models come first', async () => {
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile(),
            candidates: mixedCandidates,
            epsilon: 0,
            freeTierStrategy: 'prioritize',
        });
        // Free-a has higher quality (0.8) among free models
        (0, vitest_1.expect)(result.selected.modelId).toBe('free-a');
        // Fallback chain should include free-b then paid models
        (0, vitest_1.expect)(result.chain.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('load_balance: distributes across free and paid models', async () => {
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile(),
            candidates: mixedCandidates,
            epsilon: 0,
            freeTierStrategy: 'load_balance',
        });
        // Should pick from all candidates (free + paid)
        (0, vitest_1.expect)(['free-a', 'free-b', 'paid-a', 'paid-b']).toContain(result.selected.modelId);
        // Fallback chain should include the rest
        (0, vitest_1.expect)(result.chain.length).toBe(3);
    });
    (0, vitest_1.it)('load_balance: single candidate returns it', async () => {
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile(),
            candidates: [makeCandidate({ modelId: 'only', costPerInputToken: 0, costPerOutputToken: 0 })],
            epsilon: 0,
            freeTierStrategy: 'load_balance',
        });
        (0, vitest_1.expect)(result.selected.modelId).toBe('only');
    });
    (0, vitest_1.it)('fallback: paid models come first, free as fallback', async () => {
        const result = await (0, pipeline_js_1.runPipeline)({
            taskProfile: makeTaskProfile(),
            candidates: mixedCandidates,
            epsilon: 0,
            freeTierStrategy: 'fallback',
        });
        // Paid-a (highest quality) should be primary
        (0, vitest_1.expect)(result.selected.modelId).toBe('paid-a');
        // Free models should be in the fallback chain
        const chainIds = result.chain.map((s) => s.provider.modelId);
        (0, vitest_1.expect)(chainIds).toContain('free-a');
    });
});
//# sourceMappingURL=pipeline.test.js.map