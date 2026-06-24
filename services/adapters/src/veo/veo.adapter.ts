import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, type HttpMeta } from '@dmr-x/utils';

import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';

/**
 * Google Veo adapter — supports Veo 3.1 and Veo 3.1 Fast video generation.
 *
 * Veo is accessed via the Gemini API (same GOOGLE_API_KEY).
 * Uses long-running operations (LROs):
 *   1. POST /v1beta/models/{model}:generateVideos → returns { name: "operations/..." }
 *   2. GET  /v1beta/{operationName} → polls until done: true
 *   3. On completion, response contains video URI
 */
export class VeoAdapter extends BaseAdapter {
  readonly providerId = 'veo';
  readonly supportedModalities: Modality[] = ['video'];

  private apiKey = '';

  /** Map DMR-X model IDs to Veo model names */
  private static MODEL_MAP: Record<string, string> = {
    'veo-3.1': 'veo-3.1-generate-001',
    'veo-3.1-fast': 'veo-3.1-fast-generate-001',
    'veo-3': 'veo-3-generate-001',
  };

  private getBaseUrl(): string {
    return 'https://generativelanguage.googleapis.com/v1beta';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || (config.accessToken as string) || '';
    if (!this.apiKey) {
      throw new Error('Google API key is required (GOOGLE_API_KEY)');
    }
  }

  protected async checkHealth(): Promise<void> {
    // Simple health check: list models endpoint
    const response = await this.fetchWithTimeout(
      `${this.getBaseUrl()}/models?key=${this.apiKey}`,
      { timeoutMs: 5000 },
    );
    if (!response.ok && response.status >= 500) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`Veo health check failed: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality !== 'video') {
      throw new Error(`Veo only supports video modality, got: ${request.modality}`);
    }

    const start = Date.now();
    const modelId = request.model || 'veo-3.1';
    const veoModel = VeoAdapter.MODEL_MAP[modelId] || modelId;

    try {
      const input = this.buildInput(request);

      // Step 1: Submit the generation request
      const createResponse = await this.fetchWithTimeout(
        `${this.getBaseUrl()}/models/${veoModel}:generateVideos?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          timeoutMs: options?.timeoutMs ?? 30000,
        },
      );

      if (!createResponse.ok) {
        const errBody = await createResponse.text();
        const httpMeta: HttpMeta = { response: createResponse, request: new Request(createResponse.url), body: errBody };
        const httpError = createHttpError(createResponse.status, httpMeta);
        throw new ProviderError(`Google Veo: ${httpError.message}`, this.providerId, createResponse.status);
      }

      const createData = await createResponse.json() as {
        name: string;
        done?: boolean;
        response?: { video?: { uri?: string; gcsUri?: string } };
      };

      // If already done (unlikely but possible for fast models)
      if (createData.done && createData.response?.video) {
        return this.buildResponse(modelId, createData.name, createData, Date.now() - start);
      }

      // Step 2: Poll for completion using LRO pattern
      const timeoutMs = options?.timeoutMs ?? 600000; // 10 min default
      const result = await this.pollOperation(createData.name, timeoutMs);
      return this.buildResponse(modelId, createData.name, result, Date.now() - start);
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  private buildInput(request: UnifiedRequest): Record<string, unknown> {
    const input: Record<string, unknown> = {};

    if (request.prompt) {
      input.prompt = request.prompt;
    }

    // Config block for Veo-specific parameters
    const config: Record<string, unknown> = {};

    if (request.aspect_ratio) {
      config.aspectRatio = request.aspect_ratio;
    }

    if (request.duration) {
      // Veo uses duration in seconds (max 8s for veo-3.1, 5s for veo-3.1-fast)
      config.duration = request.model?.includes('fast')
        ? Math.min(request.duration, 5)
        : Math.min(request.duration, 8);
    }

    if (request.resolution) {
      config.resolution = request.resolution;
    }

    // Reference images for img2video / character consistency
    if (request.image) {
      config.image = { gcsUri: request.image };
    }

    if (request.reference_images?.length) {
      config.referenceImages = request.reference_images.map((url) => ({ gcsUri: url }));
    }

    // Last frame for first_and_last_frame mode
    if (request.last_frame_image) {
      config.lastFrame = { gcsUri: request.last_frame_image };
    }

    // Negative prompt
    if (request.negative_prompt) {
      config.negativePrompt = request.negative_prompt;
    }

    // Person generation control (Veo-specific)
    if (request.metadata?.personGeneration) {
      config.personGeneration = request.metadata.personGeneration;
    }

    // Safety settings
    if (request.metadata?.safetySettings) {
      config.safetySettings = request.metadata.safetySettings;
    }

    if (Object.keys(config).length > 0) {
      input.config = config;
    }

    return input;
  }

  private async pollOperation(
    operationName: string,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const pollInterval = 3000;

    while (Date.now() - startTime < timeoutMs) {
      const response = await this.fetchWithTimeout(
        `${this.getBaseUrl()}/${operationName}?key=${this.apiKey}`,
        {
          timeoutMs: 15000,
        },
      );

      if (!response.ok) {
        const errBody = await response.text();
        const httpMeta: HttpMeta = { response, request: new Request(response.url), body: errBody };
        const httpError = createHttpError(response.status, httpMeta);
        throw new ProviderError(`Google Veo poll: ${httpError.message}`, this.providerId, response.status);
      }

      const data = await response.json() as {
        name: string;
        done: boolean;
        response?: { video?: { uri?: string; gcsUri?: string } };
        error?: { code?: number; message?: string };
      };

      if (data.done) {
        if (data.error) {
          throw new ProviderError(
            `Google Veo generation failed: ${data.error.message || 'Unknown error'}`,
            this.providerId,
            data.error.code,
          );
        }
        return data as unknown as Record<string, unknown>;
      }

      // Exponential backoff
      const elapsed = Date.now() - startTime;
      const interval = Math.min(
        pollInterval * Math.pow(1.5, Math.floor(elapsed / 15000)),
        15000,
      );
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new ProviderError('Google Veo generation timed out', this.providerId, 504);
  }

  private buildResponse(
    modelId: string,
    operationName: string,
    data: Record<string, unknown>,
    latencyMs: number,
  ): UnifiedResponse {
    const response = data.response as { video?: { uri?: string; gcsUri?: string } } | undefined;
    const videoUri = response?.video?.uri || response?.video?.gcsUri;

    return {
      modality: 'video',
      requestId: operationName,
      providerId: this.providerId,
      modelId,
      videos: [{
        url: videoUri,
      }],
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    // Video generation is not streamable — yield the final result
    const response = await this.execute(request, options);
    yield {
      type: 'video_partial',
      data: response.videos?.[0],
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
      {
        modelId: 'veo-3.1',
        modality: 'video',
        capabilities: ['text2video', 'img2video', 'native_audio', 'reference_images', 'video_extend', 'first_last_frame', '4k_output'],
      },
      {
        modelId: 'veo-3.1-fast',
        modality: 'video',
        capabilities: ['text2video', 'img2video', 'native_audio', 'reference_images'],
      },
      {
        modelId: 'veo-3',
        modality: 'video',
        capabilities: ['text2video', 'img2video', 'native_audio'],
      },
    ];
  }
}
