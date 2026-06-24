import type {
  Modality,
  UnifiedRequest,
  UnifiedResponse,
  StreamChunk,
} from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { createHttpError, type HttpMeta } from '@dmr-x/utils';
import { logger } from '@dmr-x/utils';

import type {
  ProviderConfig,
  ModelInfo,
  ExecuteOptions,
} from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';
import { createOpenAISSEIterator } from '../stream-normalizer.js';

export class OpenAIAdapter extends BaseAdapter {
  readonly providerId = 'openai';
  readonly supportedModalities: Modality[] = ['llm', 'embedding', 'diffusion', 'audio_tts', 'audio_stt', 'video'];

  private apiKey = '';

  private getBaseUrl(): string {
    return (this.config.baseUrl || 'https://api.openai.com').replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.accessToken as string) || (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    // fetchWithTimeout throws HttpError on non-OK responses; base healthCheck() catches it
    await this.fetchWithTimeout(`${this.getBaseUrl()}/v1/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeoutMs: 5000,
    });
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    const baseUrl = this.getBaseUrl();
    const start = Date.now();

    try {
      if (request.modality === 'llm') {
        return this.executeChat(baseUrl, request, options);
      }

      if (request.modality === 'embedding') {
        return this.executeEmbedding(baseUrl, request, options);
      }

      if (request.modality === 'diffusion') {
        return this.executeImage(baseUrl, request, options);
      }

      if (request.modality === 'video') {
        return this.executeVideo(baseUrl, request, options);
      }

      throw new Error(`Unsupported modality: ${request.modality}`);
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  private async executeChat(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
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
    } catch (error) {
      throw this.handleAdapterError(error, 'chat');
    }

    const data = (await response.json()) as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'llm',
      requestId: data.id as string,
      providerId: this.providerId,
      modelId: data.model as string,
      message: (data.choices as any[])?.[0]?.message,
      usage: data.usage as any,
      finishReason: (data.choices as any[])?.[0]?.finish_reason,
      latencyMs,
    };
  }

  private async executeEmbedding(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${baseUrl}/v1/embeddings`, {
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
    } catch (error) {
      throw this.handleAdapterError(error, 'embedding');
    }

    const data = (await response.json()) as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'embedding',
      requestId: `emb_${Date.now()}`,
      providerId: this.providerId,
      modelId: data.model as string,
      embeddings: (data.data as any[])?.map((d) => d.embedding),
      latencyMs,
    };
  }

