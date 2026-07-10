import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { convertCloudCodeRequestToUnified } from '../converters/cloudcode-converter.js';
import { convertUnifiedResponseToCloudCode } from '../converters/cloudcode-response-converter.js';
import { createCloudCodeSSEStream } from '../converters/cloudcode-stream-serializer.js';

// Cloud Code Routes
//
// These endpoints accept Google Cloud Code protocol requests (used by
// Antigravity/agy CLI) and translate them to DMR-X's internal format.
//
// NOTE: The Antigravity protocol paths contain a literal colon
// (e.g. /v1internal:streamGenerateContent). Fastify's router (find-my-way)
// treats ':' as a path-parameter delimiter and HANGS indefinitely when
// compiling such a route. To preserve the exact external paths while
// avoiding the router hang, we register a single wildcard route and
// dispatch on the raw request URL instead.

type CloudCodeRequest = Record<string, unknown>;

export async function cloudcodeRoutes(app: FastifyInstance): Promise<void> {
  const handleStreamGenerateContent = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as CloudCodeRequest;
    const logger = (app as any).logger;
    const start = Date.now();

    try {
      const unifiedRequest = convertCloudCodeRequestToUnified(body, {
        source: 'antigravity',
        clientIp: req.ip,
      });

      const router = (app as any).router;
      if (!router) {
        reply.status(503).send({
          error: { code: 503, message: 'Router not available', status: 'UNAVAILABLE' },
        });
        return;
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.hijack();

      const model = typeof body.model === 'string' ? body.model : undefined;
      const requestId =
        typeof body.requestId === 'string'
          ? body.requestId
          : `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const stream = router.executeStream(unifiedRequest, { model });
      const sseStream = createCloudCodeSSEStream(stream, { model: model || 'unknown', requestId });

      for await (const event of sseStream) {
        reply.raw.write(event);
      }
      reply.raw.end();

      const elapsed = Date.now() - start;
      logger?.info?.(`[cloudcode] streamGenerateContent handled in ${elapsed}ms`);
    } catch (err) {
      logger?.error?.({ err }, 'Cloud Code streamGenerateContent failed');
      if (reply.raw.headersSent) {
        reply.raw.end();
        return;
      }
      const statusCode = (err as any)?.statusCode || 500;
      reply.status(statusCode).send({
        error: {
          code: statusCode,
          message: err instanceof Error ? err.message : 'Internal server error',
          status: statusCode === 503 ? 'UNAVAILABLE' : 'INTERNAL',
        },
      });
    }
  };

  const handleGenerateContent = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as CloudCodeRequest;
    const requestId =
      typeof body.requestId === 'string'
        ? body.requestId
        : `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const unifiedRequest = convertCloudCodeRequestToUnified(body, {
        source: 'antigravity',
        clientIp: req.ip,
      });

      const router = (app as any).router;
      if (!router) {
        reply.status(503).send({
          error: { code: 503, message: 'Router not available', status: 'UNAVAILABLE' },
        });
        return;
      }

      const result: any = await router.route(unifiedRequest);
      const cloudCodeResponse = convertUnifiedResponseToCloudCode(result, requestId || '');
      reply.send(cloudCodeResponse);
    } catch (err) {
      const statusCode = (err as any)?.statusCode || 500;
      reply.status(statusCode).send({
        error: {
          code: statusCode,
          message: err instanceof Error ? err.message : 'Internal server error',
          status: statusCode === 503 ? 'UNAVAILABLE' : 'INTERNAL',
        },
      });
    }
  };

  const handleLoadCodeAssist = async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({
      cloudaicompanionProject: 'dmrx-gateway',
      currentTier: { name: 'dmrx-tier' },
      availablePromptCredits: 999999,
      planInfo: { planName: 'DMR-X Gateway', billingEnabled: false },
    });
  };

  const handleFetchAvailableModels = async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const registryService = (app as any).registryService;
      const db = (app as any).db;

      let models: Record<string, { displayName: string; quotaInfo?: Record<string, unknown> }> = {};

      if (registryService) {
        const allModels = await registryService.listModels?.();
        if (Array.isArray(allModels)) {
          for (const m of allModels) {
            models[m.id] = { displayName: m.displayName || m.id };
          }
        }
      } else if (db) {
        const rows = db.prepare('SELECT id, display_name FROM models').all() as Array<{
          id: string;
          display_name: string;
        }>;
        for (const r of rows) {
          models[r.id] = { displayName: r.display_name || r.id };
        }
      }

      reply.send({
        models: Object.entries(models).map(([id, info]) => ({
          id,
          displayName: info.displayName,
          quotaInfo: info.quotaInfo || {},
        })),
      });
    } catch (err) {
      reply.status(500).send({
        error: {
          code: 500,
          message: err instanceof Error ? err.message : 'Internal server error',
          status: 'INTERNAL',
        },
      });
    }
  };

  const dispatcher = async (req: FastifyRequest, reply: FastifyReply) => {
    const url = (req.url || '').split('?')[0];
    if (url.endsWith(':streamGenerateContent') || url.endsWith('streamGenerateContent')) {
      return handleStreamGenerateContent(req, reply);
    }
    if (url.endsWith(':generateContent') || url.endsWith('generateContent')) {
      return handleGenerateContent(req, reply);
    }
    if (url.endsWith(':loadCodeAssist') || url.endsWith('loadCodeAssist')) {
      return handleLoadCodeAssist(req, reply);
    }
    if (url.endsWith(':fetchAvailableModels') || url.endsWith('fetchAvailableModels')) {
      return handleFetchAvailableModels(req, reply);
    }
    reply.status(404).send({ error: { code: 404, message: 'Unknown Cloud Code endpoint', status: 'NOT_FOUND' } });
  };

  // Single wildcard route — preserves the exact external Antigravity paths
  // (which contain literal colons) without triggering find-my-way's
  // path-parameter parsing hang.
  app.post('/v1internal*', dispatcher);
}
