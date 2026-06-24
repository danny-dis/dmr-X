import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';

import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { BaseAdapter } from '../base.adapter.js';

export class PollinationsImageAdapter extends BaseAdapter {
  readonly providerId = 'pollinations-images';
  readonly supportedModalities: Modality[] = ['diffusion'];

  protected async checkHealth(): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/prompt/test?width=64&height=64&nologo=true`,
      { method: 'GET', timeoutMs: 10000 },
    );
    if (!response.ok && response.status >= 500) {
      throw new Error(`Pollinations health check failed: HTTP ${response.status}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    const start = Date.now();
    const prompt = this.extractPrompt(request);
    if (!prompt) {
      throw new ProviderError('No prompt provided', this.providerId, 400);
    }

    const model = request.model || 'flux';
    const width = request.width || 1024;
    const height = request.height || 1024;
    const encodedPrompt = encodeURIComponent(prompt);

    const url = `${this.config.baseUrl}/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&model=${model}`;

    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        method: 'GET',
        timeoutMs: options?.timeoutMs ?? 120000,
      });
    } catch (err) {
      throw this.handleAdapterError(err, 'image');
    }

    if (!response.ok) {
      const body = await response.text();
      throw new ProviderError(
        `Pollinations image failed: HTTP ${response.status} - ${body.slice(0, 200)}`,
        this.providerId,
        response.status,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      const body = await response.text();
      throw new ProviderError(
        `Pollinations returned non-image content: ${contentType} - ${body.slice(0, 200)}`,
        this.providerId,
        502,
      );
    }

    const imageBuffer = await response.arrayBuffer();
    const b64_json = Buffer.from(imageBuffer).toString('base64');

    const latencyMs = Date.now() - start;

    return {
      modality: 'diffusion',
      requestId: `poll-img-${Date.now()}`,
      providerId: this.providerId,
      modelId: model,
      images: [
        {
          b64_json,
          revised_prompt: prompt,
        },
      ],
      latencyMs,
    };
  }

  async *executeStream(_request: UnifiedRequest, _options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    throw new ProviderError('Pollinations images does not support streaming', this.providerId, 400);
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { modelId: 'flux', modality: 'diffusion', capabilities: ['text2img'] },
      { modelId: 'flux-realism', modality: 'diffusion', capabilities: ['text2img'] },
      { modelId: 'flux-anime', modality: 'diffusion', capabilities: ['text2img'] },
      { modelId: 'flux-3d', modality: 'diffusion', capabilities: ['text2img'] },
      { modelId: 'any-dark', modality: 'diffusion', capabilities: ['text2img'] },
    ];
  }

  private extractPrompt(request: UnifiedRequest): string {
    if (request.prompt) return request.prompt;
    if (request.messages?.length) {
      const lastUser = request.messages.filter(m => m.role === 'user').pop();
      if (lastUser) {
        return typeof lastUser.content === 'string'
          ? lastUser.content
          : lastUser.content.filter(p => p.type === 'text').map(p => p.text).join(' ');
      }
    }
    return '';
  }
}
