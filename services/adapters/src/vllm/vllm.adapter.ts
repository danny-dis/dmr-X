import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * vLLM adapter — self-hosted vLLM server.
 * Uses OpenAI-compatible API at the configured base URL.
 *
 * Env: VLLM_API_BASE (e.g., http://localhost:8000/v1)
 * Models: Any model deployed on vLLM
 */
export class VLLMAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'vllm';

  constructor() {
    super('vllm');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || process.env.VLLM_API_BASE || 'http://localhost:8000/v1',
      apiKey: (config.apiKey as string) || 'none',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    // vLLM models are dynamic, list via API
    return super.listModels();
  }
}
