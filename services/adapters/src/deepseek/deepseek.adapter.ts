import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * DeepSeek adapter — Chinese LLM provider.
 * Uses OpenAI-compatible API at api.deepseek.com/v1.
 *
 * Env: DEEPSEEK_API_KEY
 * Models: deepseek-chat, deepseek-coder, deepseek-reasoner
 */
export class DeepSeekAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'deepseek';

  constructor() {
    super('deepseek');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.deepseek.com/v1',
      apiKey: (config.apiKey as string) || process.env.DEEPSEEK_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'deepseek-chat', modality: 'llm', capabilities: ['chat', 'tools'] },
      { modelId: 'deepseek-coder', modality: 'llm', capabilities: ['chat', 'tools'] },
      { modelId: 'deepseek-reasoner', modality: 'llm', capabilities: ['chat', 'reasoning'] },
    ];
  }
}
