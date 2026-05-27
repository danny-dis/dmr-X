"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const task_classifier_js_1 = require("../../services/router/src/classifier/task-classifier.js");
function makeRequest(overrides = {}) {
    return {
        modality: 'llm',
        stream: false,
        metadata: {},
        ...overrides,
    };
}
(0, vitest_1.describe)('taskClassifier', () => {
    (0, vitest_1.it)('should classify LLM request from chat completions path', () => {
        const request = makeRequest({
            messages: [{ role: 'user', content: 'Hello' }],
        });
        const result = (0, task_classifier_js_1.classifyTask)(request, { path: '/v1/chat/completions' });
        (0, vitest_1.expect)(result.modality).toBe('llm');
        (0, vitest_1.expect)(result.streaming).toBe(false);
    });
    (0, vitest_1.it)('should detect vision capability', () => {
        const request = makeRequest({
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'What is in this image?' },
                        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
                    ],
                },
            ],
        });
        const result = (0, task_classifier_js_1.classifyTask)(request, { path: '/v1/chat/completions' });
        (0, vitest_1.expect)(result.capabilities).toContain('vision');
    });
    (0, vitest_1.it)('should detect tool_use capability', () => {
        const request = makeRequest({
            messages: [{ role: 'user', content: 'Hello' }],
            tools: [{ type: 'function', function: { name: 'test' } }],
        });
        const result = (0, task_classifier_js_1.classifyTask)(request, { path: '/v1/chat/completions' });
        (0, vitest_1.expect)(result.capabilities).toContain('tool_use');
    });
    (0, vitest_1.it)('should detect json_mode capability', () => {
        const request = makeRequest({
            messages: [{ role: 'user', content: 'Hello' }],
            response_format: { type: 'json_object' },
        });
        const result = (0, task_classifier_js_1.classifyTask)(request, { path: '/v1/chat/completions' });
        (0, vitest_1.expect)(result.capabilities).toContain('json_mode');
    });
    (0, vitest_1.it)('should classify diffusion request', () => {
        const request = makeRequest({
            modality: 'diffusion',
            prompt: 'A sunset',
            width: 1024,
            height: 1024,
        });
        const result = (0, task_classifier_js_1.classifyTask)(request, { path: '/v1/images/generations' });
        (0, vitest_1.expect)(result.modality).toBe('diffusion');
        (0, vitest_1.expect)(result.sizeEstimate.pixelCount).toBe(1024 * 1024);
    });
    (0, vitest_1.it)('should classify embedding request', () => {
        const request = makeRequest({
            modality: 'embedding',
            input: 'Hello world',
        });
        const result = (0, task_classifier_js_1.classifyTask)(request, { path: '/v1/embeddings' });
        (0, vitest_1.expect)(result.modality).toBe('embedding');
    });
    (0, vitest_1.it)('should estimate token count for LLM', () => {
        const request = makeRequest({
            messages: [{ role: 'user', content: 'Hello world, this is a test message' }],
            max_tokens: 500,
        });
        const result = (0, task_classifier_js_1.classifyTask)(request, { path: '/v1/chat/completions' });
        (0, vitest_1.expect)(result.sizeEstimate.inputTokens).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.sizeEstimate.outputTokensEst).toBe(500);
    });
    (0, vitest_1.it)('should use provided quality target', () => {
        const request = makeRequest({
            messages: [{ role: 'user', content: 'Hello' }],
        });
        const result = (0, task_classifier_js_1.classifyTask)(request, { path: '/v1/chat/completions', qualityTarget: 'frontier' });
        (0, vitest_1.expect)(result.qualityTarget).toBe('frontier');
    });
    (0, vitest_1.it)('should default to balanced quality target', () => {
        const request = makeRequest({
            messages: [{ role: 'user', content: 'Hello' }],
        });
        const result = (0, task_classifier_js_1.classifyTask)(request, { path: '/v1/chat/completions' });
        (0, vitest_1.expect)(result.qualityTarget).toBe('balanced');
    });
    (0, vitest_1.it)('should throw on unknown path', () => {
        const request = makeRequest();
        (0, vitest_1.expect)(() => (0, task_classifier_js_1.classifyTask)(request, { path: '/v1/unknown' })).toThrow('Unknown API path');
    });
});
//# sourceMappingURL=task-classifier.test.js.map