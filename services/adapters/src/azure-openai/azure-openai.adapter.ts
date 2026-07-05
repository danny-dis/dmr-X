import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';

import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';
import { createOpenAISSEIterator } from '../stream-normalizer.js';
import { logger } from '@dmr-x/utils';

/**
 * Azure OpenAI adapter.
 *
 * Uses Azure-specific deployment URLs and API versions.
 * Supports chat completions, embeddings, image generation (DALL-E), audio.
 *
 * Env vars:
 *   AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_VERSION,
 *   AZURE_AD_TOKEN (for Azure AD auth)
 */
export class AzureOpenAIAdapter extends BaseAdapter {
  readonly providerId = 'azure_openai';
  readonly supportedModalities: Modality[] = ['llm', 'embedding'];

  private apiKey = '';
  private endpoint = '';
  private apiVersion = '2024-12-01-preview';
  private adToken = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || process.env.AZURE_OPENAI_API_KEY || '';
    this.endpoint = (config.baseUrl as string) || process.env.AZURE_OPENAI_ENDPOINT || '';
    this.apiVersion = (config as any).apiVersion || process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';
    this.adToken = (config as any).adToken || process.env.AZURE_AD_TOKEN || '';
  }

  protected async checkHealth(): Promise<void> {
    if (!this.endpoint) {
      throw new Error('Azure OpenAI endpoint not configured');
    }
  }

  private getDeploymentUrl(deployment: string, action: string): string {
    const base = this.endpoint.replace(/\/+$/, '');
    return `${base}/openai/deployments/${deployment}/${action}?api-version=${this.apiVersion}`;
  }

  private getAuthHeaders(): Record<string, string> {
    if (this.adToken) {
      return { 'Authorization': `Bearer ${this.adToken}` };
    }
    return { 'api-key': this.apiKey };
  }

  private parseModel(model: string): { deployment: string; model: string } {
    // Support "azure_openai/deployment-name" or just "deployment-name"
    const clean = model.replace(/^(azure_openai\/|azure\/)/, '');
    return { deployment: clean, model: clean };
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality === 'llm') {
      return this.executeChat(request, options);
    }
    if (request.modality === 'embedding') {
      return this.executeEmbedding(request, options);
    }

    throw new Error(`Unsupported modality: ${request.modality}`);
  }

  private async executeChat(
    request: UnifiedRequest,
    options?: ExecuteOptions,
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const { deployment } = this.parseModel(request.model || '');
    const url = this.getDeploymentUrl(deployment, 'chat/completions');

    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({
          messages: request.messages,
          tools: request.tools,
          tool_choice: request.tool_choice,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          top_p: request.top_p,
          frequency_penalty: request.frequency_penalty,
          presence_penalty: request.presence_penalty,
          stop: request.stop,
          response_format: request.response_format,
          seed: request.seed,
          stream: false,
        }),
        timeoutMs: options?.timeoutMs ?? 60000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'chat');
    }

    const data: any = await response.json();
    const latencyMs = Date.now() - start;

    return {
      modality: 'llm',
      requestId: data.id || `azure_${Date.now()}`,
      providerId: this.providerId,
      modelId: data.model || request.model || 'unknown',
      message: data.choices?.[0]?.message,
      usage: data.usage,
      finishReason: data.choices?.[0]?.finish_reason,
      latencyMs,
    };
  }

  private async executeEmbedding(
    request: UnifiedRequest,
    options?: ExecuteOptions,
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const { deployment } = this.parseModel(request.model || '');
    const url = this.getDeploymentUrl(deployment, 'embeddings');

    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({
          input: request.input,
          model: request.model,
          encoding_format: request.encoding_format,
          dimensions: request.dimensions,
        }),
        timeoutMs: options?.timeoutMs ?? 30000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'embedding');
    }

    const data: any = await response.json();
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `azure_emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: data.model || request.model || 'unknown',
      embeddings: data.data?.map((d: any) => d.embedding),
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    const { deployment } = this.parseModel(request.model || '');
    const url = this.getDeploymentUrl(deployment, 'chat/completions');

    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({
          messages: request.messages,
          tools: request.tools,
          tool_choice: request.tool_choice,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          stream: true,
        }),
        signal: options?.signal,
        timeoutMs: options?.timeoutMs ?? 120000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'stream');
    }

    yield* createOpenAISSEIterator(response, { signal: options?.signal });
  }

  async listModels(): Promise<ModelInfo[]> {
    this.assertInitialized();
    const url = `${this.endpoint.replace(/\/+$/, '')}/openai/models?api-version=${this.apiVersion}`;

    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        headers: this.getAuthHeaders(),
      });
    } catch (error) {
      logger.debug({ err: error, providerId: this.providerId }, 'Failed to list models');
      return [];
    }

    const data: any = await response.json();
    return (data.data || []).map((model: any) => ({
      modelId: model.id,
      modality: 'llm' as Modality,
      capabilities: [],
    }));
  }
}
