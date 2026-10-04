import { GeminiAPIAdapter } from '../../services/adapters/src/gemini-api/gemini-api.adapter.js';
import { ProviderError, type UnifiedRequest } from '@dmr-x/core';
import { describe, expect, it, vi } from 'vitest';

const request: UnifiedRequest = {
  modality: 'llm',
  model: 'gemini-3-flash-preview',
  messages: [{ role: 'user', content: 'Reply OK' }],
  max_tokens: 64,
};

async function executeResponse(candidate: Record<string, unknown>) {
  const adapter = new GeminiAPIAdapter();
  await adapter.initialize({ baseUrl: 'https://example.invalid', apiKey: 'unit-test-placeholder' });
  vi.spyOn(adapter as any, 'fetchWithTimeout').mockResolvedValue(
    new Response(JSON.stringify({ candidates: [candidate] }), { status: 200 }),
  );
  return adapter.execute(request);
}

describe('Gemini API empty chat responses', () => {
  it('rejects a 200 with no visible text or tool call so routing can retry', async () => {
    await expect(executeResponse({
      content: { parts: [{ text: 'internal', thought: true }] },
      finishReason: 'MAX_TOKENS',
    })).rejects.toMatchObject({ statusCode: 502 });
  });

  it('preserves a tool-only response', async () => {
    const response = await executeResponse({
      content: { parts: [{ functionCall: { name: 'lookup', args: { id: 1 } } }] },
      finishReason: 'STOP',
    });
    expect(response.message?.tool_calls).toHaveLength(1);
    expect(response.message?.content).toBe('');
  });

  it('preserves a non-empty chat response', async () => {
    const response = await executeResponse({
      content: { parts: [{ text: 'OK' }] },
      finishReason: 'STOP',
    });
    expect(response.message?.content).toBe('OK');
  });
});
