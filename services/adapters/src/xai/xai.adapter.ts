import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * xAI (Grok) adapter.
 * Uses OpenAI-compatible API at api.x.ai/v1.
 *
 * Env: XAI_API_KEY
 * Models: grok-2, grok-2-vision, grok-3, grok-3-mini
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
      { modelId: 'grok-2', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'grok-2-vision', modality: 'llm', capabilities: ['chat', 'vision'] },
      { modelId: 'grok-3', modality: 'llm', capabilities: ['chat', 'vision', 'tools'] },
      { modelId: 'grok-3-mini', modality: 'llm', capabilities: ['chat', 'reasoning'] },
    ];
  }
}
