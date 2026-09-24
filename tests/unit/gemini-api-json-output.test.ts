import { GeminiAPIAdapter } from '../../services/adapters/src/gemini-api/gemini-api.adapter.js';
import type { UnifiedRequest } from '@dmr-x/core';
import { describe, expect, it, vi } from 'vitest';

async function answer(text: string, response_format?: UnifiedRequest['response_format']) {
  const adapter = new GeminiAPIAdapter();
  await adapter.initialize({ baseUrl: 'https://example.invalid', apiKey: 'unit-test-key' });
  vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValue(new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'MAX_TOKENS' }],
  }), { status: 200 }));
  return adapter.execute({
    modality: 'llm', model: 'gemini-3-flash-preview',
    messages: [{ role: 'user', content: 'Return JSON' }],
    max_tokens: 128, response_format,
  });
}

describe('Gemini native JSON output validation', () => {
  it('rejects non-JSON text from a 200 JSON-mode completion for fallback', async () => {
    await expect(answer('Here is the JSON', { type: 'json_object' }))
      .rejects.toMatchObject({ statusCode: 502 });
  });

  it('rejects a JSON scalar when an object was required', async () => {
    await expect(answer('"7"', { type: 'json_object' }))
      .rejects.toMatchObject({ statusCode: 502 });
  });

  it('accepts a parsed JSON object', async () => {
    const response = await answer('{"answer":7}', { type: 'json_object' });
    expect(response.message?.content).toBe('{"answer":7}');
  });

  it('does not reject ordinary text completions', async () => {
    const response = await answer('Here is the JSON');
    expect(response.message?.content).toBe('Here is the JSON');
  });
});
