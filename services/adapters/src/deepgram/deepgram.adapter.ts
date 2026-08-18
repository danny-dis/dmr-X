import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, type HttpMeta } from '@dmr-x/utils';

import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';

export class DeepgramAdapter extends BaseAdapter {
  readonly providerId = 'deepgram';
  readonly supportedModalities: Modality[] = ['audio_stt'];

  private apiKey = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('Deepgram API key is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    const response = await this.fetchWithTimeout(
      'https://api.deepgram.com/v1/projects',
      {
        headers: { Authorization: `Token ${this.apiKey}` },
        timeoutMs: 5000,
      }
    );
    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`Deepgram health check failed: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality !== 'audio_stt') {
      throw new Error(`Deepgram only supports audio_stt modality, got: ${request.modality}`);
    }

    const start = Date.now();
    const audioData = request.audio || request.metadata?.audioData;

    if (!audioData) {
      throw new ProviderError('No audio data provided', this.providerId, 400);
    }

    const audioBuffer = typeof audioData === 'string'
      ? Buffer.from(audioData, 'base64')
      : audioData;

    const response = await this.fetchWithTimeout(
      'https://api.deepgram.com/v1/listen',
      {
        method: 'POST',
        headers: {
          'Content-Type': request.audio_format || 'audio/wav',
          Authorization: `Token ${this.apiKey}`,
        },
        body: audioBuffer as unknown as string,
        timeoutMs: options?.timeoutMs ?? 120000,
        signal: options?.signal,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Deepgram: ${httpError.message}`, this.providerId, response.status);
    }

    const data = await response.json() as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'audio_stt',
      requestId: `deepgram_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'nova-2',
      message: {
        role: 'assistant',
        content: (data.results as Record<string, any>)?.channels?.[0]?.alternatives?.[0]?.transcript || '',
      },
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    const response = await this.execute(request, options);
    yield {
      type: 'token',
      data: { content: response.message?.content },
      index: 0,
    };
    yield {
      type: 'done',
      data: {},
      index: 1,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'nova-2', modality: 'audio_stt', capabilities: ['stt', 'multilingual'] },
      { modelId: 'nova', modality: 'audio_stt', capabilities: ['stt'] },
      { modelId: 'whisper-large', modality: 'audio_stt', capabilities: ['stt'] },
    ];
  }
}
