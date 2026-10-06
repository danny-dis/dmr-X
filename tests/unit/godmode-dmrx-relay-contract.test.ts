import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletionsUrl, upstreamApiKey, upstreamHeaders } from '../../patches/g0dm0d3/relay.js';
import { GodmodeService } from '../../services/godmode/src/godmode.service.js';

const keys = ['GODMODE_RELAY', 'G0DM0D3_LLM_BASE_URL', 'G0DM0D3_LLM_API_KEY', 'OPENROUTER_API_KEY'];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  vi.unstubAllGlobals();
});

describe('DMR-X Godmode relay contract', () => {
  it('never substitutes a caller OpenRouter credential for an empty local relay credential', () => {
    process.env.GODMODE_RELAY = '1';
    process.env.G0DM0D3_LLM_BASE_URL = 'http://localhost:47113/v1';
    process.env.G0DM0D3_LLM_API_KEY = '';
    process.env.OPENROUTER_API_KEY = 'upstream-provider-credential';
    expect(upstreamApiKey('caller-provider-credential')).toBe('');
    expect(upstreamHeaders('caller-provider-credential').Authorization).toBeUndefined();
  });

  it('fails closed when relay mode has no DMR-X endpoint instead of contacting OpenRouter', () => {
    process.env.GODMODE_RELAY = '1';
    delete process.env.G0DM0D3_LLM_BASE_URL;
    expect(() => chatCompletionsUrl()).toThrow(/relay.*base.*url/i);
  });

  it('rejects a direct OpenRouter URL even if it is mislabeled as the relay', () => {
    process.env.GODMODE_RELAY = '1';
    process.env.G0DM0D3_LLM_BASE_URL = 'https://openrouter.ai/api/v1';
    expect(() => chatCompletionsUrl()).toThrow(/DMR-X.*OpenRouter/i);
  });

  it('surfaces upstream SSE errors in the text-only streaming API', async () => {
    const service = new GodmodeService({ baseUrl: 'http://localhost:47115', llmBaseUrl: 'http://localhost:47113/v1' });
    await service.initialize();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'data: {"error":{"message":"relay quota exhausted"}}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )));
    await expect((async () => {
      for await (const _ of service.chatStream({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] })) { /* consume */ }
    })()).rejects.toThrow('relay quota exhausted');
  });

  it('surfaces upstream SSE errors instead of accepting an empty successful stream', async () => {
    const service = new GodmodeService({ baseUrl: 'http://localhost:47115', llmBaseUrl: 'http://localhost:47113/v1' });
    await service.initialize();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'data: {"error":{"message":"relay quota exhausted"}}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )));
    await expect((async () => {
      for await (const _ of service.chatStreamFull({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] })) { /* consume */ }
    })()).rejects.toThrow('relay quota exhausted');
  });
});
