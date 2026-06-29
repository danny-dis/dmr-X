import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * SambaNova adapter — fast inference for open-source models.
 * Uses OpenAI-compatible API at api.sambanova.ai/v1.
 *
 * Env: SAMBA_API_KEY
 * Models: Meta-Llama-3.1, DeepSeek, etc.
 */
export class SambanovaAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'sambanova';

  constructor() {
    super('sambanova');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.sambanova.ai/v1',
      apiKey: (config.apiKey as string) || process.env.SAMBA_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'Meta-Llama-3.1-8B-Instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'Meta-Llama-3.1-70B-Instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'DeepSeek-R1-Distill-Llama-70B', modality: 'llm', capabilities: ['chat', 'reasoning'] },
    ];
  }
}
