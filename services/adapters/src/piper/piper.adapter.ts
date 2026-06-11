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
} from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, logger, type HttpMeta } from '@dmr-x/utils';

/**
 * Piper TTS adapter
 * Local neural text-to-speech
 */
export class PiperAdapter extends BaseAdapter {
  readonly providerId = 'piper';
  readonly supportedModalities: Modality[] = ['audio_tts'];

  protected async checkHealth(): Promise<void> {
    const baseUrl = this.config.baseUrl || 'http://localhost:5000';
    const response = await this.fetchWithTimeout(`${baseUrl}/health`, {
      timeoutMs: 5000,
    });
    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`Piper health check failed: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    const baseUrl = this.config.baseUrl || 'http://localhost:5000';
    const start = Date.now();

    try {
      if (request.modality !== 'audio_tts') {
        throw new Error(`Unsupported modality: ${request.modality}`);
      }

      const text = typeof request.input === 'string' ? request.input : '';
      const voice = (request as any).voice || 'default';

      const response = await this.fetchWithTimeout(`${baseUrl}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice,
        }),
        timeoutMs: options?.timeoutMs ?? 30000,
      });

      if (!response.ok) {
        const body = await response.text();
        const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
        const httpError = createHttpError(response.status, httpMeta);
        throw new ProviderError(`Piper TTS: ${httpError.message}`, this.providerId, response.status);
      }

      const audioBuffer = await response.arrayBuffer();
      const latencyMs = Date.now() - start;

      return {
        modality: 'audio_tts',
        requestId: `piper_tts_${Date.now()}`,
        providerId: this.providerId,
        modelId: request.model || 'piper-tts',
        audio: {
          b64_json: Buffer.from(audioBuffer).toString('base64'),
          format: 'wav',
        },
        latencyMs,
      };
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    // Piper doesn't support streaming, yield complete result
    const result = await this.execute(request, options);
    yield { type: 'token', data: { content: JSON.stringify(result) }, index: 0 };
    yield { type: 'done', data: {}, index: 1 };
  }

  async listModels(): Promise<ModelInfo[]> {
    this.assertInitialized();
    const baseUrl = this.config.baseUrl || 'http://localhost:5000';
    const response = await this.fetchWithTimeout(`${baseUrl}/api/voices`);

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as Record<string, unknown>;
    const voices = (data.voices as string[]) || ['default'];
    
    return voices.map(voice => ({
      modelId: voice,
      modality: 'audio_tts' as Modality,
      capabilities: ['tts'],
    }));
  }
}