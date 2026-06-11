import { BaseAdapter } from '../base.adapter.js';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, type HttpMeta } from '@dmr-x/utils';

/**
 * FAL.ai adapter — supports Seedance 2.0, Wan 2.7, Kling 3.0, and other
 * video generation models hosted on FAL.
 *
 * FAL uses a simple async pattern:
 *   1. POST https://fal.run/{model} → returns { request_id }
 *   2. GET  https://fal.run/requests/{request_id}/status → polls until done
 *   3. GET  https://fal.run/requests/{request_id} → returns result with video URL
 */
export class FalAdapter extends BaseAdapter {
  readonly providerId = 'fal';
  readonly supportedModalities: Modality[] = ['video', 'diffusion', '3d'];

  private apiKey = '';

  /** Map DMR-X model IDs to FAL model endpoints */
  private static MODEL_MAP: Record<string, string> = {
    // Seedance 2.0
    'seedance-2.0': 'bytedance/seedance-2.0/text-to-video',
    'seedance-2.0/text-to-video': 'bytedance/seedance-2.0/text-to-video',
    'seedance-2.0/image-to-video': 'bytedance/seedance-2.0/image-to-video',
    'seedance-2.0/reference-to-video': 'bytedance/seedance-2.0/reference-to-video',
    'seedance-2.0-fast': 'bytedance/seedance-2.0/fast/text-to-video',
    'seedance-2.0-fast/text-to-video': 'bytedance/seedance-2.0/fast/text-to-video',
    'seedance-2.0-fast/image-to-video': 'bytedance/seedance-2.0/fast/image-to-video',
    'seedance-2.0-fast/reference-to-video': 'bytedance/seedance-2.0/fast/reference-to-video',

    // Wan 2.7
    'wan-2.7': 'fal-ai/wan/v2.7/text-to-video',
    'wan-2.7/text-to-video': 'fal-ai/wan/v2.7/text-to-video',
    'wan-2.7/image-to-video': 'fal-ai/wan/v2.7/image-to-video',
    'wan-2.7/reference-to-video': 'fal-ai/wan/v2.7/reference-to-video',
    'wan-2.7/edit-video': 'fal-ai/wan/v2.7/edit-video',

    // Kling 3.0
    'kling-v3': 'fal-ai/kling-v3/text-to-video',
    'kling-v3/text-to-video': 'fal-ai/kling-v3/text-to-video',
    'kling-v3/image-to-video': 'fal-ai/kling-v3/image-to-video',
  };

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('FAL API key is required (FAL_KEY)');
    }
  }

  protected async checkHealth(): Promise<void> {
    const response = await this.fetchWithTimeout('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ prompt: 'test' }),
      timeoutMs: 10000,
    });
    // Even a 4xx means the API is reachable
    if (!response.ok && response.status >= 500) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`FAL health check failed: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (!this.supportedModalities.includes(request.modality)) {
      throw new Error(`FAL does not support modality: ${request.modality}`);
    }

    const start = Date.now();
    const modelId = request.model || 'seedance-2.0';
    const falEndpoint = FalAdapter.MODEL_MAP[modelId] || modelId;

    try {
      const input = this.buildInput(request, falEndpoint);

      // Step 1: Submit the generation request
      const createResponse = await this.fetchWithTimeout(`https://fal.run/${falEndpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(input),
        timeoutMs: options?.timeoutMs ?? 30000,
      });

      if (!createResponse.ok) {
        const body = await createResponse.text();
        const httpMeta: HttpMeta = { response: createResponse, request: new Request(createResponse.url), body };
        const httpError = createHttpError(createResponse.status, httpMeta);
        throw new ProviderError(`FAL: ${httpError.message}`, this.providerId, createResponse.status);
      }

      const createData = await createResponse.json() as { request_id?: string; status?: string; images?: unknown; video?: unknown; data?: unknown };
      const requestId = createData.request_id;

      // If no request_id, the result may be inline (synchronous mode)
      if (!requestId) {
        return this.buildResponse(request.modality, 'fal-inline', modelId, createData, Date.now() - start);
      }

      // Step 2: Poll for completion
      const result = await this.pollRequest(requestId, options?.timeoutMs ?? 300000);
      return this.buildResponse(request.modality, requestId, modelId, result, Date.now() - start);
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  private buildInput(request: UnifiedRequest, falEndpoint: string): Record<string, unknown> {
    const input: Record<string, unknown> = {};

    if (request.prompt) {
      input.prompt = request.prompt;
    }

    // Seedance 2.0 models
    if (falEndpoint.includes('seedance')) {
      if (request.resolution) input.resolution = request.resolution;
      if (request.duration) input.duration = String(request.duration);
      if (request.aspect_ratio) input.aspect_ratio = request.aspect_ratio;
      if (request.generate_audio !== undefined) input.generate_audio = request.generate_audio;
      if (request.seed !== undefined && request.seed !== null) input.seed = request.seed;
      if (request.negative_prompt) input.negative_prompt = request.negative_prompt;

      // Reference images (up to 9)
      if (request.reference_images?.length) {
        input.image_urls = request.reference_images;
      } else if (request.image) {
        // Single image for img2video
        input.image_urls = [request.image];
      }

      // Reference video
      if (request.reference_video) {
        input.video_urls = [request.reference_video];
      }

      // Reference audio
      if (request.reference_audio?.length) {
        input.audio_urls = request.reference_audio;
      }

      // Last frame for first_and_last_frames mode
      if (request.last_frame_image) {
        input.generation_type = 'first_and_last_frames';
        input.last_frame_image = request.last_frame_image;
      }
    }

    // Wan 2.7 models
    if (falEndpoint.includes('wan')) {
      if (request.resolution) input.resolution = request.resolution;
      if (request.duration) input.duration = request.duration;
      if (request.aspect_ratio) input.aspect_ratio = request.aspect_ratio;
      if (request.generate_audio !== undefined) input.generate_audio = request.generate_audio;

      if (request.image) {
        input.image_urls = [request.image];
      }
      if (request.reference_images?.length) {
        input.image_urls = request.reference_images;
      }
      if (request.reference_video) {
        input.video_urls = [request.reference_video];
      }
      if (request.reference_audio?.length) {
        input.audio_urls = request.reference_audio;
      }
      if (request.last_frame_image) {
        input.last_frame_image = request.last_frame_image;
      }
      if (request.edit_video) {
        input.video_url = request.edit_video;
        input.edit_instruction = request.edit_instruction;
      }
    }

    // Kling 3.0 models
    if (falEndpoint.includes('kling')) {
      if (request.duration) input.duration = request.duration;
      if (request.aspect_ratio) input.aspect_ratio = request.aspect_ratio;
      if (request.generate_audio !== undefined) input.sound = request.generate_audio;

      if (request.image) {
        input.image = request.image;
      }
      if (request.reference_images?.length) {
        input.images = request.reference_images;
      }
    }

    // 3D models (Hunyuan3D, Stable Fast 3D, Trellis)
    if (falEndpoint.includes('3d') || falEndpoint.includes('trellis')) {
      if (request.image) {
        input.image_url = request.image;
      }
      if (request.texture_resolution) {
        input.texture_size = request.texture_resolution;
      }
      if (request.seed !== undefined && request.seed !== null) {
        input.seed = request.seed;
      }
      if (request.diffusion_seed !== undefined) {
        input.seed = request.diffusion_seed;
      }
    }

    return input;
  }

  private async pollRequest(requestId: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      const response = await this.fetchWithTimeout(
        `https://fal.run/requests/${requestId}/status`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeoutMs: 10000,
        }
      );

      if (!response.ok) {
        const body = await response.text();
        const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
        const httpError = createHttpError(response.status, httpMeta);
        throw new ProviderError(`FAL poll: ${httpError.message}`, this.providerId, response.status);
      }

      const status = await response.json() as { status: string; response_url?: string; error?: string };

      if (status.status === 'completed' || status.status === 'OK') {
        // Fetch the actual result
        if (status.response_url) {
          const resultResponse = await this.fetchWithTimeout(status.response_url, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
            timeoutMs: 10000,
          });
          return resultResponse.json() as Promise<Record<string, unknown>>;
        }
        return status as unknown as Record<string, unknown>;
      }

      if (status.status === 'failed') {
        throw new ProviderError(
          `FAL generation failed: ${status.error || 'Unknown error'}`,
          this.providerId,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new ProviderError('FAL generation timed out', this.providerId, 504);
  }

  private buildResponse(
    modality: Modality,
    requestId: string,
    modelId: string,
    result: Record<string, unknown>,
    latencyMs: number,
  ): UnifiedResponse {
    const base: UnifiedResponse = {
      modality,
      requestId,
      providerId: this.providerId,
      modelId,
      latencyMs,
    };

    if (modality === 'video') {
      // FAL returns video URL in different fields depending on the model
      const videoUrl = (result.video as { url?: string })?.url
        || (result.output as string)
        || (Array.isArray(result.output) ? (result.output as string[])[0] : undefined)
        || (result.data as { video?: { url?: string } })?.video?.url;

      return {
        ...base,
        videos: [{
          url: videoUrl,
          duration: typeof result.duration === 'number' ? result.duration : undefined,
          fps: typeof result.fps === 'number' ? result.fps : undefined,
          resolution: typeof result.resolution === 'string' ? result.resolution : undefined,
          has_audio: typeof result.generate_audio === 'boolean' ? result.generate_audio : undefined,
        }],
      };
    }

    if (modality === '3d') {
      const modelUrl = (result.file as { url?: string })?.url
        || (result.output as string)
        || (Array.isArray(result.output) ? (result.output as string[])[0] : undefined)
        || (result.data as { file?: { url?: string } })?.file?.url
        || (result.glb_file as { url?: string })?.url;
      return {
        ...base,
        models3d: [{
          url: modelUrl,
          format: 'glb'
        }]
      };
    }

    // Diffusion fallback
    const images = result.images || result.output;
    const imageUrl = Array.isArray(images) ? images[0] : images;
    return {
      ...base,
      images: [{ url: typeof imageUrl === 'string' ? imageUrl : (imageUrl as { url?: string })?.url }],
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    const response = await this.execute(request, options);

    const chunkType: StreamChunk['type'] = request.modality === 'video' ? 'video_partial' : 'image_partial';
    const chunkData = request.modality === 'video' ? response.videos?.[0] : response.images?.[0];

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
      { modelId: 'seedance-2.0', modality: 'video', capabilities: ['text2video', 'img2video', 'reference-to-video', 'native_audio'] },
      { modelId: 'seedance-2.0/text-to-video', modality: 'video', capabilities: ['text2video', 'native_audio'] },
      { modelId: 'seedance-2.0/image-to-video', modality: 'video', capabilities: ['img2video', 'native_audio'] },
      { modelId: 'seedance-2.0/reference-to-video', modality: 'video', capabilities: ['reference-to-video', 'native_audio'] },
      { modelId: 'seedance-2.0-fast', modality: 'video', capabilities: ['text2video', 'img2video', 'native_audio'] },
      { modelId: 'wan-2.7', modality: 'video', capabilities: ['text2video', 'img2video', 'reference-to-video', 'video-edit', 'native_audio'] },
      { modelId: 'wan-2.7/text-to-video', modality: 'video', capabilities: ['text2video', 'native_audio'] },
      { modelId: 'wan-2.7/image-to-video', modality: 'video', capabilities: ['img2video', 'native_audio'] },
      { modelId: 'wan-2.7/reference-to-video', modality: 'video', capabilities: ['reference-to-video'] },
      { modelId: 'wan-2.7/edit-video', modality: 'video', capabilities: ['video-edit'] },
      { modelId: 'kling-v3', modality: 'video', capabilities: ['text2video', 'img2video', 'native_audio'] },
      { modelId: 'kling-v3/text-to-video', modality: 'video', capabilities: ['text2video', 'native_audio'] },
      { modelId: 'kling-v3/image-to-video', modality: 'video', capabilities: ['img2video'] },
      { modelId: 'tencent/hunyuan3d-2', modality: '3d', capabilities: ['text-to-3d', 'image-to-3d'] },
      { modelId: 'stability-ai/stable-fast-3d', modality: '3d', capabilities: ['image-to-3d'] },
      { modelId: 'hunyuan3d', modality: '3d', capabilities: ['text-to-3d', 'image-to-3d'] },
      { modelId: 'trellis', modality: '3d', capabilities: ['text-to-3d', 'image-to-3d'] },
      { modelId: 'trellis2', modality: '3d', capabilities: ['text-to-3d', 'image-to-3d'] },
    ];
  }
}
