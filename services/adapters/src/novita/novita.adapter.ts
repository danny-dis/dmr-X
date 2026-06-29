import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Novita AI adapter.
 * Uses OpenAI-compatible API at api.novita.ai/v3/openai.
 *
 * Env: NOVITA_API_KEY
 */
export class NovitaAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'novita';

  constructor() {
    super('novita');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.novita.ai/v3/openai',
      apiKey: (config.apiKey as string) || process.env.NOVITA_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'meta-llama/llama-3.1-70b-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'meta-llama/llama-3.1-8b-instruct', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
