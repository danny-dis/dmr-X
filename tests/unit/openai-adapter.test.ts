import { OpenAIAdapter } from '@dmr-x/adapters';
import type { ProviderConfig } from '@dmr-x/adapters';
import type { UnifiedRequest } from '@dmr-x/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter;
  let mockConfig: ProviderConfig;

  beforeEach(() => {
    adapter = new OpenAIAdapter();
    mockConfig = {
      id: 'test-openai',
      name: 'Test OpenAI',
      apiKey: 'test-api-key-123',
      baseUrl: 'https://api.openai.com',
    };
  });

  describe('initialize', () => {
    it('should initialize with valid config', async () => {
      await adapter.initialize(mockConfig);
      expect(adapter.providerId).toBe('openai');
    });

    it('should throw error if API key is missing', async () => {
      const configWithoutKey = { ...mockConfig, apiKey: '' };
      await expect(adapter.initialize(configWithoutKey)).rejects.toThrow('OpenAI API key is required');
    });

    it('should support expected modalities', () => {
      expect(adapter.supportedModalities).toContain('llm');
      expect(adapter.supportedModalities).toContain('embedding');
      expect(adapter.supportedModalities).toContain('diffusion');
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      await adapter.initialize(mockConfig);
    });

    it('should throw error for unsupported modality', async () => {
      const request: UnifiedRequest = {
        modality: 'audio_tts' as any,
        model: 'gpt-4o',
        stream: false,
        metadata: {},
      };

      await expect(adapter.execute(request)).rejects.toThrow('Unsupported modality');
    });

    it('should handle LLM requests', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Hello!',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const request: UnifiedRequest = {
        modality: 'llm',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
        metadata: {},
      };

      const response = await adapter.execute(request);
      expect(response.modality).toBe('llm');
      expect(response.message).toBeDefined();
      expect(response.message?.content).toBe('Hello!');
    });

    it('should handle embedding requests', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            {
              object: 'embedding',
              embedding: [0.1, 0.2, 0.3],
              index: 0,
            },
          ],
          model: 'text-embedding-3-small',
          usage: {
            prompt_tokens: 10,
            total_tokens: 10,
          },
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const request: UnifiedRequest = {
        modality: 'embedding',
        model: 'text-embedding-3-small',
        input: 'Hello world',
        stream: false,
        metadata: {},
      };

      const response = await adapter.execute(request);
      expect(response.modality).toBe('embedding');
      expect(response.embeddings).toBeDefined();
      expect(response.embeddings?.length).toBe(1);
    });

    it('should handle image generation requests', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          created: 1234567890,
          data: [
            {
              url: 'https://example.com/image.png',
              revised_prompt: 'A test image',
            },
          ],
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const request: UnifiedRequest = {
        modality: 'diffusion',
        model: 'dall-e-3',
        prompt: 'A test image',
        stream: false,
        metadata: {},
      };

      const response = await adapter.execute(request);
      expect(response.modality).toBe('diffusion');
      expect(response.images).toBeDefined();
      expect(response.images?.length).toBe(1);
    });
  });

  describe('executeStream', () => {
    beforeEach(async () => {
      await adapter.initialize(mockConfig);
    });

    it('should forward the same sampling/formatting params as executeChat (minus n)', async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, body });
      globalThis.fetch = fetchMock;

      const request: UnifiedRequest = {
        modality: 'llm',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
        temperature: 0.5,
        max_tokens: 100,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.2,
        stop: ['\n'],
        response_format: { type: 'json_object' },
        seed: 42,
        n: 3,
        metadata: {},
      };

      const iterator = adapter.executeStream(request)[Symbol.asyncIterator]();
      await iterator.next();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [sentRequest] = fetchMock.mock.calls[0] as [Request];
      const sentBody = JSON.parse(await sentRequest.clone().text());

      expect(sentBody.top_p).toBe(0.9);
      expect(sentBody.frequency_penalty).toBe(0.1);
      expect(sentBody.presence_penalty).toBe(0.2);
      expect(sentBody.stop).toEqual(['\n']);
      expect(sentBody.response_format).toEqual({ type: 'json_object' });
      expect(sentBody.seed).toBe(42);
      expect(sentBody.stream).toBe(true);
      // n is intentionally not forwarded for a single SSE stream
      expect(sentBody.n).toBeUndefined();
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when API is accessible', async () => {
      await adapter.initialize(mockConfig);
      
      const mockResponse = {
        ok: true,
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
    });

    it('should return unhealthy status when API is inaccessible', async () => {
      await adapter.initialize(mockConfig);
      
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(false);
    });
  });

  describe('listModels', () => {
    it('should return list of models', async () => {
      await adapter.initialize(mockConfig);
      
      const mockResponse = {
        ok: true,
        json: async () => ({
          data: [
            { id: 'gpt-4o', owned_by: 'openai' },
            { id: 'gpt-4o-mini', owned_by: 'openai' },
          ],
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const models = await adapter.listModels();
      // Remote models (2) + hardcoded Sora video models (3) = 5
      expect(models.length).toBe(5);
      expect(models[0].modelId).toBe('gpt-4o');
    });
  });
});
