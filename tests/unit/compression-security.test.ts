import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressionService } from '../../apps/gateway/src/services/compression.js';

const get = vi.fn();
vi.mock('headroom-ai', () => ({ HeadroomClient: class {} }));
vi.mock('@dmr-x/db', () => ({ getDb: () => ({ prepare: () => ({ get }) }) }));
vi.mock('@dmr-x/utils', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

afterEach(() => { get.mockReset(); });

describe('reversible compression ownership', () => {
  it('requires an owner scope before returning cached original content', async () => {
    get.mockReturnValue({ original_content: '[{"role":"assistant","content":"secret"}]', expires_at: '2999-01-01', tenant_id: 'tenant-a', api_key_id: 'key-a' });
    const result = await (compressionService.retrieveOriginal as any)('compression-id');
    expect(result).toBeNull();
  });

  it('fails open unchanged when reversible storage fails', async () => {
    vi.spyOn(compressionService, 'getGlobalConfig').mockReturnValue({ enabled: true, proxyUrl: 'http://localhost', reversible: true, minTokensToCompress: 1, engine: 'caveman' });
    vi.spyOn(compressionService as any, 'storeOriginal').mockResolvedValue(false);
    const messages = [{ role: 'assistant', content: 'Historical explanation that is long enough to compress.' }, { role: 'user', content: 'question' }];
    const result = await compressionService.compressPrompt(messages, null, null, { tenantId: 'tenant-a', apiKeyId: 'key-a' });
    expect(result.compressed).toBe(messages);
    expect(result.metadata).toMatchObject({ saved: 0, algorithmUsed: 'failed' });
    expect(result.metadata.compressedId).toBeUndefined();
  });

  it('fails open unchanged when reversible compression has no owner', async () => {
    vi.spyOn(compressionService, 'getGlobalConfig').mockReturnValue({ enabled: true, proxyUrl: 'http://localhost', reversible: true, minTokensToCompress: 1, engine: 'caveman' });
    const messages = [{ role: 'assistant', content: 'Historical explanation that is long enough to compress.' }, { role: 'user', content: 'question' }];
    const result = await compressionService.compressPrompt(messages);
    expect(result.compressed).toBe(messages);
    expect(result.metadata).toMatchObject({ saved: 0, algorithmUsed: 'failed' });
    expect(result.metadata.compressedId).toBeUndefined();
  });
});
