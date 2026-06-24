import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, type HttpMeta } from '@dmr-x/utils';

import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';

/**
 * RunwayML adapter — supports Gen-4.5, Gen-4 Turbo, Seedance 2.0, Veo 3.1, and Gen-3 Alpha.
 *
 * Runway uses a task-based async API:
 *   1. POST /v1/text_to_video or /v1/image_to_video → returns { id }
 *   2. GET  /v1/tasks/{id} → polls until status is "SUCCEEDED" or "FAILED"
 *   3. On success, output contains video URL(s)
 *
 * Runway also acts as an aggregator, hosting Seedance 2.0 and Veo 3.1 models.
 */
export class RunwayAdapter extends BaseAdapter {
  readonly providerId = 'runway';
  readonly supportedModalities: Modality[] = ['video'];

  private apiKey = '';

  /** Map DMR-X model IDs to Runway model names */
  private static MODEL_MAP: Record<string, string> = {
    'gen-3-alpha': 'gen3a_turbo',
    'gen4.5': 'gen4_5',
    'gen4_turbo': 'gen4_turbo',
    'seedance2': 'seedance_2_0',
    'veo3': 'veo_3',
    'veo3.1': 'veo_3_1',
  };

  private getBaseUrl(): string {
    return (this.config.baseUrl || 'https://api.dev.runwayml.com/v1').replace(/\/+$/, '');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('Runway API key is required (RUNWAY_API_KEY)');
    }
  }

  protected async checkHealth(): Promise<void> {
    // Runway doesn't have a dedicated health endpoint; try listing tasks
    const response = await this.fetchWithTimeout(`${this.getBaseUrl()}/tasks`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
      timeoutMs: 5000,
    });
    // Even a 4xx means the API is reachable
    if (!response.ok && response.status >= 500) {
      const body = await response.text();
      const httpMeta: HttpMeta = { response, request: new Request(response.url), body };
      const httpError = createHttpError(response.status, httpMeta);
      throw new Error(`Runway health check failed: ${httpError.message}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality !== 'video') {
      throw new Error(`Runway only supports video modality, got: ${request.modality}`);
    }

    const start = Date.now();
    const modelId = request.model || 'gen4.5';
    const runwayModel = RunwayAdapter.MODEL_MAP[modelId] || modelId;

    try {
      // Determine the endpoint based on input
      const isImg2Video = !!request.image || !!request.reference_images?.length;
      const endpoint = isImg2Video ? 'image_to_video' : 'text_to_video';

      const input = this.buildInput(request, runwayModel);

      // Step 1: Create the task
      const createResponse = await this.fetchWithTimeout(`${this.getBaseUrl()}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'X-Runway-Version': '2024-11-06',
        },
        body: JSON.stringify(input),
        timeoutMs: options?.timeoutMs ?? 30000,
      });

      if (!createResponse.ok) {
        const errBody = await createResponse.text();
        const httpMeta: HttpMeta = { response: createResponse, request: new Request(createResponse.url), body: errBody };
        const httpError = createHttpError(createResponse.status, httpMeta);
        throw new ProviderError(`Runway: ${httpError.message}`, this.providerId, createResponse.status);
      }

      const createData = await createResponse.json() as { id: string };
      const taskId = createData.id;

      // Step 2: Poll for completion
      const timeoutMs = options?.timeoutMs ?? 600000; // 10 min default
      const result = await this.pollTask(taskId, timeoutMs);
      return this.buildResponse(modelId, taskId, result, Date.now() - start);
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  private buildInput(request: UnifiedRequest, runwayModel: string): Record<string, unknown> {
    const input: Record<string, unknown> = {
      model: runwayModel,
    };

    if (request.prompt) {
      input.promptText = request.prompt;
    }

    // Image input for img2video
    if (request.image) {
      input.promptImage = request.image;
    }

    // Duration (Runway uses seconds, max varies by model)
    if (request.duration) {
      input.duration = Math.min(request.duration, 10); // Runway max is ~10s
    }

    // Aspect ratio (Runway uses W:H format)
    if (request.aspect_ratio) {
      input.ratio = request.aspect_ratio.replace(':', ':');
    }

    // Seed for reproducibility
    if (request.seed !== undefined && request.seed !== null) {
      input.seed = request.seed;
    }

    // Camera control (Gen-4.5 supports this)
    if (request.camera_control) {
      input.cameraControl = {
        type: request.camera_control.type,
        direction: request.camera_control.direction,
        speed: request.camera_control.speed,
      };
    }

    // Reference images for character/style consistency
    if (request.reference_images?.length) {
      input.referenceImages = request.reference_images;
    }

    return input;
  }

  private async pollTask(taskId: string, timeoutMs: number): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const pollInterval = 3000;

    while (Date.now() - startTime < timeoutMs) {
      const response = await this.fetchWithTimeout(`${this.getBaseUrl()}/tasks/${taskId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'X-Runway-Version': '2024-11-06',
        },
        timeoutMs: 15000,
      });

      if (!response.ok) {
        const errBody = await response.text();
        const httpMeta: HttpMeta = { response, request: new Request(response.url), body: errBody };
        const httpError = createHttpError(response.status, httpMeta);
        throw new ProviderError(`Runway poll: ${httpError.message}`, this.providerId, response.status);
      }

      const data = await response.json() as {
        id: string;
        status: string;
        output?: string[];
        failureCode?: string;
        failureMessage?: string;
      };

      if (data.status === 'SUCCEEDED') {
        return data as unknown as Record<string, unknown>;
      }

      if (data.status === 'FAILED') {
        throw new ProviderError(
          `Runway generation failed: ${data.failureMessage || data.failureCode || 'Unknown error'}`,
          this.providerId,
        );
      }

      // Exponential backoff
      const elapsed = Date.now() - startTime;
      const interval = Math.min(
        pollInterval * Math.pow(1.5, Math.floor(elapsed / 10000)),
        10000,
      );
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new ProviderError('Runway generation timed out', this.providerId, 504);
  }

  private buildResponse(
    modelId: string,
    taskId: string,
    data: Record<string, unknown>,
    latencyMs: number,
  ): UnifiedResponse {
    const output = data.output as string[] | undefined;
    const videoUrl = output?.[0];

    return {
      modality: 'video',
      requestId: taskId,
      providerId: this.providerId,
      modelId,
      videos: [{
        url: videoUrl,
      }],
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
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
      { modelId: 'gen4.5', modality: 'video', capabilities: ['text2video', 'img2video', 'camera_control', 'reference_images'] },
      { modelId: 'gen4_turbo', modality: 'video', capabilities: ['text2video', 'img2video'] },
      { modelId: 'gen-3-alpha', modality: 'video', capabilities: ['text2video', 'img2video'] },
      { modelId: 'seedance2', modality: 'video', capabilities: ['text2video', 'img2video', 'native_audio'] },
      { modelId: 'veo3', modality: 'video', capabilities: ['text2video', 'img2video', 'native_audio'] },
      { modelId: 'veo3.1', modality: 'video', capabilities: ['text2video', 'img2video', 'native_audio', 'reference_images', 'video_extend'] },
    ];
  }
}
