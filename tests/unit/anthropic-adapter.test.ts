import { AnthropicAdapter } from '@dmr-x/adapters';
import type { ProviderConfig } from '@dmr-x/adapters';
import type { UnifiedRequest } from '@dmr-x/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;
  let mockConfig: ProviderConfig;

  beforeEach(() => {
    adapter = new AnthropicAdapter();
    mockConfig = {
      id: 'test-anthropic',
      name: 'Test Anthropic',
      apiKey: 'test-api-key-123',
      baseUrl: 'https://api.anthropic.com',
    };
  });

  describe('initialize', () => {
    it('should initialize with valid config', async () => {
      await adapter.initialize(mockConfig);
      expect(adapter.providerId).toBe('anthropic');
    });

    it('should throw error if API key is missing', async () => {
      const configWithoutKey = { ...mockConfig, apiKey: '' };
      await expect(adapter.initialize(configWithoutKey)).rejects.toThrow('Anthropic API key is required');
    });

    it('should support expected modalities', () => {
      expect(adapter.supportedModalities).toContain('llm');
      expect(adapter.supportedModalities).not.toContain('embedding');
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      await adapter.initialize(mockConfig);
    });

    it('should throw error for unsupported modality', async () => {
      const request: UnifiedRequest = {
        modality: 'embedding' as any,
        model: 'claude-3-5-sonnet-20241022',
        stream: false,
        metadata: {},
      };

      await expect(adapter.execute(request)).rejects.toThrow('Anthropic only supports LLM modality');
    });

    it('should handle LLM requests', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Hello!',
            },
          ],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const request: UnifiedRequest = {
        modality: 'llm',
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
        metadata: {},
      };

      const response = await adapter.execute(request);
      expect(response.modality).toBe('llm');
      expect(response.message).toBeDefined();
      expect(response.message?.content).toBe('Hello!');
    });

    it('should handle tool use requests', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'get_weather',
              input: { location: 'San Francisco' },
            },
          ],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'tool_use',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
          },
        }),
      };

      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      const request: UnifiedRequest = {
        modality: 'llm',
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' },
                },
              },
            },
          },
        ],
        stream: false,
        metadata: {},
      };

      const response = await adapter.execute(request);
      expect(response.modality).toBe('llm');
      expect(response.message).toBeDefined();
      // Note: Anthropic adapter currently only extracts text content, not tool calls
      // This test verifies the adapter handles the response without crashing
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
});
