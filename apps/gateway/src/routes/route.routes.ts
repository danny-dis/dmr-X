import { ValidationError, type UnifiedRequest } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ChatMessageSchema, ToolSchema } from './shared-schemas.js';
import { parseQualityTarget } from '../utils/quality-target.js';

const RouteRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema).min(1),
  tools: z.array(ToolSchema).optional(),
  tool_choice: z.any().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stop: z.array(z.string()).optional(),
  response_format: z.object({ type: z.enum(['text', 'json_object']) }).optional(),
  seed: z.number().nullable().optional(),
  n: z.number().positive().optional(),
  stream: z.boolean().optional().default(false),
  user: z.string().optional(),
});

export async function routeDecisionRoutes(server: FastifyInstance): Promise<void> {
  server.post('/route', async (request, reply) => {
    const parsed = RouteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);

    const unifiedRequest: UnifiedRequest = {
      modality: 'llm',
      model: body.model,
      messages: body.messages as any,
      tools: body.tools as any,
      tool_choice: body.tool_choice as any,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      top_p: body.top_p,
      frequency_penalty: body.frequency_penalty,
      presence_penalty: body.presence_penalty,
      stop: body.stop,
      response_format: body.response_format as any,
      seed: body.seed,
      n: body.n,
      stream: body.stream,
      user: body.user,
      metadata: {
        requestId,
        tenant: (request as any).tenant,
        freeTierStrategy: (request.headers['x-free-tier-strategy'] as string) || undefined,
        costFilter: (request.headers['x-cost-filter'] as 'free' | 'all') || undefined,
      },
    };

    const { plan } = await router.route(unifiedRequest, {
      path: '/v1/route',
      qualityTarget,
      planOnly: true,
    });

    logger.info(
      { requestId, model: body.model, selected: plan.primary },
      'Route decision returned (no upstream call)'
    );

    return {
      decision: {
        provider_id: plan.primary.providerId,
        model_id: plan.primary.modelId,
        adapter_type: plan.primary.adapterType,
        score: plan.primary.score,
      },
      fallback_chain: plan.chain.map((step) => ({
        provider_id: step.provider.providerId,
        model_id: step.provider.modelId,
        score: step.provider.score,
      })),
      timeout_ms: plan.timeoutMs,
      max_retries: plan.maxRetries,
      request_id: requestId,
    };
  });
}
