import { z } from 'zod';
import { ValidationError } from '@dmr-x/core';
import { generateRequestId, logger } from '@dmr-x/utils';
const SpeechRequestSchema = z.object({
    model: z.string(),
    input: z.string().min(1),
    voice: z.string(),
    response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional().default('mp3'),
    speed: z.number().min(0.25).max(4.0).optional().default(1.0),
});
export async function audioRoutes(server) {
    // Text-to-speech
    server.post('/audio/speech', async (request, reply) => {
        const parsed = SpeechRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid request', { errors: parsed.error.errors });
        }
        const body = parsed.data;
        const requestId = generateRequestId();
        const router = server.router;
        const unifiedRequest = {
            modality: 'audio_tts',
            model: body.model,
            prompt: body.input,
            voice: body.voice,
            format: body.response_format,
            speed: body.speed,
            stream: false,
            metadata: {
                requestId,
                tenant: request.tenant,
            },
        };
        try {
            const { response } = await router.route(unifiedRequest, {
                path: '/audio/speech',
                qualityTarget: 'balanced',
            });
            if (response.audio?.b64_json) {
                const contentTypes = {
                    mp3: 'audio/mpeg',
                    opus: 'audio/opus',
                    aac: 'audio/aac',
                    flac: 'audio/flac',
                    wav: 'audio/wav',
                    pcm: 'audio/pcm',
                };
                reply.header('Content-Type', contentTypes[body.response_format] || 'audio/mpeg');
                return Buffer.from(response.audio.b64_json, 'base64');
            }
            throw new ValidationError('No audio data in response');
        }
        catch (error) {
            if (error instanceof ValidationError)
                throw error;
            logger.error({ err: error }, 'TTS request error');
            throw new ValidationError('TTS request failed');
        }
    });
    // Speech-to-text (multipart file upload)
    server.post('/audio/transcriptions', async (request, reply) => {
        const requestId = generateRequestId();
        const router = server.router;
        let audioBase64;
        let model = '';
        let language;
        let prompt;
        let responseFormat = 'json';
        try {
            // Handle multipart form data
            const parts = request.parts();
            for await (const part of parts) {
                if (part.type === 'file') {
                    // Collect file data into buffer
                    const chunks = [];
                    for await (const chunk of part.file) {
                        chunks.push(chunk);
                    }
                    audioBase64 = Buffer.concat(chunks).toString('base64');
                }
                else if (part.type === 'field') {
                    switch (part.fieldname) {
                        case 'model':
                            model = part.value;
                            break;
                        case 'language':
                            language = part.value;
                            break;
                        case 'prompt':
                            prompt = part.value;
                            break;
                        case 'response_format':
                            responseFormat = part.value;
                            break;
                    }
                }
            }
        }
        catch (err) {
            throw new ValidationError('Failed to parse multipart upload');
        }
        if (!audioBase64) {
            throw new ValidationError('No audio file provided');
        }
        if (!model) {
            throw new ValidationError('Model is required');
        }
        const unifiedRequest = {
            modality: 'audio_stt',
            model,
            prompt,
            language,
            format: responseFormat,
            audio: audioBase64,
            stream: false,
            metadata: {
                requestId,
                tenant: request.tenant,
            },
        };
        try {
            const { response } = await router.route(unifiedRequest, {
                path: '/audio/transcriptions',
                qualityTarget: 'balanced',
            });
            const text = response.message?.content || '';
            if (responseFormat === 'text') {
                reply.header('Content-Type', 'text/plain');
                return text;
            }
            return { text };
        }
        catch (error) {
            if (error instanceof ValidationError)
                throw error;
            logger.error({ err: error }, 'STT request error');
            throw new ValidationError('STT request failed');
        }
    });
}
//# sourceMappingURL=audio.routes.js.map