import type { ProviderConfig, ModelInfo } from '../adapter.interface.js';
import { GenericOpenAIAdapter } from '../generic-openai/generic-openai.adapter.js';

/**
 * Databricks adapter — Mosaic AI model serving.
 * Uses OpenAI-compatible API.
 *
 * Env: DATABRICKS_HOST, DATABRICKS_TOKEN
 * Models: Any model deployed on Databricks
 */
export class DatabricksAdapter extends GenericOpenAIAdapter {
  readonly providerId = 'databricks';

  constructor() {
    super('databricks');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    const host = (config.baseUrl as string) || process.env.DATABRICKS_HOST || '';
    const baseUrl = host ? `${host.replace(/\/+$/, '')}/serving-endpoints` : '';
    await super.initialize({
      ...config,
      baseUrl: baseUrl || 'https://localhost',
      apiKey: (config.apiKey as string) || process.env.DATABRICKS_TOKEN || '',
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'databricks-dbrx-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'databricks-meta-llama-3.1-70b-instruct', modality: 'llm', capabilities: ['chat'] },
      { modelId: 'databricks-mixtral-8x7b-instruct', modality: 'llm', capabilities: ['chat'] },
    ];
  }
}
