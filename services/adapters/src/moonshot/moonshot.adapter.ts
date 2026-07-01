import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Moonshot (Kimi) adapter — Chinese LLM.
 * Uses OpenAI-compatible API at api.moonshot.cn/v1.
 *
 * Supports Kimi K2 series (1T MoE, 32B active) and legacy Moonshot V1.
 * Kimi K2 offers 128K-2M context at $0.15-$0.60/MTok input.
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
      // Kimi K2 series — flagship MoE models
      { modelId: 'kimi-k2', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'json_mode', 'reasoning'] },
      { modelId: 'kimi-k2.5', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'json_mode', 'reasoning'] },
      { modelId: 'kimi-k2-thinking', modality: 'llm', capabilities: ['chat', 'reasoning', 'tool_use'] },
      { modelId: 'kimi-k2-turbo-preview', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'json_mode'] },
      { modelId: 'kimi-k2-thinking-turbo', modality: 'llm', capabilities: ['chat', 'reasoning', 'tool_use'] },
      // Legacy Moonshot V1 models
      { modelId: 'moonshot-v1-8k', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'moonshot-v1-32k', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'moonshot-v1-128k', modality: 'llm', capabilities: ['chat'] },
      // Auto-routing to newest model
      { modelId: 'kimi-latest', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'json_mode'] },
    ];
  }
}
