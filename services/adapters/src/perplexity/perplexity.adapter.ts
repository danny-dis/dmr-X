import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Perplexity AI adapter — search-augmented LLM inference.
 * Uses OpenAI-compatible API at api.perplexity.ai.
 *
 * Env: PERPLEXITY_API_KEY
 * Models: llama-3.1-sonar-large-128k-online, llama-3.1-sonar-small-128k-online, etc.
 */
export class PerplexityAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'perplexity';

  constructor() {
    super('perplexity');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.perplexity.ai',
      apiKey: (config.apiKey as string) || process.env.PERPLEXITY_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'llama-3.1-sonar-large-128k-online', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'llama-3.1-sonar-small-128k-online', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'llama-3.1-sonar-large-128k-chat', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'llama-3.1-sonar-small-128k-chat', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
