import { BaseAdapter } from '../base.adapter.js';
import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
  TokenStreamChunk,
  DoneStreamChunk,
} from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createOpenAISSEIterator } from '../stream-normalizer.js';

export class OpenAIAdapter extends BaseAdapter {
  readonly providerId = 'openai';
  readonly supportedModalities: Modality[] = ['llm', 'embedding', 'diffusion', 'audio_speech', 'audio_transcription'];

  private apiKey = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    const response = await this.fetchWithTimeout(`${this.config.baseUrl || 'https://api.openai.com'}/v1/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeoutMs: 5000,
    });
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    const baseUrl = this.config.baseUrl || 'https://api.openai.com';
    const start = Date.now();

    if (request.modality === 'llm') {
      return this.executeChat(baseUrl, request, options);
    }

    if (request.modality === 'embedding') {
      return this.executeEmbedding(baseUrl, request, options);
    }

    if (request.modality === 'diffusion') {
      return this.executeImage(baseUrl, request, options);
    }

    throw new Error(`Unsupported modality: ${request.modality}`);
  }

  private async executeChat(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const response = await this.fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || 'gpt-4o-mini',
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
        n: request.n,
        stream: false,
      }),
      timeoutMs: options?.timeoutMs ?? 60000,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`OpenAI error: ${error}`, this.providerId, response.status);
    }

    const data = await response.json();
    const latencyMs = Date.now() - start;

    return {
      modality: 'llm',
      requestId: data.id,
      providerId: this.providerId,
      modelId: data.model,
      message: data.choices?.[0]?.message,
      usage: data.usage,
      finishReason: data.choices?.[0]?.finish_reason,
      latencyMs,
    };
  }

  private async executeEmbedding(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const response = await this.fetchWithTimeout(`${baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || 'text-embedding-3-small',
        input: request.input,
        encoding_format: request.encoding_format,
        dimensions: request.dimensions,
      }),
      timeoutMs: options?.timeoutMs ?? 30000,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`OpenAI embedding error: ${error}`, this.providerId, response.status);
    }

    const data = await response.json();
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: data.model,
      embeddings: data.data?.map((d: any) => d.embedding),
      latencyMs,
    };
  }

  private async executeImage(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const response = await this.fetchWithTimeout(`${baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || 'dall-e-3',
        prompt: request.prompt,
        n: request.n || 1,
        size: `${request.width || 1024}x${request.height || 1024}`,
        quality: request.metadata?.quality || 'standard',
        style: request.style || 'vivid',
        response_format: request.metadata?.responseFormat || 'url',
      }),
      timeoutMs: options?.timeoutMs ?? 120000,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`OpenAI image error: ${error}`, this.providerId, response.status);
    }

    const data = await response.json();
    const latencyMs = Date.now() - start;

    return {
      modality: 'diffusion',
      requestId: `img_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'dall-e-3',
      images: data.data,
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    const baseUrl = this.config.baseUrl || 'https://api.openai.com';
    const response = await this.fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || 'gpt-4o-mini',
        messages: request.messages,
        tools: request.tools,
        tool_choice: request.tool_choice,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: true,
      }),
      timeoutMs: options?.timeoutMs ?? 120000,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`OpenAI stream error: ${error}`, this.providerId, response.status);
    }

    yield* createOpenAISSEIterator(response);
  }

  async listModels(): Promise<ModelInfo[]> {
    this.assertInitialized();
    const baseUrl = this.config.baseUrl || 'https://api.openai.com';
    const response = await this.fetchWithTimeout(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return (data.data || []).map((model: any) => ({
      modelId: model.id,
      modality: 'llm' as Modality,
      capabilities: [],
    }));
  }
}
