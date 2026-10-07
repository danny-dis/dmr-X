import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressionService } from '../../apps/gateway/src/services/compression.js';

vi.mock('@dmr-x/db', () => ({ getDb: vi.fn(() => { throw new Error('No database in compression safety tests'); }) }));
vi.mock('@dmr-x/utils', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

function enable(engine: 'caveman' | 'rtk' | 'comment-strip' | 'headroom' = 'caveman') {
  vi.spyOn(compressionService, 'getGlobalConfig').mockReturnValue({
    enabled: true, proxyUrl: 'http://localhost:8787', reversible: false,
    minTokensToCompress: 1, engine,
  });
}

describe('compression context fidelity', () => {
  it('preserves instructions, users, tool exchanges, multimodal blocks and message metadata', async () => {
    enable();
    const messages = [
      { role: 'system', content: 'In the event that approval is absent, do not deploy.', name: 'policy' },
      { role: 'developer', content: 'Prior to sending, verify the exact identifier.' },
      { role: 'user', content: 'Actually explain the results, not just a summary.' },
      { role: 'assistant', content: 'This is an ordinary historical explanation.', name: 'helper' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"id":"actually"}' } }] },
      { role: 'tool', content: '{"status":"actually failed"}', tool_call_id: 'call-1' },
      { role: 'user', content: [{ type: 'text', text: 'Describe this.' }, { type: 'image_url', image_url: { url: 'https://example.test/image.png' } }] },
    ];
    const before = structuredClone(messages);
    const result = await compressionService.compressPrompt(messages as any);
    expect(result.compressed).toEqual(before);
    expect(messages).toEqual(before);
  });

  it('sends only eligible history to Headroom and restores original message metadata', async () => {
    enable('headroom');
    const compress = vi.fn(async () => ({ messages: [{ role: 'assistant', content: 'Brief history.' }] }));
    vi.spyOn(compressionService as any, 'getClient').mockReturnValue({ compress });
    const messages = [
      { role: 'system', content: 'Never delete instructions.' },
      { role: 'assistant', content: 'An ordinary longer historical explanation.', name: 'helper' },
      { role: 'user', content: 'In the event that tests fail, do not deploy.' },
    ];
    const result = await compressionService.compressPrompt(messages);
    expect(compress).toHaveBeenCalledWith([{ role: 'assistant', content: messages[1].content }]);
    expect(result.compressed).toEqual([messages[0], { ...messages[1], content: 'Brief history.' }, messages[2]]);
  });
});
