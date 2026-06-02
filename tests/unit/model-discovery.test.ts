import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverOpenAIModels } from '../../services/registry/src/model-discovery.js';

function makeFetch(responses: Array<{ url: RegExp; status: number; body: unknown }>) {
  return vi.fn(async (url: string) => {
    for (const r of responses) {
      if (r.url.test(url)) {
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => r.body,
        } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
}

describe('discoverOpenAIModels', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns empty list when baseUrl is empty', async () => {
    const result = await discoverOpenAIModels({ baseUrl: '' });
    expect(result).toEqual([]);
  });

  it('returns empty list on HTTP error', async () => {
    const fetchImpl = makeFetch([{ url: /.*/, status: 500, body: {} }]);
    const result = await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', fetchImpl });
    expect(result).toEqual([]);
  });

  it('normalizes OpenAI `/v1/models` response', async () => {
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
    const result = await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', fetchImpl });
    expect(result).toHaveLength(2);
    expect(result[0].modelId).toBe('openai-fast');
    expect(result[0].displayName).toBe('openai-fast');
    expect(result[0].modality).toBe('llm');
    expect(result[0].capabilities).toContain('streaming');
    expect(result[0].inputCostPer1M).toBe(0);
  });

  it('sends Authorization header when apiKey is provided', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    }) as Response);
    await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', apiKey: 'sk-test', fetchImpl });
    const call = fetchImpl.mock.calls[0];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
  });

  it('does NOT send Authorization header for keyless providers', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    }) as Response);
    await discoverOpenAIModels({ baseUrl: 'https://text.pollinations.ai/openai', apiKey: '', fetchImpl });
    const call = fetchImpl.mock.calls[0];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('strips trailing slash from baseUrl', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'm1' }] }),
    }) as Response);
    await discoverOpenAIModels({ baseUrl: 'https://x.test/v1/', fetchImpl });
    const calledUrl = fetchImpl.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://x.test/v1/models');
  });

  it('handles bare-array response (non-standard)', async () => {
    const fetchImpl = makeFetch([
      { url: /.*/, status: 200, body: [{ id: 'm1' }, { id: 'm2' }] },
    ]);
    const result = await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', fetchImpl });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.modelId)).toEqual(['m1', 'm2']);
  });

  it('handles `{ models: [...] }` response', async () => {
    const fetchImpl = makeFetch([
      { url: /.*/, status: 200, body: { models: [{ id: 'm1' }] } },
    ]);
    const result = await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', fetchImpl });
    expect(result).toHaveLength(1);
    expect(result[0].modelId).toBe('m1');
  });

  it('infers vision capability from explicit supports_vision flag', async () => {
    const fetchImpl = makeFetch([
      {
        url: /.*/,
        status: 200,
        body: { data: [{ id: 'gpt-4o', supports_vision: true, context_window: 128000 }] },
      },
    ]);
    const result = await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', fetchImpl });
    expect(result[0].capabilities).toContain('vision');
    expect(result[0].capabilities).toContain('streaming');
    expect(result[0].contextWindow).toBe(128000);
  });

  it('infers tool_use from supports_function_call flag', async () => {
    const fetchImpl = makeFetch([
      {
        url: /.*/,
        status: 200,
        body: { data: [{ id: 'tool-model', supports_function_call: true }] },
      },
    ]);
    const result = await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', fetchImpl });
    expect(result[0].capabilities).toContain('tool_use');
  });

  it('accepts capabilities array payload', async () => {
    const fetchImpl = makeFetch([
      {
        url: /.*/,
        status: 200,
        body: { data: [{ id: 'm1', capabilities: ['tool_use', 'vision', 'reasoning'] }] },
      },
    ]);
    const result = await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', fetchImpl });
    expect(result[0].capabilities).toEqual(
      expect.arrayContaining(['streaming', 'tool_use', 'vision', 'reasoning']),
    );
  });

  it('infers embedding modality from model id', async () => {
    const fetchImpl = makeFetch([
      { url: /.*/, status: 200, body: { data: [{ id: 'text-embedding-3-small' }] } },
    ]);
    const result = await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', fetchImpl });
    expect(result[0].modality).toBe('embedding');
  });

  it('returns empty list on transport error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const result = await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', fetchImpl });
    expect(result).toEqual([]);
  });

  it('skips entries without an id', async () => {
    const fetchImpl = makeFetch([
      {
        url: /.*/,
        status: 200,
        body: { data: [{ id: 'good' }, { object: 'model' }, { id: 'also-good' }] },
      },
    ]);
    const result = await discoverOpenAIModels({ baseUrl: 'https://x.test/v1', fetchImpl });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.modelId)).toEqual(['good', 'also-good']);
  });
});
