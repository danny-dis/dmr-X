import { VertexAIAdapter } from '@dmr-x/adapters';
import type { ProviderConfig } from '@dmr-x/adapters';
import type { UnifiedRequest } from '@dmr-x/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Vertex AI adapter fidelity tests (services/adapters/src/vertex-ai/):
 *
 *   1. safetySettings / thinkingConfig / response_format are forwarded to
 *      the Gemini request body (previously dropped).
 *   2. Multi-part content — image_url parts become inlineData/fileData and
 *      input_audio becomes inlineData (previously dropped).
 *   3. ALL parallel function calls in a candidate are returned as tool_calls
 *      (previously .find() kept only the first).
 *   4. Thinking parts are excluded from the user-visible text.
 *   5. Assistant tool_calls and tool results round-trip as
 *      functionCall/functionResponse parts.
 */

describe('VertexAIAdapter', () => {
  let adapter: VertexAIAdapter;
  let mockConfig: ProviderConfig;

  beforeEach(() => {
    adapter = new VertexAIAdapter();
    mockConfig = {
      id: 'test-vertex',
      name: 'Test Vertex',
      apiKey: 'test-key',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function init(): Promise<void> {
    process.env.VERTEX_PROJECT_ID = 'test-project';
    await adapter.initialize(mockConfig);
  }

  async function captureRequest(): Promise<{ url: string; body: any }> {
    const mock = vi.mocked(globalThis.fetch);
    expect(mock).toHaveBeenCalledTimes(1);
    // rawFetch calls fetch(request) with a single Request object; the body
    // string becomes a ReadableStream when the Request is constructed.
    const [req] = mock.mock.calls[0];
    const request = req as Request;
    return { url: request.url, body: JSON.parse(await request.text()) };
  }

  describe('request fidelity (convertToGeminiRequest)', () => {
    it('forwards safetySettings, thinkingConfig, topK, candidateCount and response_format', async () => {
      await init();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] }),
      });

      const request: UnifiedRequest = {
        modality: 'llm',
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        response_format: { type: 'json_object' },
        metadata: {
          safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }],
          thinkingConfig: { thinkingBudget: 8192 },
          topK: 40,
          candidateCount: 2,
        },
      };

      await adapter.execute(request);

      const { body } = await captureRequest();
      expect(body.generationConfig).toMatchObject({
        responseMimeType: 'application/json',
        topK: 40,
        candidateCount: 2,
        thinkingConfig: { thinkingBudget: 8192 },
      });
      expect(body.safetySettings).toEqual([
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ]);
    });

    it('converts image_url data URIs to inlineData and public URLs to fileData', async () => {
      await init();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'seen' }] }, finishReason: 'STOP' }] }),
      });

      const request: UnifiedRequest = {
        modality: 'llm',
        model: 'gemini-2.5-flash',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'describe these' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            { type: 'image_url', image_url: { url: 'https://example.com/pic.jpg' } },
            { type: 'input_audio', input_audio: { data: 'BBBB', format: 'wav' } },
          ],
        }],
        stream: false,
        metadata: {},
      };

      await adapter.execute(request);

      const { body } = await captureRequest();
      expect(body.contents[0].parts).toEqual([
        { text: 'describe these' },
        { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
        { fileData: { fileUri: 'https://example.com/pic.jpg' } },
        { inlineData: { mimeType: 'audio/wav', data: 'BBBB' } },
      ]);
    });

    it('round-trips assistant tool_calls and tool results', async () => {
      await init();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] }),
      });

      const request: UnifiedRequest = {
        modality: 'llm',
        model: 'gemini-2.5-flash',
        messages: [
          {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"paris"}' },
            }],
          },
          { role: 'tool', tool_call_id: 'call_1', content: '{"temp":20}' },
        ],
        stream: false,
        metadata: {},
      };

      await adapter.execute(request);

      const { body } = await captureRequest();
      expect(body.contents[0].parts).toEqual([
        { functionCall: { name: 'get_weather', args: { city: 'paris' } } },
      ]);
      expect(body.contents[1]).toMatchObject({
        role: 'user',
        parts: [{ functionResponse: { name: 'call_1', response: { temp: 20 } } }],
      });
    });
  });

  describe('response fidelity (execute)', () => {
    it('returns ALL parallel function calls, not just the first', async () => {
      await init();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [
                { functionCall: { name: 'get_weather', args: { city: 'paris' } } },
                { functionCall: { name: 'get_time', args: { tz: 'UTC' } } },
              ],
            },
            finishReason: 'STOP',
          }],
        }),
      });

      const request: UnifiedRequest = {
        modality: 'llm',
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'do both' }],
        stream: false,
        metadata: {},
      };

      const response = await adapter.execute(request);
      expect(response.message?.tool_calls).toHaveLength(2);
      expect(response.message?.tool_calls?.map(tc => tc.function.name)).toEqual(['get_weather', 'get_time']);
    });

    it('excludes thinking parts from the returned text', async () => {
      await init();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [
                { text: 'internal reasoning', thought: true },
                { text: 'final answer' },
              ],
            },
            finishReason: 'STOP',
          }],
        }),
      });

      const request: UnifiedRequest = {
        modality: 'llm',
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        metadata: {},
      };

      const response = await adapter.execute(request);
      expect(response.message?.content).toBe('final answer');
    });
  });
});
