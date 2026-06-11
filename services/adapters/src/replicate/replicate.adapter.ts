import { BaseAdapter } from '../base.adapter.js';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, type HttpMeta } from '@dmr-x/utils';

export class ReplicateAdapter extends BaseAdapter {
  readonly providerId = 'replicate';
  readonly supportedModalities: Modality[] = ['diffusion', 'video', 'music', '3d'];

  private apiKey = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('Replicate API token is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    const response = await this.fetchWithTimeout('https://api.replicate.com/v1/account', {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeoutMs: 5000,
    });
    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`Replicate health check failed: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (!this.supportedModalities.includes(request.modality)) {
      throw new Error(`Replicate does not support modality: ${request.modality}`);
    }

    const start = Date.now();
    const model = request.model || 'stability-ai/sdxl';

    try {
      const input: Record<string, unknown> = {
        prompt: request.prompt,
      };

      if (request.modality === 'diffusion') {
        input.negative_prompt = request.negative_prompt;
        input.width = request.width || 1024;
        input.height = request.height || 1024;
        input.num_inference_steps = request.steps || 50;
        input.guidance_scale = request.cfg_scale || 7.5;
        if (request.diffusion_seed !== undefined) {
          input.seed = request.diffusion_seed;
        }
        if (request.image) {
          input.image = request.image;
        }
      } else if (request.modality === 'video') {
        if (request.image) {
          input.image = request.image;
        }
        if (request.duration !== undefined) {
          input.duration = request.duration;
        }
        if (request.fps !== undefined) {
          input.fps = request.fps;
        }
      } else if (request.modality === 'music') {
        if (request.genre) {
          input.genre = request.genre;
        }
        if (request.duration_seconds !== undefined) {
          input.duration = request.duration_seconds;
        }
        if (request.instruments?.length) {
          input.instruments = request.instruments;
        }
      } else if (request.modality === '3d') {
        if (request.image) {
          input.image = request.image;
          input.images = [request.image];
        }
        if (request.texture_resolution) {
          input.texture_size = request.texture_resolution;
        }
      }

      const createResponse = await this.fetchWithTimeout(
        `https://api.replicate.com/v1/predictions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            Prefer: 'wait',
          },
          body: JSON.stringify({
            version: await this.getModelVersion(model),
            input,
          }),
          timeoutMs: options?.timeoutMs ?? 120000,
        }
      );

      if (!createResponse.ok) {
        const body = await createResponse.text();
        const httpMeta: HttpMeta = { response: createResponse, request: new Request(createResponse.url), body };
        const httpError = createHttpError(createResponse.status, httpMeta);
        throw new ProviderError(`Replicate: ${httpError.message}`, this.providerId, createResponse.status);
      }

      const prediction = await createResponse.json() as any;
      const latencyMs = Date.now() - start;

      // If prediction is still processing, poll for completion
      if (prediction.status !== 'succeeded') {
        const result = await this.pollPrediction(prediction.id, options?.timeoutMs ?? 120000);
        return this.buildResponse(request.modality, prediction.id, model, result);
      }

      return this.buildResponse(request.modality, prediction.id, model, prediction);
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  private buildResponse(
    modality: Modality,
    requestId: string,
    modelId: string,
    prediction: { output?: unknown; status?: string },
  ): UnifiedResponse {
    const base: UnifiedResponse = {
      modality,
      requestId,
      providerId: this.providerId,
      modelId,
      latencyMs: 0,
    };

    const output = prediction.output;

    if (modality === 'diffusion') {
      const outputUrl = Array.isArray(output) ? output[0] : output;
      return {
        ...base,
        images: [{ url: outputUrl }],
      };
    }

    if (modality === 'video') {
      const outputUrl = Array.isArray(output) ? output[0] : output;
      return {
        ...base,
        videos: [{ url: outputUrl }],
      };
    }

    if (modality === '3d') {
      const outputUrl = Array.isArray(output) ? output[0] : output;
      return {
        ...base,
        models3d: [{ url: outputUrl, format: 'glb' }],
      };
    }

    // Music modality
    const outputUrl = Array.isArray(output) ? output[0] : output;
    return {
      ...base,
      audio: { url: outputUrl },
    };
  }

  private async pollPrediction(predictionId: string, timeoutMs: number): Promise<any> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeoutMs) {
      const response = await this.fetchWithTimeout(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const body = await response.text();
        const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
        const httpError = createHttpError(response.status, httpMeta);
        throw new ProviderError(`Replicate poll: ${httpError.message}`, this.providerId, response.status);
      }

      const prediction = await response.json() as { status: string; error?: string; output?: unknown };

      if (prediction.status === 'succeeded') {
        return prediction;
      }

      if (prediction.status === 'failed') {
        throw new ProviderError(`Replicate prediction failed: ${prediction.error}`, this.providerId);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new ProviderError('Replicate prediction timed out', this.providerId, 504);
  }

  private async getModelVersion(model: string): Promise<string> {
    // For well-known models, return hardcoded versions
    const knownModels: Record<string, string> = {
      'stability-ai/sdxl': '39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
      'black-forest-labs/flux-schnell': 'black-forest-labs/flux-schnell',
    };

    if (knownModels[model]) {
      return knownModels[model];
    }

    // Otherwise, fetch the latest version
    const response = await this.fetchWithTimeout(
      `https://api.replicate.com/v1/models/${model}`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 10000,
      }
    );

    if (!response.ok) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new ProviderError(`Replicate: Model not found (${model}): ${httpError.message}`, this.providerId, response.status);
    }

    const data = await response.json() as { latest_version?: { id: string } };
    return data.latest_version?.id || model;
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    const response = await this.execute(request, options);

    let chunkType: StreamChunk['type'] = 'image_partial';
    let chunkData: unknown;

    if (request.modality === 'diffusion') {
      chunkType = 'image_partial';
      chunkData = response.images?.[0];
    } else if (request.modality === 'video') {
      chunkType = 'video_partial';
      chunkData = response.videos?.[0];
    } else {
      chunkType = 'audio_partial';
      chunkData = response.audio;
    }

    yield {
      type: chunkType,
      data: chunkData,
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
      { modelId: 'stability-ai/sdxl', modality: 'diffusion', capabilities: ['text2img', 'img2img'] },
      { modelId: 'black-forest-labs/flux-schnell', modality: 'diffusion', capabilities: ['text2img'] },
      { modelId: 'stability-ai/stable-video-diffusion', modality: 'video', capabilities: ['text2video', 'img2video'] },
      { modelId: 'meta/musicgen', modality: 'music', capabilities: ['text2music'] },
      { modelId: 'firtoz/trellis', modality: '3d', capabilities: ['image-to-3d'] },
      { modelId: 'tencent/hunyuan3d-2', modality: '3d', capabilities: ['text-to-3d', 'image-to-3d'] },
    ];
  }
}
