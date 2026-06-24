import { ValidationError, type UnifiedRequest } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseQualityTarget } from '../utils/quality-target.js';

const SpeechRequestSchema = z.object({
  model: z.string(),
  input: z.string().min(1),
  voice: z.string(),
  response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional().default('mp3'),
  speed: z.number().min(0.25).max(4.0).optional().default(1.0),
});

export async function audioRoutes(server: FastifyInstance): Promise<void> {
  // Text-to-speech
  server.post('/audio/speech', async (request, reply) => {
    const parsed = SpeechRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);

    const unifiedRequest: UnifiedRequest = {
      modality: 'audio_tts',
      model: body.model,
      prompt: body.input,
      voice: body.voice,
      format: body.response_format,
      speed: body.speed,
      stream: false,
      metadata: {
        requestId,
        tenant: (request as any).tenant,
      },
    };

    try {
      const { response } = await router.route(unifiedRequest, {
        path: '/audio/speech',
        qualityTarget,
      });

      if (response.audio?.b64_json) {
        const contentTypes: Record<string, string> = {
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
    } catch (error: any) {
      if (error instanceof ValidationError) throw error;
      logger.error({ err: error }, 'TTS request error');
      throw new ValidationError('TTS request failed');
    }
  });

  // Speech-to-text (multipart file upload)
  server.post('/audio/transcriptions', async (request, reply) => {
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);

    let audioBase64: string;
    let model = '';
    let language: string | undefined;
    let prompt: string | undefined;
    let responseFormat = 'json';

    try {
      // Handle multipart form data
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          // Collect file data into buffer
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          audioBase64 = Buffer.concat(chunks).toString('base64');
        } else if (part.type === 'field') {
          switch (part.fieldname) {
            case 'model': model = part.value as string; break;
            case 'language': language = part.value as string; break;
            case 'prompt': prompt = part.value as string; break;
            case 'response_format': responseFormat = part.value as string; break;
          }
        }
      }
    } catch (err) {
      throw new ValidationError('Failed to parse multipart upload');
    }

    if (!audioBase64!) {
      throw new ValidationError('No audio file provided');
    }
    if (!model) {
      throw new ValidationError('Model is required');
    }

    const unifiedRequest: UnifiedRequest = {
      modality: 'audio_stt',
      model,
      prompt,
      language,
      format: responseFormat,
      audio: audioBase64!,
      stream: false,
      metadata: {
        requestId,
        tenant: (request as any).tenant,
      },
    };

    try {
      const { response } = await router.route(unifiedRequest, {
        path: '/audio/transcriptions',
        qualityTarget,
      });

      const text = response.message?.content || '';

      if (responseFormat === 'text') {
        reply.header('Content-Type', 'text/plain');
        return text;
      }

      return { text };
    } catch (error: any) {
      if (error instanceof ValidationError) throw error;
      logger.error({ err: error }, 'STT request error');
      throw new ValidationError('STT request failed');
    }
  });
}
