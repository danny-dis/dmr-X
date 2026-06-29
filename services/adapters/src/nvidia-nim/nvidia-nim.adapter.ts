import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * NVIDIA NIM adapter.
 * Uses OpenAI-compatible API at integrate.api.nvidia.com/v1.
 *
 * Env: NVIDIA_API_KEY
 */
export class NVIDIANIMAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'nvidia_nim';

  constructor() {
    super('nvidia_nim');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://integrate.api.nvidia.com/v1',
      apiKey: (config.apiKey as string) || process.env.NVIDIA_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'nvidia/llama-3.1-nemotron-70b-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'nvidia/llama-3.1-8b-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'meta/llama-3.1-405b-instruct', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
