import { ValidationError, type UnifiedRequest } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { generateRequestId } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseQualityTarget } from '../utils/quality-target.js';
import { parseProviderPreferencesHeader } from '../utils/provider-preferences.js';

const Generate3DRequestSchema = z.object({
  model: z.string().optional(),
  prompt: z.string().optional().describe('Text description for text-to-3d generation'),
  image: z.string().optional().describe('Base64-encoded image or URL for image-to-3d generation'),
  texture_resolution: z.number().int().positive().optional().default(1024).describe('Texture resolution (default 1024)'),
  seed: z.number().int().optional().describe('Random seed for reproducibility'),
  user: z.string().optional(),
}).refine(data => data.prompt || data.image, {
  message: 'Either prompt or image is required',
});

export async function threeDRoutes(server: FastifyInstance): Promise<void> {
  server.post('/3d/generate', async (request, reply) => {
    const parsed = Generate3DRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);
    const providerPreferences = parseProviderPreferencesHeader(request.headers['x-provider-preferences'] as string | undefined);

    const tenantId = (request as any).tenant?.id;
    const { checkRouteCache, storeRouteCache } = await import('@dmr-x/cache');
    // The cache key is body-only (services/cache/src/cache.service.ts), so a
    // providerPreferences request must not read from or write to it.
    const cached = providerPreferences ? null : checkRouteCache('3d', tenantId, body as Record<string, unknown>);
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return cached.response;
    }

    const unifiedRequest: UnifiedRequest = {
      modality: '3d',
      model: body.model,
      prompt: body.prompt,
      image: body.image,
      texture_resolution: body.texture_resolution,
      diffusion_seed: body.seed,
      stream: false,
      user: body.user,
      metadata: {
        requestId,
        tenant: (request as any).tenant,
        ...(providerPreferences ? { providerPreferences } : {}),
      },
    };

    const { response } = await router.route(unifiedRequest, {
      path: '/v1/3d/generate',
      qualityTarget,
    });
    if (response?.providerId) {
      reply.header('X-DMRX-Provider-Id', response.providerId);
    }

    const result = {
      created: Math.floor(Date.now() / 1000),
      data: response.models3d || [],
    };

    if (!providerPreferences) {
      storeRouteCache('3d', tenantId, body as Record<string, unknown>, result);
    }
    reply.header('X-Cache', 'MISS');
    return result;
  });
}