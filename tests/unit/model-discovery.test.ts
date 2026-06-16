import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverOpenAIModels } from '../../services/registry/src/model-discovery.js';

function makeFetch(responses: Array<{ url: RegExp; status: number; body: unknown }>) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
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
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    const headers = call?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer sk-test');
  });

  it('does NOT send Authorization header for keyless providers', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    }) as Response);
    await discoverOpenAIModels({ baseUrl: 'https://text.pollinations.ai/openai', apiKey: '', fetchImpl });
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    const headers = call?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
  });

  it('strips trailing slash from baseUrl', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'm1' }] }),
    }) as Response);
    await discoverOpenAIModels({ baseUrl: 'https://x.test/v1/', fetchImpl });
    const calledUrl = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit] | undefined)?.[0];
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

  it('returns empty list and skips fetch when isReachable returns false', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'm1' }] }) }) as Response);
    const isReachable = vi.fn(async () => false);
    const result = await discoverOpenAIModels({
      baseUrl: 'http://localhost:11434/v1',
      fetchImpl,
      isReachable,
    });
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(isReachable).toHaveBeenCalledTimes(1);
  });

  it('proceeds with fetch when isReachable returns true', async () => {
    const fetchImpl = makeFetch([
      { url: /.*/, status: 200, body: { data: [{ id: 'm1' }] } },
    ]);
    const isReachable = vi.fn(async () => true);
    const result = await discoverOpenAIModels({
      baseUrl: 'http://localhost:11434/v1',
      fetchImpl,
      isReachable,
    });
    expect(result).toHaveLength(1);
    expect(isReachable).toHaveBeenCalledTimes(1);
  });

  it('returns empty list for invalid baseUrl without probing or fetching', async () => {
    const fetchImpl = vi.fn();
    const isReachable = vi.fn();
    const result = await discoverOpenAIModels({
      baseUrl: 'not-a-url',
      fetchImpl,
      isReachable,
    });
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(isReachable).not.toHaveBeenCalled();
  });
});

describe('isLocalProviderUnconfigured', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns true for a localhost baseUrl with the envKey unset', async () => {
    delete process.env.OLLAMA_BASE_URL;
    const { isLocalProviderUnconfigured } = await import(
      '../../services/registry/src/auto-register.js'
    );
    expect(
      isLocalProviderUnconfigured({
        id: 'ollama',
        envKey: 'OLLAMA_BASE_URL',
        baseUrl: 'http://localhost:11434/v1',
      } as any),
    ).toBe(true);
  });

  it('returns false when the envKey is set to a non-empty value', async () => {
    process.env.VLLM_BASE_URL = 'http://localhost:8000';
    const { isLocalProviderUnconfigured } = await import(
      '../../services/registry/src/auto-register.js'
    );
    expect(
      isLocalProviderUnconfigured({
        id: 'vllm',
        envKey: 'VLLM_BASE_URL',
        baseUrl: 'http://localhost:8000/v1',
      } as any),
    ).toBe(false);
  });

  it('returns false for non-localhost baseUrl', async () => {
    delete process.env.SOME_REMOTE_URL;
    const { isLocalProviderUnconfigured } = await import(
      '../../services/registry/src/auto-register.js'
    );
    expect(
      isLocalProviderUnconfigured({
        id: 'remote',
        envKey: 'SOME_REMOTE_URL',
        baseUrl: 'https://api.example.com/v1',
      } as any),
    ).toBe(false);
  });

  it('returns false when baseUrl or envKey is missing', async () => {
    const { isLocalProviderUnconfigured } = await import(
      '../../services/registry/src/auto-register.js'
    );
    expect(isLocalProviderUnconfigured({ id: 'x', envKey: undefined, baseUrl: 'http://localhost:1' } as any)).toBe(false);
    expect(isLocalProviderUnconfigured({ id: 'x', envKey: 'X', baseUrl: '' } as any)).toBe(false);
    expect(isLocalProviderUnconfigured({ id: 'x', envKey: '', baseUrl: 'http://localhost:1' } as any)).toBe(false);
  });
});
