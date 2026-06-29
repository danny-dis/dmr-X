import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * LM Studio adapter — local model inference.
 * Uses OpenAI-compatible API.
 *
 * Env: LM_STUDIO_API_BASE (default: http://localhost:1234/v1)
 */
export class LMStudioAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'lm_studio';

  constructor() {
    super('lm_studio');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || process.env.LM_STUDIO_API_BASE || 'http://localhost:1234/v1',
      apiKey: (config.apiKey as string) || 'lm-studio',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return super.listModels();
  }
}
