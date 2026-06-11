import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '@dmr-x/core';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { Router } from '@dmr-x/router';

const SeparateRequestSchema = z.object({
  model: z.string().optional(),
  audio: z.string().min(1), // base64 or URL
  stem_count: z.enum(['2', '4', '5', '6']).optional(),
  separate_vocals: z.boolean().optional(),
  separate_drums: z.boolean().optional(),
  separate_bass: z.boolean().optional(),
  separate_other: z.boolean().optional(),
});

export async function audioSeparationRoutes(server: FastifyInstance): Promise<void> {
  server.post('/audio/separate', async (request, reply) => {
    const parsed = SeparateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;

    const unifiedRequest = {
      modality: 'audio_separation' as const,
      model: body.model,
      audio: body.audio,
      stem_count: body.stem_count as any,
      separate_vocals: body.separate_vocals,
      separate_drums: body.separate_drums,
      separate_bass: body.separate_bass,
      separate_other: body.separate_other,
      stream: false,
      metadata: {
        requestId,
        tenant: (request as any).tenant,
      },
    };

    try {
      const { response } = await router.route(unifiedRequest, {
        path: '/v1/audio/separate',
        qualityTarget: 'balanced',
      });

      return {
        requestId: response.requestId,
        providerId: response.providerId,
        modelId: response.modelId,
        stems: response.stems,
        archive: response.stemArchive,
      };
    } catch (error: any) {
      if (error instanceof ValidationError) throw error;
      logger.error({ err: error }, 'Audio separation request error');
      throw new ValidationError('Audio separation failed');
    }
  });
}