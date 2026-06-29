import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Volcengine (ByteDance) adapter.
 * Uses OpenAI-compatible API.
 *
 * Env: VOLCENGINE_API_KEY, VOLCENGINE_API_BASE
 */
export class VolcengineAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'volcengine';

  constructor() {
    super('volcengine');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || process.env.VOLCENGINE_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: (config.apiKey as string) || process.env.VOLCENGINE_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'doubao-pro-256k', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'doubao-pro-128k', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
