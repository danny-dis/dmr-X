import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
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
