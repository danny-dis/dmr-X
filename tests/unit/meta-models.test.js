"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const meta_models_js_1 = require("../../services/router/src/meta-models.js");
function makeCandidate(overrides = {}) {
    return {
        providerId: 'test-provider',
        providerName: 'test',
        modelId: 'test-model',
        modality: 'llm',
        intelligenceLayer: 'executor',
        capabilities: [],
        costPerInputToken: 0,
        costPerOutputToken: 0,
        costPerImage: 0,
        avgLatencyMs: 1000,
        qualityScore: 0.8,
        isHealthy: true,
        ...overrides,
    };
}
(0, vitest_1.describe)('meta-models', () => {
    (0, vitest_1.it)('should recognize meta-model aliases', () => {
        (0, vitest_1.expect)((0, meta_models_js_1.isMetaModel)('free')).toBe(true);
        (0, vitest_1.expect)((0, meta_models_js_1.isMetaModel)('free-fast')).toBe(true);
        (0, vitest_1.expect)((0, meta_models_js_1.isMetaModel)('free-smart')).toBe(true);
        (0, vitest_1.expect)((0, meta_models_js_1.isMetaModel)('free-agentic')).toBe(true);
        (0, vitest_1.expect)((0, meta_models_js_1.isMetaModel)('free-coding')).toBe(true);
        (0, vitest_1.expect)((0, meta_models_js_1.isMetaModel)('gpt-4o')).toBe(false);
    });
    (0, vitest_1.it)('should have five meta-model definitions', () => {
        (0, vitest_1.expect)(meta_models_js_1.META_MODELS).toHaveLength(5);
        (0, vitest_1.expect)(meta_models_js_1.META_MODELS.map(m => m.alias)).toEqual(['free', 'free-fast', 'free-smart', 'free-agentic', 'free-coding']);
    });
    (0, vitest_1.it)('should resolve free as neutral pass-through (no re-sorting)', () => {
        const candidates = [
            makeCandidate({ modelId: 'first', qualityScore: 0.5, avgLatencyMs: 200, costPerInputToken: 0 }),
            makeCandidate({ modelId: 'second', qualityScore: 0.9, avgLatencyMs: 2000, costPerInputToken: 0 }),
            makeCandidate({ modelId: 'paid', qualityScore: 0.95, costPerInputToken: 0.01 }),
        ];
        const result = (0, meta_models_js_1.resolveMetaModel)('free', candidates);
        (0, vitest_1.expect)(result).not.toBeNull();
        // free should NOT re-sort — preserve original order from pipeline
        (0, vitest_1.expect)(result.resolved[0].modelId).toBe('first');
        (0, vitest_1.expect)(result.resolved[1].modelId).toBe('second');
        (0, vitest_1.expect)(result.resolved.every(c => c.costPerInputToken === 0)).toBe(true);
    });
    (0, vitest_1.it)('should resolve free-fast to lowest latency free model', () => {
        const candidates = [
            makeCandidate({ modelId: 'slow', qualityScore: 0.9, avgLatencyMs: 2000, costPerInputToken: 0 }),
            makeCandidate({ modelId: 'fast', qualityScore: 0.5, avgLatencyMs: 200, costPerInputToken: 0 }),
        ];
        const result = (0, meta_models_js_1.resolveMetaModel)('free-fast', candidates);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.resolved[0].modelId).toBe('fast');
    });
    (0, vitest_1.it)('should resolve free-smart to highest quality free model', () => {
        const candidates = [
            makeCandidate({ modelId: 'dumb', qualityScore: 0.3, costPerInputToken: 0 }),
            makeCandidate({ modelId: 'smart', qualityScore: 0.95, costPerInputToken: 0 }),
        ];
        const result = (0, meta_models_js_1.resolveMetaModel)('free-smart', candidates);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.resolved[0].modelId).toBe('smart');
    });
    (0, vitest_1.it)('should return null for non-meta-model', () => {
        (0, vitest_1.expect)((0, meta_models_js_1.resolveMetaModel)('gpt-4o', [])).toBeNull();
    });
    (0, vitest_1.it)('should return null when no free candidates match', () => {
        const candidates = [
            makeCandidate({ costPerInputToken: 0.01, costPerOutputToken: 0.02 }),
        ];
        (0, vitest_1.expect)((0, meta_models_js_1.resolveMetaModel)('free', candidates)).toBeNull();
    });
    (0, vitest_1.it)('should exclude paid models from free meta-model results', () => {
        const candidates = [
            makeCandidate({ modelId: 'free-1', costPerInputToken: 0, costPerOutputToken: 0, qualityScore: 0.7 }),
            makeCandidate({ modelId: 'paid-1', costPerInputToken: 0.01, costPerOutputToken: 0.02, qualityScore: 0.99 }),
        ];
        const result = (0, meta_models_js_1.resolveMetaModel)('free', candidates);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.resolved.every(c => c.costPerInputToken === 0)).toBe(true);
        (0, vitest_1.expect)(result.resolved.find(c => c.modelId === 'paid-1')).toBeUndefined();
    });
    (0, vitest_1.it)('should preserve all free candidates in original order', () => {
        const candidates = [
            makeCandidate({ modelId: 'free-a', costPerInputToken: 0, qualityScore: 0.6 }),
            makeCandidate({ modelId: 'free-b', costPerInputToken: 0, qualityScore: 0.8 }),
            makeCandidate({ modelId: 'free-c', costPerInputToken: 0, qualityScore: 0.7 }),
        ];
        const result = (0, meta_models_js_1.resolveMetaModel)('free', candidates);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.resolved).toHaveLength(3);
        // free is neutral — preserves original order
        (0, vitest_1.expect)(result.resolved[0].modelId).toBe('free-a');
        (0, vitest_1.expect)(result.resolved[1].modelId).toBe('free-b');
        (0, vitest_1.expect)(result.resolved[2].modelId).toBe('free-c');
    });
    (0, vitest_1.describe)('free-agentic', () => {
        (0, vitest_1.it)('should only return free models with tool_use and 64K+ context', () => {
            const candidates = [
                makeCandidate({ modelId: 'agentic-good', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.8 }),
                makeCandidate({ modelId: 'no-tools', costPerInputToken: 0, capabilities: [], contextLength: 128000, qualityScore: 0.9 }),
                makeCandidate({ modelId: 'small-context', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 8000, qualityScore: 0.9 }),
                makeCandidate({ modelId: 'paid-agentic', costPerInputToken: 0.01, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.95 }),
            ];
            const result = (0, meta_models_js_1.resolveMetaModel)('free-agentic', candidates);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.resolved).toHaveLength(1);
            (0, vitest_1.expect)(result.resolved[0].modelId).toBe('agentic-good');
        });
        (0, vitest_1.it)('should sort by composite score: quality (50%) + context (30%) + speed (20%)', () => {
            const candidates = [
                // High quality, medium context, slow
                makeCandidate({ modelId: 'quality-king', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.95, avgLatencyMs: 3000 }),
                // Medium quality, huge context, fast
                makeCandidate({ modelId: 'context-beast', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 1000000, qualityScore: 0.7, avgLatencyMs: 500 }),
                // Medium everything
                makeCandidate({ modelId: 'balanced', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 256000, qualityScore: 0.8, avgLatencyMs: 1000 }),
            ];
            const result = (0, meta_models_js_1.resolveMetaModel)('free-agentic', candidates);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.resolved).toHaveLength(3);
            // quality-king: 0.95*0.5 + min(128K/1M,1)*0.3 + max(0,1-3000/5000)*0.2 = 0.475 + 0.0384 + 0.08 = 0.5934
            // context-beast: 0.7*0.5 + 1.0*0.3 + max(0,1-500/5000)*0.2 = 0.35 + 0.3 + 0.18 = 0.83
            // balanced: 0.8*0.5 + min(256K/1M,1)*0.3 + max(0,1-1000/5000)*0.2 = 0.4 + 0.0768 + 0.16 = 0.6368
            // context-beast should win (highest score)
            (0, vitest_1.expect)(result.resolved[0].modelId).toBe('context-beast');
        });
        (0, vitest_1.it)('should exclude models without tool_use capability', () => {
            const candidates = [
                makeCandidate({ modelId: 'no-tools', costPerInputToken: 0, capabilities: ['streaming'], contextLength: 128000 }),
                makeCandidate({ modelId: 'has-tools', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 128000 }),
            ];
            const result = (0, meta_models_js_1.resolveMetaModel)('free-agentic', candidates);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.resolved).toHaveLength(1);
            (0, vitest_1.expect)(result.resolved[0].modelId).toBe('has-tools');
        });
        (0, vitest_1.it)('should exclude models with context < 64K', () => {
            const candidates = [
                makeCandidate({ modelId: 'tiny', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 4096 }),
                makeCandidate({ modelId: 'small', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 32000 }),
                makeCandidate({ modelId: 'big', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 64000 }),
            ];
            const result = (0, meta_models_js_1.resolveMetaModel)('free-agentic', candidates);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.resolved).toHaveLength(1);
            (0, vitest_1.expect)(result.resolved[0].modelId).toBe('big');
        });
        (0, vitest_1.it)('should handle models with unknown context length', () => {
            const candidates = [
                makeCandidate({ modelId: 'unknown-ctx', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: undefined }),
                makeCandidate({ modelId: 'known-good', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000 }),
            ];
            const result = (0, meta_models_js_1.resolveMetaModel)('free-agentic', candidates);
            (0, vitest_1.expect)(result).not.toBeNull();
            // unknown-ctx has contextLength undefined (0 when nullish coalesced), filtered out
            (0, vitest_1.expect)(result.resolved).toHaveLength(1);
            (0, vitest_1.expect)(result.resolved[0].modelId).toBe('known-good');
        });
        (0, vitest_1.it)('should return null when no candidates match', () => {
            const candidates = [
                makeCandidate({ costPerInputToken: 0, capabilities: [], contextLength: 128000 }),
                makeCandidate({ costPerInputToken: 0.01, capabilities: ['tool_use'], contextLength: 128000 }),
            ];
            (0, vitest_1.expect)((0, meta_models_js_1.resolveMetaModel)('free-agentic', candidates)).toBeNull();
        });
    });
    (0, vitest_1.describe)('free-coding', () => {
        (0, vitest_1.it)('should only return free models with 32K+ context', () => {
            const candidates = [
                makeCandidate({ modelId: 'coding-good', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 128000, qualityScore: 0.8 }),
                makeCandidate({ modelId: 'small-context', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 16000, qualityScore: 0.9 }),
                makeCandidate({ modelId: 'paid-coding', costPerInputToken: 0.01, capabilities: ['tool_use', 'streaming'], contextLength: 128000, qualityScore: 0.95 }),
            ];
            const result = (0, meta_models_js_1.resolveMetaModel)('free-coding', candidates);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.resolved).toHaveLength(1);
            (0, vitest_1.expect)(result.resolved[0].modelId).toBe('coding-good');
        });
        (0, vitest_1.it)('should sort by composite score: quality (30%) + specialization (40%) + context (20%) + speed (10%)', () => {
            const candidates = [
                // High quality, few code capabilities, medium context, slow
                makeCandidate({ modelId: 'quality-king', costPerInputToken: 0, capabilities: ['tool_use'], contextLength: 128000, qualityScore: 0.95, avgLatencyMs: 3000 }),
                // Medium quality, all code capabilities, huge context, fast
                makeCandidate({ modelId: 'code-beast', costPerInputToken: 0, capabilities: ['tool_use', 'streaming', 'reasoning'], contextLength: 256000, qualityScore: 0.7, avgLatencyMs: 500 }),
                // Medium everything
                makeCandidate({ modelId: 'balanced', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 128000, qualityScore: 0.8, avgLatencyMs: 1000 }),
            ];
            const result = (0, meta_models_js_1.resolveMetaModel)('free-coding', candidates);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.resolved).toHaveLength(3);
            // code-beast should win due to high specialization match (all 3 capabilities)
            (0, vitest_1.expect)(result.resolved[0].modelId).toBe('code-beast');
        });
        (0, vitest_1.it)('should exclude paid models', () => {
            const candidates = [
                makeCandidate({ modelId: 'free-code', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 128000 }),
                makeCandidate({ modelId: 'paid-code', costPerInputToken: 0.01, capabilities: ['tool_use', 'streaming'], contextLength: 128000 }),
            ];
            const result = (0, meta_models_js_1.resolveMetaModel)('free-coding', candidates);
            (0, vitest_1.expect)(result).not.toBeNull();
            (0, vitest_1.expect)(result.resolved).toHaveLength(1);
            (0, vitest_1.expect)(result.resolved[0].modelId).toBe('free-code');
        });
        (0, vitest_1.it)('should handle models with unknown context length', () => {
            const candidates = [
                makeCandidate({ modelId: 'unknown-ctx', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: undefined }),
                makeCandidate({ modelId: 'known-good', costPerInputToken: 0, capabilities: ['tool_use', 'streaming'], contextLength: 128000 }),
            ];
            const result = (0, meta_models_js_1.resolveMetaModel)('free-coding', candidates);
            (0, vitest_1.expect)(result).not.toBeNull();
            // unknown-ctx has contextLength undefined (0 when nullish coalesced), filtered out
            (0, vitest_1.expect)(result.resolved).toHaveLength(1);
            (0, vitest_1.expect)(result.resolved[0].modelId).toBe('known-good');
        });
        (0, vitest_1.it)('should return null when no candidates match', () => {
            const candidates = [
                makeCandidate({ costPerInputToken: 0, capabilities: [], contextLength: 16000 }),
                makeCandidate({ costPerInputToken: 0.01, capabilities: ['tool_use', 'streaming'], contextLength: 128000 }),
            ];
            (0, vitest_1.expect)((0, meta_models_js_1.resolveMetaModel)('free-coding', candidates)).toBeNull();
        });
    });
});
//# sourceMappingURL=meta-models.test.js.map