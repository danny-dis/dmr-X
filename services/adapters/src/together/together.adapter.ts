import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Together AI adapter — open-source model inference.
 * Uses OpenAI-compatible API at api.together.xyz/v1.
 *
 * Env: TOGETHER_API_KEY
 * Models: meta-llama, mistralai, google, etc.
 */
export class TogetherAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'together_ai';

  constructor() {
    super('together_ai');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.together.xyz/v1',
      apiKey: (config.apiKey as string) || process.env.TOGETHER_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'mistralai/Mixtral-8x7B-Instruct-v0.1', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'google/gemma-2-27b-it', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'deepseek-ai/DeepSeek-V3', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
