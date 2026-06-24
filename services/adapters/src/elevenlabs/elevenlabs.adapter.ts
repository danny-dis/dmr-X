import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, type HttpMeta } from '@dmr-x/utils';

import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';

export class ElevenLabsAdapter extends BaseAdapter {
  readonly providerId = 'elevenlabs';
  readonly supportedModalities: Modality[] = ['audio_tts'];

  private apiKey = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    const response = await this.fetchWithTimeout(
      'https://api.elevenlabs.io/v1/user',
      {
        headers: { 'xi-api-key': this.apiKey },
        timeoutMs: 5000,
      }
    );
    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`ElevenLabs health check failed: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality !== 'audio_tts') {
      throw new Error(`ElevenLabs only supports audio_tts modality, got: ${request.modality}`);
    }

    const start = Date.now();
    const voiceId = this.mapVoice(request.voice || 'rachel');

    const response = await this.fetchWithTimeout(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text: request.prompt || request.input || '',
          model_id: request.model || 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: request.speed || 1.0,
          },
        }),
        timeoutMs: options?.timeoutMs ?? 30000,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`ElevenLabs: ${httpError.message}`, this.providerId, response.status);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const latencyMs = Date.now() - start;

    return {
      modality: 'audio_tts',
      requestId: `eleven_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'eleven_monolingual_v1',
      audio: {
        b64_json: audioBuffer.toString('base64'),
        format: 'mp3',
      },
      latencyMs,
    };
  }

  private mapVoice(voice: string): string {
    const voiceMap: Record<string, string> = {
      rachel: '21m00Tcm4TlvDq8ikWAM',
      adam: 'pNInz6obpgDQGcFmaJgB',
      sam: 'yoZ06aMxZJJ28mfd3POQ',
    };
    return voiceMap[voice.toLowerCase()] || voice;
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    const response = await this.execute(request, options);
    yield {
      type: 'audio_chunk',
      data: response.audio,
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
      { modelId: 'eleven_monolingual_v1', modality: 'audio_tts', capabilities: ['tts'] },
      { modelId: 'eleven_multilingual_v2', modality: 'audio_tts', capabilities: ['tts', 'multilingual'] },
    ];
  }
}
