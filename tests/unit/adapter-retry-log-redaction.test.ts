import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionError, logger } from '@dmr-x/utils';
import { GeminiAPIAdapter } from '../../services/adapters/src/gemini-api/gemini-api.adapter.js';

afterEach(() => vi.restoreAllMocks());

describe('adapter retry logging', () => {
  it('never logs a credential embedded in the request URL', async () => {
    const adapter = new GeminiAPIAdapter();
    await adapter.initialize({ baseUrl: 'https://example.invalid', apiKey: 'fake-key' });
    (adapter as any).retryConfig = { strategy: 'backoff', backoff: {
      initialInterval: 1, maxInterval: 1, exponent: 1, maxElapsedTime: 500, maxAttempts: 2,
    }, retryConnectionErrors: true };
    vi.spyOn(adapter as any, 'rawFetch')
      .mockRejectedValueOnce(new ConnectionError('fetch failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const log = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    await (adapter as any).fetchWithTimeout('https://example.invalid/v1?key=fake-secret-value', { timeoutMs: 100 });
    const retryCalls = log.mock.calls.filter(call => call[1] === 'Retrying HTTP request after transient failure');
    expect(retryCalls).toHaveLength(1);
    expect(JSON.stringify(retryCalls)).not.toContain('fake-secret-value');
  });
  it('does not put URL credentials in network exception messages', async () => {
    const adapter = new GeminiAPIAdapter();
    await adapter.initialize({ baseUrl: 'https://example.invalid', apiKey: 'fake-key' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    let message = '';
    try {
      await (adapter as any).rawFetch('https://example.invalid/v1?key=fake-secret-value', { timeoutMs: 100 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('network down');
    expect(message).not.toContain('fake-secret-value');
  });
});
