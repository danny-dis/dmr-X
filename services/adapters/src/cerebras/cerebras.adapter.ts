import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Cerebras adapter — ultra-fast LLM inference.
 * Uses OpenAI-compatible API at api.cerebras.ai/v1.
 *
 * Env: CEREBRAS_API_KEY
 * Models: llama-3.3-70b, llama-3.1-8b, etc.
 */
export class CerebrasAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'cerebras';

  constructor() {
    super('cerebras');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.cerebras.ai/v1',
      apiKey: (config.apiKey as string) || process.env.CEREBRAS_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'llama-3.3-70b', modality: 'llm', capabilities: ['chat', 'tools'] },
      { modelId: 'llama-3.1-8b', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'qwen-2.5-32b', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
