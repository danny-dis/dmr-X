import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingsService } from '../../services/memory/src/embeddings.js';

describe('EmbeddingsService real cache embeddings', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('aborts a hung real provider at the configured deadline without a hash fallback', async () => {
    vi.useFakeTimers();
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = new EmbeddingsService().embedReal('cache-only text', { timeoutMs: 25 });
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('rejects malformed real vectors instead of substituting a hash vector', async () => {
    vi.stubEnv('OLLAMA_BASE_URL', 'http://ollama.test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ embedding: [1, Number.NaN] }), { status: 200 })));

    await expect(new EmbeddingsService().embedReal('cache-only text')).rejects.toThrow('invalid embedding');
  });
});
