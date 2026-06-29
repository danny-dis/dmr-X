import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Dashscope (Alibaba Cloud) adapter.
 * Uses OpenAI-compatible API at dashscope.aliyuncs.com/compatible-mode/v1.
 *
 * Env: DASHSCOPE_API_KEY
 */
export class DashscopeAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'dashscope';

  constructor() {
    super('dashscope');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: (config.apiKey as string) || process.env.DASHSCOPE_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'qwen-max', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'qwen-plus', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'qwen-turbo', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'qwen-long', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
