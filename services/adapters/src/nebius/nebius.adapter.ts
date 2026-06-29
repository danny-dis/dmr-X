import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Nebius AI Studio adapter.
 * Uses OpenAI-compatible API at api.studio.nebius.ai/v1.
 *
 * Env: NEBIUS_API_KEY
 */
export class NebiusAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'nebius';

  constructor() {
    super('nebius');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.studio.nebius.ai/v1',
      apiKey: (config.apiKey as string) || process.env.NEBIUS_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'meta-llama/Meta-Llama-3.1-405B-Instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'meta-llama/Meta-Llama-3.1-70B-Instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'mistralai/Mistral-Nemo-Instruct-2407', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
