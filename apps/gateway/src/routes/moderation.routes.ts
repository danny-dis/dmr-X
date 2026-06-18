import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError, ProviderUnavailableError } from '@dmr-x/core';
import { generateRequestId } from '@dmr-x/utils';
import type { Router } from '@dmr-x/router';

const ModerationRequestSchema = z.object({
  input: z.string().min(1),
  model: z.string().optional(), // Optional, let router decide
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

    // Convert to UnifiedRequest
    const unifiedRequest: any = {
      modality: 'moderation',
      input: body.input,
      metadata: {
        requestId,
        tenant: (request as any).tenant,
      },
    };

    // Route and execute
    const { plan, response } = await router.route(unifiedRequest, {
      path: '/v1/moderations',
      qualityTarget: 'balanced',
    });

    if (!plan.primary) {
      throw new ProviderUnavailableError([]);
    }

    // Telemetry: populate metrics for the onResponse hook
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
        candidates: plan.chain.map((step) => ({
          providerId: step.provider.providerId,
          modelId: step.provider.modelId,
          score: step.provider.score,
        })),
      },
    };

    return response;
  });
}
