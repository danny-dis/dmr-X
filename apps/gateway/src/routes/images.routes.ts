import { ValidationError, type UnifiedRequest } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { generateRequestId } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseQualityTarget } from '../utils/quality-target.js';
import { parseProviderPreferencesHeader } from '../utils/provider-preferences.js';

const ImageRequestSchema = z.object({
  model: z.string().optional(),
  prompt: z.string().min(1),
  negative_prompt: z.string().optional(),
  n: z.number().positive().max(10).optional().default(1),
  size: z.enum(['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792']).optional().default('1024x1024'),
  quality: z.enum(['standard', 'hd']).optional().default('standard'),
  response_format: z.enum(['url', 'b64_json']).optional().default('url'),
  style: z.enum(['vivid', 'natural']).optional(),
  steps: z.number().int().positive().max(150).optional(),
  seed: z.number().int().optional(),
  cfg_scale: z.number().min(1).max(30).optional(),
  user: z.string().optional(),
});

export async function imagesRoutes(server: FastifyInstance): Promise<void> {
  server.post('/images/generations', async (request, reply) => {
    const parsed = ImageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const [width, height] = body.size.split('x').map(Number);
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);
    const providerPreferences = parseProviderPreferencesHeader(request.headers['x-provider-preferences'] as string | undefined);

    const tenantId = (request as any).tenant?.id;
    const { checkRouteCache, storeRouteCache } = await import('@dmr-x/cache');
    // The cache key is body-only (services/cache/src/cache.service.ts:
    // generateCacheKey doesn't factor in headers), so a providerPreferences
    // request must not read from or write to it — a hit could silently
    // return a response from a provider this call was told to exclude.
    const skipCache = (b: any) => b.response_format === 'b64_json' || !!providerPreferences;
    const cached = checkRouteCache('image', tenantId, body as Record<string, unknown>, skipCache);
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return cached.response;
    }

    const unifiedRequest: UnifiedRequest = {
      modality: 'diffusion',
      model: body.model,
      prompt: body.prompt,
      negative_prompt: body.negative_prompt,
      width,
      height,
      steps: body.steps,
      diffusion_seed: body.seed,
      cfg_scale: body.cfg_scale,
      stream: false,
      user: body.user,
      n: body.n,
      metadata: {
        requestId,
        quality: body.quality,
        style: body.style,
        responseFormat: body.response_format,
        tenant: (request as any).tenant,
        ...(providerPreferences ? { providerPreferences } : {}),
      },
    };

    const { response } = await router.route(unifiedRequest, {
      path: '/v1/images/generations',
      qualityTarget,
    });
    if (response?.providerId) {
      reply.header('X-DMRX-Provider-Id', response.providerId);
    }

    const result = {
      created: Math.floor(Date.now() / 1000),
      data: response.images || [],
    };

    storeRouteCache('image', tenantId, body as Record<string, unknown>, result, { skipCache });
    reply.header('X-Cache', 'MISS');
    return result;
  });
}
