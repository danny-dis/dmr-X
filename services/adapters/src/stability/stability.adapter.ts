import { BaseAdapter } from '../base.adapter.js';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';

export class StabilityAdapter extends BaseAdapter {
  readonly providerId = 'stability';
  readonly supportedModalities: Modality[] = ['diffusion'];

  private apiKey = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    if (!this.apiKey) {
      throw new Error('Stability AI API key is required');
    }
  }

  protected async checkHealth(): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl || 'https://api.stability.ai'}/v1/engines/list`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 5000,
      }
    );
    if (!response.ok) {
      throw new Error(`Stability health check failed: ${response.status}`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (request.modality !== 'diffusion') {
      throw new Error(`Stability only supports diffusion modality, got: ${request.modality}`);
    }

    const baseUrl = this.config.baseUrl || 'https://api.stability.ai';
    const start = Date.now();
    const engineId = this.mapModelToEngine(request.model || 'stable-diffusion-xl-1024-v1-0');

    const response = await this.fetchWithTimeout(
      `${baseUrl}/v1/generation/${engineId}/text-to-image`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({
          text_prompts: [
            { text: request.prompt, weight: 1 },
            ...(request.negative_prompt
              ? [{ text: request.negative_prompt, weight: -1 }]
              : []),
          ],
          cfg_scale: request.cfg_scale || 7,
          height: request.height || 1024,
          width: request.width || 1024,
          steps: request.steps || 30,
          seed: request.diffusion_seed ?? 0,
          samples: 1,
        }),
        timeoutMs: options?.timeoutMs ?? 60000,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(`Stability error: ${error}`, this.providerId, response.status);
    }

    const data = await response.json() as { artifacts?: Array<{ base64: string; finishReason: string }> };
    const latencyMs = Date.now() - start;

    const images = (data.artifacts || []).map((artifact: any) => ({
      b64_json: artifact.base64,
      finishReason: artifact.finishReason,
    }));

    return {
      modality: 'diffusion',
      requestId: `stability_${Date.now()}`,
      providerId: this.providerId,
      modelId: request.model || 'stable-diffusion-xl-1024-v1-0',
      images,
      latencyMs,
    };
  }

  private mapModelToEngine(model: string): string {
    const engineMap: Record<string, string> = {
      'stable-diffusion-xl-1024-v1-0': 'stable-diffusion-xl-1024-v1-0',
      'sdxl': 'stable-diffusion-xl-1024-v1-0',
      'sd-1.6': 'stable-diffusion-v1-6',
      'sd-2.1': 'stable-diffusion-v2-1',
    };
    return engineMap[model] || model;
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    const response = await this.execute(request, options);
    yield {
      type: 'image_partial',
      data: response.images?.[0],
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
      { modelId: 'stable-diffusion-xl-1024-v1-0', modality: 'diffusion', capabilities: ['text2img'] },
      { modelId: 'stable-diffusion-v1-6', modality: 'diffusion', capabilities: ['text2img'] },
      { modelId: 'stable-diffusion-v2-1', modality: 'diffusion', capabilities: ['text2img'] },
    ];
  }
}