  private async executeImage(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${baseUrl}/v1/images/generations`, {
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
    } catch (error) {
      throw this.handleAdapterError(error, 'image');
    }

    const data = (await response.json()) as Record<string, unknown>;
    const latencyMs = Date.now() - start;

    return {
      modality: 'diffusion',
      requestId: `img_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'dall-e-3',
      images: data.data as any,
      latencyMs,
    };
  }

  /**
   * Execute video generation via OpenAI Sora API.
   *
   * Sora uses an async job-based API:
   *   1. POST /v1/video/generations → returns { id, status: "queued" }
   *   2. GET  /v1/video/generations/{id} → polls until status is "completed" or "failed"
   *   3. On completion, the response contains a video URL
   */
  private async executeVideo(
    baseUrl: string,
    request: UnifiedRequest,
    options?: ExecuteOptions,
  ): Promise<UnifiedResponse> {
    const start = Date.now();
    const modelId = request.model || 'sora-2';

    // Build the request body per OpenAI Sora API spec
    const body: Record<string, unknown> = {
      model: modelId,
      prompt: request.prompt,
    };

    // Map DMR-X duration (seconds) to Sora's `seconds` param
    if (request.duration) {
      body.seconds = Math.min(request.duration, 20); // Sora max is 20s
    }

    // Map resolution to Sora's `size` param (WxH)
    if (request.aspect_ratio || request.resolution) {
      body.size = this.mapToSoraSize(request.aspect_ratio, request.resolution);
    }

    // Image-to-video: pass image as input
    if (request.image) {
      body.image = request.image;
    }

    // Seed / generation control
    if (request.seed !== undefined && request.seed !== null) {
      body.seed = request.seed;
    }

    // N parameter (number of videos to generate)
    if (request.n) {
      body.n = Math.min(request.n, 4); // Sora max is 4
    }

    // Create the video generation job
    let createResponse: Response;
    try {
      createResponse = await this.fetchWithTimeout(`${baseUrl}/v1/video/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        timeoutMs: options?.timeoutMs ?? 30000,
      });
    } catch (error) {
      throw this.handleAdapterError(error, 'video');
    }

    if (!createResponse.ok) {
      const errBody = await createResponse.text();
      const httpMeta: HttpMeta = { response: createResponse, request: new Request(createResponse.url), body: errBody };
      const httpError = createHttpError(createResponse.status, httpMeta);
      throw new ProviderError(`OpenAI Sora: ${httpError.message}`, this.providerId, createResponse.status);
    }

    const createData = await createResponse.json() as {
      id: string;
      status: string;
      video?: { url?: string };
    };

    // If the result came back inline (unlikely for Sora, but handle it)
    if (createData.video?.url) {
      return this.buildVideoResponse(request.model || 'sora-2', createData.id, createData, Date.now() - start);
    }

    // Poll for completion
    const jobId = createData.id;
    const timeoutMs = options?.timeoutMs ?? 600000; // 10 min default for video
    const result = await this.pollVideoJob(baseUrl, jobId, timeoutMs);
    return this.buildVideoResponse(request.model || 'sora-2', jobId, result, Date.now() - start);
  }

  private async pollVideoJob(
    baseUrl: string,
    jobId: string,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    const pollInterval = 3000; // 3s initial

    while (Date.now() - startTime < timeoutMs) {
      let response: Response;
      try {
        response = await this.fetchWithTimeout(`${baseUrl}/v1/video/generations/${jobId}`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          timeoutMs: 15000,
        });
      } catch (error) {
        throw this.handleAdapterError(error, 'video-poll');
      }

      if (!response.ok) {
        const errBody = await response.text();
        const httpMeta: HttpMeta = { response, request: new Request(response.url), body: errBody };
        const httpError = createHttpError(response.status, httpMeta);
        throw new ProviderError(`OpenAI Sora poll: ${httpError.message}`, this.providerId, response.status);
      }

      const data = await response.json() as {
        id: string;
        status: string;
        video?: { url?: string };
        error?: { message?: string };
      };

      if (data.status === 'completed') {
        return data as unknown as Record<string, unknown>;
      }

      if (data.status === 'failed') {
        throw new ProviderError(
          `OpenAI Sora generation failed: ${data.error?.message || 'Unknown error'}`,
          this.providerId,
        );
      }

      // Exponential backoff with cap
      const elapsed = Date.now() - startTime;
      const interval = Math.min(pollInterval * Math.pow(1.5, Math.floor(elapsed / 10000)), 10000);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new ProviderError('OpenAI Sora generation timed out', this.providerId, 504);
  }

  private mapToSoraSize(aspectRatio?: string, resolution?: string): string {
    // Sora accepts WxH format: 1920x1080, 1080x1920, 1280x720, 720x1280, 1024x1024
    const resMap: Record<string, string> = {
      '16:9_1080p': '1920x1080',
      '16:9_720p': '1280x720',
      '16:9_480p': '854x480',
      '9:16_1080p': '1080x1920',
      '9:16_720p': '720x1280',
      '9:16_480p': '480x854',
      '1:1_1080p': '1080x1080',
      '1:1_720p': '720x720',
      '1:1_480p': '480x480',
    };

    const key = `${aspectRatio || '16:9'}_${resolution || '720p'}`;
    return resMap[key] || '1280x720';
  }

  private buildVideoResponse(
    modelId: string,
    jobId: string,
    data: Record<string, unknown>,
    latencyMs: number,
  ): UnifiedResponse {
    const videoData = data.video as { url?: string } | undefined;
    return {
      modality: 'video',
      requestId: jobId,
      providerId: this.providerId,
      modelId,
      videos: [{
        url: videoData?.url,
        duration: typeof data.seconds === 'number' ? data.seconds : undefined,
      }],
      latencyMs,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();

    const baseUrl = this.getBaseUrl();
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
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
        // Forward the caller's AbortSignal so a client disconnect
        // (e.g. SSE consumer gone) cancels the upstream request.
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
    const baseUrl = this.getBaseUrl();
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch (error) {
      // Gracefully return empty list on any error (HTTP or transport)
      logger.debug({ err: error, providerId: this.providerId }, 'Failed to list models, returning empty list');
      return [];
    }

    const data = (await response.json()) as Record<string, unknown>;
    const remoteModels = ((data.data as any[]) || []).map((model: any) => ({
      modelId: model.id,
      modality: 'llm' as Modality,
      capabilities: [],
    }));

    // Append known Sora models (not listed via /v1/models)
    const soraModels: ModelInfo[] = [
      { modelId: 'sora-2', modality: 'video', capabilities: ['text2video', 'img2video'] },
      { modelId: 'sora-2-pro', modality: 'video', capabilities: ['text2video', 'img2video'] },
      { modelId: 'sora-2-turbo', modality: 'video', capabilities: ['text2video', 'img2video'] },
    ];

    return [...remoteModels, ...soraModels];
  }
}
