import { ValidationError } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseQualityTarget } from '../utils/quality-target.js';

const OcrRequestSchema = z.object({
  model: z.string().optional(),
  image: z.string().min(1), // base64 or URL
  language: z.string().optional(),
  detect_direction: z.boolean().optional(),
  paragraph: z.boolean().optional(),
  lines: z.boolean().optional(),
  words: z.boolean().optional(),
});

export async function ocrRoutes(server: FastifyInstance): Promise<void> {
  server.post('/ocr', async (request, reply) => {
    const parsed = OcrRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);

    const unifiedRequest = {
      modality: 'ocr' as const,
      model: body.model,
      image: body.image,
      ocr_language: body.language,
      ocr_detect_direction: body.detect_direction,
      ocr_paragraph: body.paragraph,
      ocr_lines: body.lines,
      ocr_words: body.words,
      stream: false,
      metadata: {
        requestId,
        tenant: (request as any).tenant,
      },
    };

    try {
      const { response } = await router.route(unifiedRequest, {
        path: '/v1/ocr',
        qualityTarget,
      });

      return {
        requestId: response.requestId,
        providerId: response.providerId,
        modelId: response.modelId,
        text: response.ocr?.text,
        ocrTexts: response.ocr?.ocrTexts,
      };
    } catch (error: any) {
      if (error instanceof ValidationError) throw error;
      logger.error({ err: error }, 'OCR request error');
      throw new ValidationError('OCR request failed');
    }
  });
}