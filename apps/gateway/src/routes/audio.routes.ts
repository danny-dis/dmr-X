import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError, type UnifiedRequest } from '@dmr-x/core';
import { generateRequestId } from '@dmr-x/utils';
import type { Router } from '@dmr-x/router';

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
        qualityTarget: 'balanced',
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
      throw new ValidationError(`TTS failed: ${error.message}`);
    }
  });

  // Speech-to-text
  server.post('/audio/transcriptions', async (request, reply) => {
    const parsed = TranscriptionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;

    // Read audio file from multipart upload
    const fileData = body.file;
    let audioBase64: string;
    if (Buffer.isBuffer(fileData)) {
      audioBase64 = fileData.toString('base64');
    } else if (typeof fileData === 'string') {
      audioBase64 = fileData;
    } else {
      throw new ValidationError('No audio file provided');
    }

    const unifiedRequest: UnifiedRequest = {
      modality: 'audio_stt',
      model: body.model,
      prompt: body.prompt,
      language: body.language,
      format: body.response_format,
      audio: audioBase64,
      stream: false,
      metadata: {
        requestId,
        tenant: (request as any).tenant,
      },
    };

    try {
      const { response } = await router.route(unifiedRequest, {
        path: '/audio/transcriptions',
        qualityTarget: 'balanced',
      });

      const text = response.message?.content || '';

      if (body.response_format === 'text') {
        reply.header('Content-Type', 'text/plain');
        return text;
      }

      return { text };
    } catch (error: any) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(`STT failed: ${error.message}`);
    }
  });
}
