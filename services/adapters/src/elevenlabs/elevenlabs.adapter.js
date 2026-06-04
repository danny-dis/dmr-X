import { BaseAdapter } from '../base.adapter.js';
import { ProviderError } from '@dmr-x/core';
import { createHttpError } from '@dmr-x/utils';
export class ElevenLabsAdapter extends BaseAdapter {
    providerId = 'elevenlabs';
    supportedModalities = ['audio_tts'];
    apiKey = '';
    async initialize(config) {
        await super.initialize(config);
        this.apiKey = config.apiKey || '';
        if (!this.apiKey) {
            throw new Error('ElevenLabs API key is required');
        }
    }
    async checkHealth() {
        const response = await this.fetchWithTimeout('https://api.elevenlabs.io/v1/user', {
            headers: { 'xi-api-key': this.apiKey },
            timeoutMs: 5000,
        });
        if (!response.ok) {
            const body = await response.text();
            const httpMeta = { response, request: new Request(response.url), body };
            const httpError = createHttpError(response.status, httpMeta);
            throw new Error(`ElevenLabs health check failed: ${httpError.message}`);
        }
    }
    async execute(request, options) {
        this.assertInitialized();
        if (request.modality !== 'audio_tts') {
            throw new Error(`ElevenLabs only supports audio_tts modality, got: ${request.modality}`);
        }
        const start = Date.now();
        const voiceId = this.mapVoice(request.voice || 'rachel');
        const response = await this.fetchWithTimeout(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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
        });
        if (!response.ok) {
            const body = await response.text();
            const httpMeta = { response, request: new Request(response.url), body };
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
    mapVoice(voice) {
        const voiceMap = {
            rachel: '21m00Tcm4TlvDq8ikWAM',
            adam: 'pNInz6obpgDQGcFmaJgB',
            sam: 'yoZ06aMxZJJ28mfd3POQ',
        };
        return voiceMap[voice.toLowerCase()] || voice;
    }
    async *executeStream(request, options) {
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
    async listModels() {
        return [
            { modelId: 'eleven_monolingual_v1', modality: 'audio_tts', capabilities: ['tts'] },
            { modelId: 'eleven_multilingual_v2', modality: 'audio_tts', capabilities: ['tts', 'multilingual'] },
        ];
    }
}
//# sourceMappingURL=elevenlabs.adapter.js.map