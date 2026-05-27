import { BaseAdapter } from '../base.adapter.js';
import { ProviderError } from '@dmr-x/core';
export class ReplicateAdapter extends BaseAdapter {
    providerId = 'replicate';
    supportedModalities = ['diffusion'];
    apiKey = '';
    async initialize(config) {
        await super.initialize(config);
        this.apiKey = config.apiKey || '';
        if (!this.apiKey) {
            throw new Error('Replicate API token is required');
        }
    }
    async checkHealth() {
        const response = await this.fetchWithTimeout('https://api.replicate.com/v1/account', {
            headers: { Authorization: `Bearer ${this.apiKey}` },
            timeoutMs: 5000,
        });
        if (!response.ok) {
            throw new Error(`Replicate health check failed: ${response.status}`);
        }
    }
    async execute(request, options) {
        this.assertInitialized();
        if (request.modality !== 'diffusion') {
            throw new Error(`Replicate only supports diffusion modality, got: ${request.modality}`);
        }
        const start = Date.now();
        const model = request.model || 'stability-ai/sdxl';
        // Create prediction
        const createResponse = await this.fetchWithTimeout(`https://api.replicate.com/v1/predictions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
                Prefer: 'wait',
            },
            body: JSON.stringify({
                version: await this.getModelVersion(model),
                input: {
                    prompt: request.prompt,
                    negative_prompt: request.negative_prompt,
                    width: request.width || 1024,
                    height: request.height || 1024,
                    num_inference_steps: request.steps || 50,
                    guidance_scale: request.cfg_scale || 7.5,
                    seed: request.diffusion_seed,
                },
            }),
            timeoutMs: options?.timeoutMs ?? 120000,
        });
        if (!createResponse.ok) {
            const error = await createResponse.text();
            throw new ProviderError(`Replicate error: ${error}`, this.providerId, createResponse.status);
        }
        const prediction = await createResponse.json();
        const latencyMs = Date.now() - start;
        // If prediction is still processing, poll for completion
        if (prediction.status !== 'succeeded') {
            const result = await this.pollPrediction(prediction.id, options?.timeoutMs ?? 120000);
            return {
                modality: 'diffusion',
                requestId: prediction.id,
                providerId: this.providerId,
                modelId: model,
                images: [{ url: result.output?.[0] }],
                latencyMs: Date.now() - start,
            };
        }
        return {
            modality: 'diffusion',
            requestId: prediction.id,
            providerId: this.providerId,
            modelId: model,
            images: [{ url: prediction.output?.[0] }],
            latencyMs,
        };
    }
    async pollPrediction(predictionId, timeoutMs) {
        const startTime = Date.now();
        const pollInterval = 1000;
        while (Date.now() - startTime < timeoutMs) {
            const response = await this.fetchWithTimeout(`https://api.replicate.com/v1/predictions/${predictionId}`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                timeoutMs: 10000,
            });
            if (!response.ok) {
                throw new ProviderError(`Replicate poll error: ${response.status}`, this.providerId);
            }
            const prediction = await response.json();
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
    async getModelVersion(model) {
        // For well-known models, return hardcoded versions
        const knownModels = {
            'stability-ai/sdxl': '39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
            'black-forest-labs/flux-schnell': 'black-forest-labs/flux-schnell',
        };
        if (knownModels[model]) {
            return knownModels[model];
        }
        // Otherwise, fetch the latest version
        const response = await this.fetchWithTimeout(`https://api.replicate.com/v1/models/${model}`, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
            timeoutMs: 10000,
        });
        if (!response.ok) {
            throw new ProviderError(`Model not found: ${model}`, this.providerId, 404);
        }
        const data = await response.json();
        return data.latest_version?.id || model;
    }
    async *executeStream(request, options) {
        // Diffusion doesn't support streaming in the LLM sense
        // Execute and yield the result as a single chunk
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
    async listModels() {
        return [
            { modelId: 'stability-ai/sdxl', modality: 'diffusion', capabilities: ['text2img', 'img2img'] },
            { modelId: 'black-forest-labs/flux-schnell', modality: 'diffusion', capabilities: ['text2img'] },
        ];
    }
}
//# sourceMappingURL=replicate.adapter.js.map