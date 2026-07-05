import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Groq adapter — ultra-low latency LLM inference.
 * Uses OpenAI-compatible API at api.groq.com/openai/v1.
 *
 * Env: GROQ_API_KEY
 * Models: llama-3.3-70b-versatile, mixtral-8x7b-32768, gemma2-9b-it, whisper-large-v3
 */
export class GroqAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'groq';

  constructor() {
    super('groq');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize({
      ...config,
      baseUrl: (config.baseUrl as string) || 'https://api.groq.com/openai/v1',
      apiKey: (config.apiKey as string) || process.env.GROQ_API_KEY || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'llama-3.3-70b-versatile', modality: 'llm', capabilities: ['chat', 'tools'] },
      { modelId: 'llama-3.1-8b-instant', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'mixtral-8x7b-32768', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'gemma2-9b-it', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'whisper-large-v3', modality: 'llm', capabilities: ['audio'] },
    ];
  }
}
