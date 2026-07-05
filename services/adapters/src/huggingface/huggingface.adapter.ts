import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Hugging Face Inference API adapter.
 * Supports the Inference API (serverless) and dedicated Inference Endpoints.
 *
 * Env: HUGGINGFACE_API_KEY, HUGGINGFACE_API_BASE (optional, for dedicated endpoints)
 * Models: Any model on Hugging Face Hub
 */
export class HuggingFaceAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'huggingface';

  // HuggingFace free Inference API has 30-60s cold starts.
  // Override retry config with longer timeouts and more retries:
  // 2s initial, 30s max, 2x exponent, 2 minute total budget.
  protected retryConfig = {
    strategy: 'backoff' as const,
    backoff: {
      initialInterval: 2000,
      maxInterval: 30000,
      exponent: 2,
      maxElapsedTime: 120000,
    },
    retryConnectionErrors: true,
  };

  constructor() {
    super('huggingface');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || process.env.HUGGINGFACE_API_BASE || 'https://api-inference.huggingface.co/v1',
      apiKey: (config.apiKey as string) || process.env.HUGGINGFACE_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'meta-llama/Llama-3.3-70B-Instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'mistralai/Mistral-7B-Instruct-v0.3', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'Qwen/Qwen2.5-72B-Instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'microsoft/DialoGPT-large', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
