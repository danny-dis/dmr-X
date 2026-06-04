"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const model_discovery_js_1 = require("../../services/registry/src/model-discovery.js");
function makeFetch(responses) {
    return vitest_1.vi.fn(async (url) => {
        for (const r of responses) {
            if (r.url.test(url)) {
                return {
                    ok: r.status >= 200 && r.status < 300,
                    status: r.status,
                    json: async () => r.body,
                };
            }
        }
        return { ok: false, status: 404, json: async () => ({}) };
    });
}
(0, vitest_1.describe)('discoverOpenAIModels', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.it)('returns empty list when baseUrl is empty', async () => {
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: '' });
        (0, vitest_1.expect)(result).toEqual([]);
    });
    (0, vitest_1.it)('returns empty list on HTTP error', async () => {
        const fetchImpl = makeFetch([{ url: /.*/, status: 500, body: {} }]);
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', fetchImpl });
        (0, vitest_1.expect)(result).toEqual([]);
    });
    (0, vitest_1.it)('normalizes OpenAI `/v1/models` response', async () => {
        const fetchImpl = makeFetch([
            {
                url: /\/v1\/models$/,
                status: 200,
                body: {
                    object: 'list',
                    data: [
                        { id: 'openai-fast', object: 'model', owned_by: 'pollinations' },
                        { id: 'openai-large', object: 'model', owned_by: 'pollinations' },
                    ],
                },
            },
        ]);
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', fetchImpl });
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result[0].modelId).toBe('openai-fast');
        (0, vitest_1.expect)(result[0].displayName).toBe('openai-fast');
        (0, vitest_1.expect)(result[0].modality).toBe('llm');
        (0, vitest_1.expect)(result[0].capabilities).toContain('streaming');
        (0, vitest_1.expect)(result[0].inputCostPer1M).toBe(0);
    });
    (0, vitest_1.it)('sends Authorization header when apiKey is provided', async () => {
        const fetchImpl = vitest_1.vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
        }));
        await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', apiKey: 'sk-test', fetchImpl });
        const call = fetchImpl.mock.calls[0];
        const headers = call[1]?.headers;
        (0, vitest_1.expect)(headers.Authorization).toBe('Bearer sk-test');
    });
    (0, vitest_1.it)('does NOT send Authorization header for keyless providers', async () => {
        const fetchImpl = vitest_1.vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
        }));
        await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://text.pollinations.ai/openai', apiKey: '', fetchImpl });
        const call = fetchImpl.mock.calls[0];
        const headers = call[1]?.headers;
        (0, vitest_1.expect)(headers.Authorization).toBeUndefined();
    });
    (0, vitest_1.it)('strips trailing slash from baseUrl', async () => {
        const fetchImpl = vitest_1.vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: 'm1' }] }),
        }));
        await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1/', fetchImpl });
        const calledUrl = fetchImpl.mock.calls[0][0];
        (0, vitest_1.expect)(calledUrl).toBe('https://x.test/v1/models');
    });
    (0, vitest_1.it)('handles bare-array response (non-standard)', async () => {
        const fetchImpl = makeFetch([
            { url: /.*/, status: 200, body: [{ id: 'm1' }, { id: 'm2' }] },
        ]);
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', fetchImpl });
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result.map((r) => r.modelId)).toEqual(['m1', 'm2']);
    });
    (0, vitest_1.it)('handles `{ models: [...] }` response', async () => {
        const fetchImpl = makeFetch([
            { url: /.*/, status: 200, body: { models: [{ id: 'm1' }] } },
        ]);
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', fetchImpl });
        (0, vitest_1.expect)(result).toHaveLength(1);
        (0, vitest_1.expect)(result[0].modelId).toBe('m1');
    });
    (0, vitest_1.it)('infers vision capability from explicit supports_vision flag', async () => {
        const fetchImpl = makeFetch([
            {
                url: /.*/,
                status: 200,
                body: { data: [{ id: 'gpt-4o', supports_vision: true, context_window: 128000 }] },
            },
        ]);
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', fetchImpl });
        (0, vitest_1.expect)(result[0].capabilities).toContain('vision');
        (0, vitest_1.expect)(result[0].capabilities).toContain('streaming');
        (0, vitest_1.expect)(result[0].contextWindow).toBe(128000);
    });
    (0, vitest_1.it)('infers tool_use from supports_function_call flag', async () => {
        const fetchImpl = makeFetch([
            {
                url: /.*/,
                status: 200,
                body: { data: [{ id: 'tool-model', supports_function_call: true }] },
            },
        ]);
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', fetchImpl });
        (0, vitest_1.expect)(result[0].capabilities).toContain('tool_use');
    });
    (0, vitest_1.it)('accepts capabilities array payload', async () => {
        const fetchImpl = makeFetch([
            {
                url: /.*/,
                status: 200,
                body: { data: [{ id: 'm1', capabilities: ['tool_use', 'vision', 'reasoning'] }] },
            },
        ]);
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', fetchImpl });
        (0, vitest_1.expect)(result[0].capabilities).toEqual(vitest_1.expect.arrayContaining(['streaming', 'tool_use', 'vision', 'reasoning']));
    });
    (0, vitest_1.it)('infers embedding modality from model id', async () => {
        const fetchImpl = makeFetch([
            { url: /.*/, status: 200, body: { data: [{ id: 'text-embedding-3-small' }] } },
        ]);
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', fetchImpl });
        (0, vitest_1.expect)(result[0].modality).toBe('embedding');
    });
    (0, vitest_1.it)('returns empty list on transport error', async () => {
        const fetchImpl = vitest_1.vi.fn(async () => {
            throw new TypeError('fetch failed');
        });
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', fetchImpl });
        (0, vitest_1.expect)(result).toEqual([]);
    });
    (0, vitest_1.it)('skips entries without an id', async () => {
        const fetchImpl = makeFetch([
            {
                url: /.*/,
                status: 200,
                body: { data: [{ id: 'good' }, { object: 'model' }, { id: 'also-good' }] },
            },
        ]);
        const result = await (0, model_discovery_js_1.discoverOpenAIModels)({ baseUrl: 'https://x.test/v1', fetchImpl });
        (0, vitest_1.expect)(result).toHaveLength(2);
        (0, vitest_1.expect)(result.map((r) => r.modelId)).toEqual(['good', 'also-good']);
    });
});
//# sourceMappingURL=model-discovery.test.js.map