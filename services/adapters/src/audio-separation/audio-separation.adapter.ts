import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';

import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import { AsyncJobRunner } from '../async-job.js';
import { BaseAdapter } from '../base.adapter.js';

/**
 * Audio Separation adapter — supports Demucs (local) and cloud providers
 * (AudioShake, StemSplit) for source separation of audio files.
 *
 * Demucs pattern (local):
 *   - HTTP service wraps Demucs CLI
 *   - POST /separate with audio file
 *   - Returns ZIP of stem files or individual URLs
 *
 * AudioShake/StemSplit pattern (cloud):
 *   - POST /separate with audio URL
 *   - Returns job ID
 *   - GET /jobs/{id} to poll for completion
 *   - Returns URLs to stem files
 */
export class AudioSeparationAdapter extends BaseAdapter {
  readonly providerId = 'demucs';
  readonly supportedModalities: Modality[] = ['audio_separation'];

  private apiKey = '';
  private baseUrl = '';
  private asyncRunner = new AsyncJobRunner({ timeoutMs: 180000 });

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    this.baseUrl = (config.baseUrl as string) || 'http://localhost:8000';
    if (!this.apiKey && this.providerId !== 'demucs') {
      throw new Error(`${this.providerId} API key is required`);
    }
  }

  protected async checkHealth(): Promise<void> {
    if (this.providerId === 'demucs') {
      // Local Demucs service check
      const response = await this.fetchWithTimeout(`${this.baseUrl}/health`, {
        method: 'GET',
        timeoutMs: 5000,
      });
      if (!response.ok) {
        throw new Error('Demucs service unavailable');
      }
    } else {
      // Cloud provider health check via API
      const response = await this.fetchWithTimeout(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        timeoutMs: 5000,
      });
      if (!response.ok && response.status >= 500) {
        throw new Error(`${this.providerId} health check failed`);
      }
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();
    const start = Date.now();
    const modelId = request.model || 'htdemucs_ft';

    try {
      if (this.providerId === 'demucs') {
        return await this.executeDemucs(request, modelId, start, options);
      }

      if (this.providerId === 'audioshake' || this.providerId === 'stemsplit') {
        return await this.executeAsyncSeparation(request, modelId, start, options);
      }

      throw new Error(`Unsupported provider: ${this.providerId}`);
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  private async executeDemucs(
    request: UnifiedRequest,
    modelId: string,
    start: number,
    options?: ExecuteOptions,
  ): Promise<UnifiedResponse> {
    if (!request.audio) {
      throw new Error('Audio input is required for separation');
    }

    const response = await this.fetchWithTimeout(`${this.baseUrl}/separate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio: request.audio,
        model: modelId,
        stem_count: request.stem_count,
        separate_vocals: request.separate_vocals,
        separate_drums: request.separate_drums,
        separate_bass: request.separate_bass,
        separate_other: request.separate_other,
      }),
      timeoutMs: options?.timeoutMs ?? 180000,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ProviderError(`Demucs: ${response.status} ${body}`, this.providerId, response.status);
    }

    const data = await response.json() as {
      stems?: Array<{ name: string; url: string }>;
      archive?: { url: string; size: number };
    };

    const stems = data.stems?.map((s) => ({
      name: s.name,
      url: s.url,
      mimeType: 'audio/wav',
    }));

    return {
      modality: 'audio_separation',
      requestId: `sep_${Date.now()}`,
      providerId: this.providerId,
      modelId,
      stems,
      stemArchive: data.archive ? {
        filename: 'stems.zip',
        mimeType: 'application/zip',
        url: data.archive.url,
        size: data.archive.size,
      } : undefined,
      latencyMs: Date.now() - start,
    };
  }

  private async executeAsyncSeparation(
    request: UnifiedRequest,
    modelId: string,
    start: number,
    options?: ExecuteOptions,
  ): Promise<UnifiedResponse> {
    if (!request.audio) {
      throw new Error('Audio input is required for separation');
    }

    const apiKey = this.apiKey;

    const result = await this.asyncRunner.run(
      async () => {
        const submitResponse = await this.fetchWithTimeout(`${this.baseUrl}/separate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            audio: request.audio,
            model: modelId,
            stem_count: request.stem_count,
          }),
          timeoutMs: 30000,
        });

        if (!submitResponse.ok) {
          const body = await submitResponse.text();
          throw new Error(`Submission failed: ${submitResponse.status} ${body}`);
        }

        const submitData = await submitResponse.json() as { job_id?: string; status?: string };
        if (submitData.status === 'failed') {
          throw new Error('Job failed on submission');
        }

        return { jobId: submitData.job_id || 'unknown', status: 'processing' };
      },
      async (jobId: string) => {
        const pollResponse = await this.fetchWithTimeout(`${this.baseUrl}/jobs/${jobId}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          timeoutMs: 10000,
        });

        if (!pollResponse.ok) {
          const body = await pollResponse.text();
          return { status: 'failed' as const, error: `Poll failed: ${pollResponse.status} ${body}` };
        }

        const pollData = await pollResponse.json() as {
          status: string;
          stems?: Array<{ name: string; url: string }>;
          archive?: { url: string; size: number };
          error?: string;
        };

        if (pollData.status === 'completed' || pollData.status === 'succeeded') {
          return { status: 'succeeded' as const, output: pollData };
        }

        if (pollData.status === 'failed') {
          return { status: 'failed' as const, error: pollData.error || 'Job failed' };
        }

        return { status: 'processing' as const };
      },
      { timeoutMs: options?.timeoutMs ?? 180000 },
    );

    if (!result.success || !result.output) {
      throw new ProviderError(
        `Audio separation failed: ${result.error || 'Unknown error'}`,
        this.providerId,
        500,
      );
    }

    const output = result.output as {
      stems?: Array<{ name: string; url: string }>;
      archive?: { url: string; size: number };
    };

    const stems = output.stems?.map((s) => ({
      name: s.name,
      url: s.url,
      mimeType: 'audio/wav',
    }));

    return {
      modality: 'audio_separation',
      requestId: result.jobId,
      providerId: this.providerId,
      modelId,
      stems,
      stemArchive: output.archive ? {
        filename: 'stems.zip',
        mimeType: 'application/zip',
        url: output.archive.url,
        size: output.archive.size,
      } : undefined,
      latencyMs: Date.now() - start,
    };
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();
    const response = await this.execute(request, options);

    yield {
      type: 'audio_partial',
      data: { stems: response.stems, archive: response.stemArchive },
      index: 0,
    };

    yield {
      type: 'done',
      data: { requestId: response.requestId, modelId: response.modelId },
      index: 1,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.providerId === 'demucs') {
      return [
        { modelId: 'htdemucs_ft', modality: 'audio_separation', capabilities: ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'] },
        { modelId: 'htdemucs', modality: 'audio_separation', capabilities: ['vocals', 'drums', 'bass', 'other'] },
        { modelId: 'mdx_extra', modality: 'audio_separation', capabilities: ['vocals', 'instrumental'] },
        { modelId: 'mdx_qmodel', modality: 'audio_separation', capabilities: ['vocals', 'instrumental'] },
      ];
    }

    if (this.providerId === 'audioshake') {
      return [
        { modelId: 'audioshake-standard', modality: 'audio_separation', capabilities: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] },
        { modelId: 'audioshake-lite', modality: 'audio_separation', capabilities: ['vocals', 'instrumental'] },
      ];
    }

    if (this.providerId === 'stemsplit') {
      return [
        { modelId: 'stemsplit-2stem', modality: 'audio_separation', capabilities: ['vocals', 'instrumental'] },
        { modelId: 'stemsplit-6stem', modality: 'audio_separation', capabilities: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] },
      ];
    }

    return [];
  }
}

export function createAudioSeparationAdapter(providerId: string): AudioSeparationAdapter {
  const adapter = new AudioSeparationAdapter();
  (adapter as any).providerId = providerId;
  return adapter;
}