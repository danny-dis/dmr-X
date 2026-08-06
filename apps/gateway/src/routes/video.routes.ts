import { ValidationError, type UnifiedRequest } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { generateRequestId } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseQualityTarget } from '../utils/quality-target.js';
import { parseProviderPreferencesHeader } from '../utils/provider-preferences.js';

const VideoRequestSchema = z.object({
  model: z.string().optional(),
  prompt: z.string().min(1),
  image: z.string().optional().describe('Base64-encoded image or URL for img2video'),
  duration: z.number().int().min(2).max(120).optional().default(5).describe('Video duration in seconds (default 5)'),
  fps: z.number().int().positive().optional().default(24).describe('Frames per second (default 24)'),
  aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', 'auto']).optional().default('16:9'),
  resolution: z.enum(['480p', '720p', '1080p', '4k']).optional().default('720p'),
  quality: z.enum(['standard', 'hd']).optional().default('standard'),
  negative_prompt: z.string().optional().describe('Negative prompt to avoid unwanted elements'),
  generate_audio: z.boolean().optional().default(true).describe('Generate synchronized audio (Seedance, Veo, Kling)'),
  camera_fixed: z.boolean().optional().describe('Fix camera position (stabilize)'),
  camera_control: z.object({
    type: z.enum(['pan', 'tilt', 'zoom', 'dolly', 'crane', 'tracking', 'orbital']),
    direction: z.string().optional(),
    speed: z.enum(['slow', 'medium', 'fast']).optional(),
  }).optional().describe('Camera movement control'),
  reference_images: z.array(z.string()).max(9).optional().describe('Reference images (1-9) for character/style consistency'),
  reference_video: z.string().optional().describe('Reference video for style/motion guidance'),
  reference_audio: z.array(z.string()).max(3).optional().describe('Reference audio clips (1-3)'),
  last_frame_image: z.string().optional().describe('End-frame image for interpolation'),
  edit_video: z.string().optional().describe('Video URL to edit'),
  edit_instruction: z.string().optional().describe('Text instruction for video editing'),
  extend_video: z.string().optional().describe('Video URL to extend'),
  user: z.string().optional(),
});

export async function videoRoutes(server: FastifyInstance): Promise<void> {
  server.post('/video/generations', async (request, reply) => {
    const parsed = VideoRequestSchema.safeParse(request.body);
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
    const cached = checkRouteCache('video', tenantId, body as Record<string, unknown>);
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return cached.response;
    }

    const unifiedRequest: UnifiedRequest = {
      modality: 'video',
      model: body.model,
      prompt: body.prompt,
      image: body.image,
      duration: body.duration,
      fps: body.fps,
      aspect_ratio: body.aspect_ratio,
      resolution: body.resolution,
      negative_prompt: body.negative_prompt,
      generate_audio: body.generate_audio,
      camera_fixed: body.camera_fixed,
      camera_control: body.camera_control,
      reference_images: body.reference_images,
      reference_video: body.reference_video,
      reference_audio: body.reference_audio,
      last_frame_image: body.last_frame_image,
      edit_video: body.edit_video,
      edit_instruction: body.edit_instruction,
      extend_video: body.extend_video,
      stream: false,
      user: body.user,
      metadata: {
        requestId,
        quality: body.quality,
        tenant: (request as any).tenant,
        ...(providerPreferences ? { providerPreferences } : {}),
      },
    };

    const { response } = await router.route(unifiedRequest, {
      path: '/v1/video/generations',
      qualityTarget,
    });
    if (response?.providerId) {
      reply.header('X-DMRX-Provider-Id', response.providerId);
    }

    const result = {
      created: Math.floor(Date.now() / 1000),
      data: response.videos || [],
    };

    storeRouteCache('video', tenantId, body as Record<string, unknown>, result);
    reply.header('X-Cache', 'MISS');
    return result;
  });
}