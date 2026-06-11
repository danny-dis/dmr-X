import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OllamaAdapter } from '@dmr-x/adapters';
import type { ProviderConfig, UnifiedRequest } from '@dmr-x/adapters';

describe('OllamaAdapter', () => {
  let adapter: OllamaAdapter;
  let mockConfig: ProviderConfig;

  beforeEach(() => {
    adapter = new OllamaAdapter();
    mockConfig = {
      id: 'test-ollama',
      name: 'Test Ollama',
      baseUrl: 'http://localhost:11434',
    };
  });

  describe('initialize', () => {
    it('should initialize with valid config', async () => {
      await adapter.initialize(mockConfig);
      expect(adapter.providerId).toBe('ollama');
    });

    it('should support expected modalities', () => {
      expect(adapter.supportedModalities).toContain('llm');
      expect(adapter.supportedModalities).toContain('embedding');
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      await adapter.initialize(mockConfig);
    });

    it('should throw error for unsupported modality', async () => {
      const request: UnifiedRequest = {
        modality: 'diffusion' as any,
        model: 'llama3.2',
        stream: false,
        metadata: {},
      };

      await expect(adapter.execute(request)).rejects.toThrow('Unsupported modality');
    });

    it('should handle LLM requests', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: {
            role: 'assistant',
            content: 'Hello!',
          },
          done: true,
          total_duration: 1000000000,
          eval_count: 5,
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const request: UnifiedRequest = {
        modality: 'llm',
        model: 'llama3.2',
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
          model: 'nomic-embed-text',
          embeddings: [[0.1, 0.2, 0.3]],
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const request: UnifiedRequest = {
        modality: 'embedding',
        model: 'nomic-embed-text',
        input: 'Hello world',
        stream: false,
        metadata: {},
      };

      const response = await adapter.execute(request);
      expect(response.modality).toBe('embedding');
      expect(response.embeddings).toBeDefined();
      expect(response.embeddings?.length).toBe(1);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when Ollama is running', async () => {
      await adapter.initialize(mockConfig);
      
      const mockResponse = {
        ok: true,
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(true);
    });

    it('should return unhealthy status when Ollama is not running', async () => {
      await adapter.initialize(mockConfig);
      
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(false);
    });
  });

  describe('listModels', () => {
    it('should return list of local models', async () => {
      await adapter.initialize(mockConfig);
      
      const mockResponse = {
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama3.2:latest', size: 2000000000 },
            { name: 'nomic-embed-text:latest', size: 500000000 },
          ],
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const models = await adapter.listModels();
      expect(models.length).toBe(2);
      expect(models[0].modelId).toBe('llama3.2:latest');
    });
  });
});
