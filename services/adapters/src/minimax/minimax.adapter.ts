import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * MiniMax adapter — Chinese AI lab (稀宇科技, Shanghai).
 * Uses OpenAI-compatible API at api.minimax.io/v1.
 *
 * MiniMax M3 is the flagship: $0.30/$1.20 per MTok (50% promo), 1M context.
 * Also offers speech, video, music, and image APIs.
 * Prompt caching: $0.06/MTok for cached reads.
 *
 * Env: MINIMAX_API_KEY
 */
export class MiniMaxAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'minimax';

  constructor() {
    super('minimax');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.minimax.io/v1',
      apiKey: (config.apiKey as string) || process.env.MINIMAX_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      // M3 series — flagship (50% promo: $0.30/$1.20 per MTok)
      { modelId: 'MiniMax-M3', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      // M2.7 series — strong general purpose
      { modelId: 'MiniMax-M2.7', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      { modelId: 'MiniMax-M2.7-highspeed', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      // M2.5 series — legacy but still supported
      { modelId: 'MiniMax-M2.5', modality: 'llm', capabilities: ['chat', 'tool_use'] },
      { modelId: 'MiniMax-M2.5-highspeed', modality: 'llm', capabilities: ['chat'] },
      // M2.1 series — older generation
      { modelId: 'MiniMax-M2.1', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'MiniMax-M2.1-highspeed', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
