import { BaseAdapter } from '../base.adapter.js';
import { ProviderError } from '@dmr-x/core';
import { createHttpError } from '@dmr-x/utils';
export class DeepgramAdapter extends BaseAdapter {
    providerId = 'deepgram';
    supportedModalities = ['audio_stt'];
    apiKey = '';
    async initialize(config) {
        await super.initialize(config);
        this.apiKey = config.apiKey || '';
        if (!this.apiKey) {
            throw new Error('Deepgram API key is required');
        }
    }
    async checkHealth() {
        const response = await this.fetchWithTimeout('https://api.deepgram.com/v1/projects', {
            headers: { Authorization: `Token ${this.apiKey}` },
            timeoutMs: 5000,
        });
        if (!response.ok) {
            const body = await response.text();
            const httpMeta = { response, request: new Request(response.url), body };
            const httpError = createHttpError(response.status, httpMeta);
            throw new Error(`Deepgram health check failed: ${httpError.message}`);
        }
    }
    async execute(request, options) {
        this.assertInitialized();
        if (request.modality !== 'audio_stt') {
            throw new Error(`Deepgram only supports audio_stt modality, got: ${request.modality}`);
        }
        const start = Date.now();
        const audioData = request.audio || request.metadata?.audioData;
        if (!audioData) {
            throw new ProviderError('No audio data provided', this.providerId, 400);
        }
        const audioBuffer = typeof audioData === 'string'
            ? Buffer.from(audioData, 'base64')
            : audioData;
        const response = await this.fetchWithTimeout('https://api.deepgram.com/v1/listen', {
            method: 'POST',
            headers: {
                'Content-Type': request.audio_format || 'audio/wav',
                Authorization: `Token ${this.apiKey}`,
            },
            body: audioBuffer,
            timeoutMs: options?.timeoutMs ?? 60000,
        });
        if (!response.ok) {
            const body = await response.text();
            const httpMeta = { response, request: new Request(response.url), body };
            const httpError = createHttpError(response.status, httpMeta);
            throw new ProviderError(`Deepgram: ${httpError.message}`, this.providerId, response.status);
        }
        const data = await response.json();
        const latencyMs = Date.now() - start;
        return {
            modality: 'audio_stt',
            requestId: `deepgram_${Date.now()}`,
            providerId: this.providerId,
            modelId: request.model || 'nova-2',
            message: {
                role: 'assistant',
                content: data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '',
            },
            latencyMs,
        };
    }
    async *executeStream(request, options) {
        const response = await this.execute(request, options);
        yield {
            type: 'token',
            data: { content: response.message?.content },
            index: 0,
        };
        yield {
            type: 'done',
            data: {},
            index: 1,
        };
    }
    async listModels() {
        return [
            { modelId: 'nova-2', modality: 'audio_stt', capabilities: ['stt', 'multilingual'] },
            { modelId: 'nova', modality: 'audio_stt', capabilities: ['stt'] },
            { modelId: 'whisper-large', modality: 'audio_stt', capabilities: ['stt'] },
        ];
    }
}
//# sourceMappingURL=deepgram.adapter.js.map