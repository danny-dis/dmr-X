import { ValidationError, ProviderUnavailableError } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { generateRequestId } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseQualityTarget } from '../utils/quality-target.js';

const ModerationRequestSchema = z.object({
  input: z.string().min(1),
  model: z.string().optional(),
});

export async function moderationRoutes(server: FastifyInstance): Promise<void> {
  server.post('/moderations', async (request, reply) => {
    const parsed = ModerationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);

    const tenantId = (request as any).tenant?.id;
    const { checkRouteCache, storeRouteCache } = await import('@dmr-x/cache');
    const cached = checkRouteCache('moderation', tenantId, body as Record<string, unknown>);
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return cached.response;
    }

    const unifiedRequest: any = {
      modality: 'moderation',
      input: body.input,
      metadata: {
        requestId,
        tenant: (request as any).tenant,
      },
    };

    const { plan, response } = await router.route(unifiedRequest, {
      path: '/v1/moderations',
      qualityTarget,
    });

    if (!plan.primary) {
      throw new ProviderUnavailableError([]);
    }

    (request as any).metrics = {
      providerId: plan.primary.providerId,
      modelId: response.modelId,
      modality: 'moderation',
      tenantId: (request as any).tenant?.id,
      taskProfile: 'moderation',
      routingPlan: {
        primary: {
          providerId: plan.primary.providerId,
          modelId: plan.primary.modelId,
          score: plan.primary.score,
        },
        candidates: plan.chain.map((step: any) => ({
          providerId: step.provider.providerId,
          modelId: step.provider.modelId,
          score: step.provider.score,
        })),
      },
    };

    storeRouteCache('moderation', tenantId, body as Record<string, unknown>, response);
    reply.header('X-Cache', 'MISS');
    return response;
  });
}