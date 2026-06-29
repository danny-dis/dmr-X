import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Moonshot (Kimi) adapter — Chinese LLM.
 * Uses OpenAI-compatible API at api.moonshot.cn/v1.
 *
 * Env: MOONSHOT_API_KEY
 */
export class MoonshotAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'moonshot';

  constructor() {
    super('moonshot');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.moonshot.cn/v1',
      apiKey: (config.apiKey as string) || process.env.MOONSHOT_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'moonshot-v1-8k', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'moonshot-v1-32k', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'moonshot-v1-128k', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
