import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * xAI (Grok) adapter.
 * Uses OpenAI-compatible API at api.x.ai/v1.
 *
 * Grok 4.1 Fast is the cheapest frontier model at $0.20/$0.50 per MTok.
 * Grok 4 offers top-tier reasoning at $3/$15 per MTok.
 * Automatic prompt caching on repeated requests (50-75% cost reduction).
 *
 * Env: XAI_API_KEY
 */
export class XAIAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'xai';

  constructor() {
    super('xai');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.x.ai/v1',
      apiKey: (config.apiKey as string) || process.env.XAI_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      // Grok 4.1 series — cheapest frontier ($0.20/$0.50 per MTok)
      { modelId: 'grok-4-1-fast-reasoning', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      { modelId: 'grok-4-1-fast-non-reasoning', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      // Grok 4 — flagship reasoning ($3/$15 per MTok)
      { modelId: 'grok-4', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use', 'reasoning'] },
      // Grok Code — optimized for coding ($0.20/$1.50 per MTok)
      { modelId: 'grok-code-fast-1', modality: 'llm', capabilities: ['chat', 'tool_use', 'reasoning'] },
      // Legacy models
      { modelId: 'grok-2', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'grok-2-vision', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'grok-3', modality: 'llm', capabilities: ['chat', 'vision', 'tool_use'] },
      { modelId: 'grok-3-mini', modality: 'llm', capabilities: ['chat', 'reasoning'] },
    ];
  }
}
