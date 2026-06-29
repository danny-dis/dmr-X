import { ValidationError, type UnifiedRequest } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { generateRequestId } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseQualityTarget } from '../utils/quality-target.js';

const EmbeddingRequestSchema = z.object({
  model: z.string(),
  input: z.union([z.string(), z.array(z.string()), z.array(z.number()), z.array(z.array(z.number()))]),
  encoding_format: z.enum(['float', 'base64']).optional().default('float'),
  dimensions: z.number().positive().optional(),
  user: z.string().optional(),
});

export async function embeddingsRoutes(server: FastifyInstance): Promise<void> {
  server.post('/embeddings', async (request, reply) => {
    const parsed = EmbeddingRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);

    const tenantId = (request as any).tenant?.id;
    const { checkRouteCache, storeRouteCache } = await import('@dmr-x/cache');
    const cached = checkRouteCache('embedding', tenantId, body as Record<string, unknown>,
      (b: any) => b.encoding_format === 'base64');
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return cached.response;
    }

    const unifiedRequest: UnifiedRequest = {
      modality: 'embedding',
      model: body.model,
      input: body.input as string | string[],
      encoding_format: body.encoding_format,
      dimensions: body.dimensions,
      stream: false,
      user: body.user,
      metadata: {
        requestId,
        tenant: (request as any).tenant,
      },
    };

    const { response } = await router.route(unifiedRequest, {
      path: '/v1/embeddings',
      qualityTarget,
    });

    const result = {
      object: 'list',
      data: (response.embeddings || []).map((embedding: number[], i: number) => ({
        object: 'embedding',
        embedding,
        index: i,
      })),
      model: response.modelId,
      usage: response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };

    storeRouteCache('embedding', tenantId, body as Record<string, unknown>, result,
      { skipCache: (b: any) => b.encoding_format === 'base64' });
    reply.header('X-Cache', 'MISS');
    return result;
  });
}