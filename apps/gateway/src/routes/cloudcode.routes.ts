import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { UnifiedRequest } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';

import {
  convertCloudCodeRequestToUnified,
  type CloudCodeRequest,
} from '../converters/cloudcode-converter.js';
import { convertUnifiedResponseToCloudCode } from '../converters/cloudcode-response-converter.js';
import { createCloudCodeSSEStream } from '../converters/cloudcode-stream-serializer.js';

// ---------------------------------------------------------------------------
// Cloud Code Routes
//
// These endpoints accept Google Cloud Code protocol requests (used by
// Antigravity/agy CLI) and translate them to DMR-X's internal format.
// ---------------------------------------------------------------------------

export async function cloudcodeRoutes(app: FastifyInstance): Promise<void> {
  // -----------------------------------------------------------------------
  // POST /v1internal:streamGenerateContent
  //
  // Main streaming endpoint. agy sends requests here and expects SSE
  // responses in Cloud Code format.
  // -----------------------------------------------------------------------
  app.post('/v1internal:streamGenerateContent', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as CloudCodeRequest;
    const start = Date.now();

    try {
      // Convert Cloud Code request to UnifiedRequest
      const unifiedRequest = convertCloudCodeRequestToUnified(body, {
        source: 'antigravity',
        clientIp: req.ip,
      });

      // Get the router from the server
      const router = (app as any).router;
      if (!router) {
        return reply.status(503).send({
          error: { code: 503, message: 'Router not available', status: 'UNAVAILABLE' },
        });
      }

      // Set up SSE headers
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.hijack();

      // Execute via router (which handles provider selection + execution)
      const model = body.model || undefined;
      const requestId = body.requestId || `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Use the router's streaming path
      const stream = router.executeStream(unifiedRequest, { model });

      // Convert DMR-X StreamChunks to Cloud Code SSE format
      const sseStream = createCloudCodeSSEStream(stream, {
        model: model || 'unknown',
        requestId,
      });

      // Write SSE events to the response
      for await (const event of sseStream) {
        reply.raw.write(event);
      }

      reply.raw.end();
    } catch (err) {
      logger.error({ err }, 'Cloud Code streamGenerateContent failed');

      // If headers already sent, just end the response
      if (reply.raw.headersSent) {
        reply.raw.end();
        return;
      }

      const errorResponse = {
        error: {
          code: 500,
          message: err instanceof Error ? err.message : 'Internal server error',
          status: 'INTERNAL',
        },
      };
      reply.status(500).send(errorResponse);
    }
  });

  // -----------------------------------------------------------------------
  // POST /v1internal:generateContent
  //
  // Non-streaming endpoint. Same conversion logic but returns a single
  // response instead of SSE.
  // -----------------------------------------------------------------------
  app.post('/v1internal:generateContent', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as CloudCodeRequest;

    try {
      const unifiedRequest = convertCloudCodeRequestToUnified(body, {
        source: 'antigravity',
        clientIp: req.ip,
      });

      const router = (app as any).router;
      if (!router) {
        return reply.status(503).send({
          error: { code: 503, message: 'Router not available', status: 'UNAVAILABLE' },
        });
      }

      const model = body.model || undefined;
      const requestId = body.requestId || `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Execute non-streaming
      const response = await router.execute(unifiedRequest, { model });

      // Convert to Cloud Code format
      const cloudCodeResponse = convertUnifiedResponseToCloudCode(response, requestId);
      reply.send(cloudCodeResponse);
    } catch (err) {
      logger.error({ err }, 'Cloud Code generateContent failed');

      const statusCode = (err as any)?.statusCode ?? 500;
      reply.status(statusCode).send({
        error: {
          code: statusCode,
          message: err instanceof Error ? err.message : 'Internal server error',
          status: statusCode === 503 ? 'UNAVAILABLE' : 'INTERNAL',
        },
      });
    }
  });

  // -----------------------------------------------------------------------
  // POST /v1internal:loadCodeAssist
  //
  // Returns project info and credits. agy calls this on startup to get
  // a project ID for subsequent requests.
  // -----------------------------------------------------------------------
  app.post('/v1internal:loadCodeAssist', async (req: FastifyRequest, reply: FastifyReply) => {
    // Return a mock project response. The project ID is used in subsequent
    // streamGenerateContent requests but DMR-X doesn't need it for routing.
    reply.send({
      cloudaicompanionProject: 'dmrx-gateway',
      currentTier: {
        name: 'dmrx-tier',
      },
      availablePromptCredits: 999999,
      planInfo: {
        planName: 'DMR-X Gateway',
        billingEnabled: false,
      },
    });
  });

  // -----------------------------------------------------------------------
  // POST /v1internal:fetchAvailableModels
  //
  // Returns models available through DMR-X. agy uses this to populate
  // its model selector.
  // -----------------------------------------------------------------------
  app.post('/v1internal:fetchAvailableModels', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const registryService = (app as any).registryService;
      const db = (app as any).db;

      // Fetch models from the registry
      let models: Record<string, { displayName: string; quotaInfo?: Record<string, unknown> }> = {};

      if (registryService) {
        const candidates = await registryService.getCandidates();
        for (const candidate of candidates) {
          models[candidate.modelId] = {
            displayName: candidate.modelId,
            quotaInfo: {
              remainingFraction: 1.0,
              isExhausted: false,
            },
          };
        }
      }

      // If no models found, return a default set
      if (Object.keys(models).length === 0) {
        models = {
          'gemini-2.5-pro': { displayName: 'Gemini 2.5 Pro' },
          'gemini-2.5-flash': { displayName: 'Gemini 2.5 Flash' },
          'claude-sonnet-4-5': { displayName: 'Claude Sonnet 4.5' },
          'gpt-4o': { displayName: 'GPT-4o' },
        };
      }

      reply.send({ models });
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch available models for Cloud Code');
      // Return default models on error
      reply.send({
        models: {
          'gemini-2.5-pro': { displayName: 'Gemini 2.5 Pro' },
          'gemini-2.5-flash': { displayName: 'Gemini 2.5 Flash' },
        },
      });
    }
  });
}
