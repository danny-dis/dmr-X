import { z } from 'zod';
import { ValidationError } from '@dmr-x/core';
import { generateRequestId } from '@dmr-x/utils';
const SpeechRequestSchema = z.object({
    model: z.string(),
    input: z.string().min(1),
    voice: z.string(),
    response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional().default('mp3'),
    speed: z.number().min(0.25).max(4.0).optional().default(1.0),
});
const TranscriptionRequestSchema = z.object({
    file: z.any(),
    model: z.string(),
    language: z.string().optional(),
    prompt: z.string().optional(),
    response_format: z.enum(['json', 'text', 'srt', 'verbose_json', 'vtt']).optional().default('json'),
    temperature: z.number().min(0).max(1).optional().default(0),
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
        const unifiedRequest = {
            modality: 'audio_speech',
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
        // TODO: Route through Router service
        // For now, return placeholder audio
        reply.header('Content-Type', 'audio/mpeg');
        return Buffer.from([]);
    });
    // Speech-to-text
    server.post('/audio/transcriptions', async (request, reply) => {
        const parsed = TranscriptionRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid request', { errors: parsed.error.errors });
        }
        const body = parsed.data;
        const requestId = generateRequestId();
        // TODO: Route through Router service
        return {
            text: 'DMR-X routing engine not yet connected. Please complete Phase 1 setup.',
        };
    });
}
//# sourceMappingURL=audio.routes.js.map