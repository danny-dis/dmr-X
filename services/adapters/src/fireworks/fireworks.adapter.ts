import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Fireworks AI adapter — fast open-source model inference.
 * Uses OpenAI-compatible API at api.fireworks.ai/inference/v1.
 *
 * Env: FIREWORKS_API_KEY
 * Models: accounts/fireworks/models/*, meta-llama, mistralai, etc.
 */
export class FireworksAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'fireworks_ai';

  constructor() {
    super('fireworks_ai');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.fireworks.ai/inference/v1',
      apiKey: (config.apiKey as string) || process.env.FIREWORKS_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'accounts/fireworks/models/llama-v3p3-70b-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'accounts/fireworks/models/mixtral-8x7b-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'accounts/fireworks/models/deepseek-r1', modality: 'llm', capabilities: ['chat', 'reasoning'] },
    ];
  }
}
