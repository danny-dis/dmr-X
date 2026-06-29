import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * OpenRouter adapter — access 100+ models via single API key.
 * Uses OpenAI-compatible API at openrouter.ai/api/v1.
 *
 * Env: OPENROUTER_API_KEY
 * Models: Any model available on OpenRouter (openai/gpt-4o, anthropic/claude-3.5-sonnet, etc.)
 */
export class OpenRouterAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'openrouter';

  constructor() {
    super('openrouter');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://openrouter.ai/api/v1',
      apiKey: (config.apiKey as string) || process.env.OPENROUTER_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    // OpenRouter supports 100+ models, return a subset of popular ones
    return [
      { modelId: 'openai/gpt-4o', modality: 'llm', capabilities: ['chat', 'vision', 'tools'] },
      { modelId: 'openai/gpt-4o-mini', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'anthropic/claude-3.5-sonnet', modality: 'llm', capabilities: ['chat', 'vision', 'tools'] },
      { modelId: 'anthropic/claude-3-haiku', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'google/gemini-2.0-flash', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'meta-llama/llama-3.1-70b-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'deepseek/deepseek-chat', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'mistralai/mixtral-8x7b-instruct', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
