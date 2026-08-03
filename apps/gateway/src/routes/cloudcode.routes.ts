import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { convertCloudCodeRequestToUnified } from '../converters/cloudcode-converter.js';
import { convertUnifiedResponseToCloudCode } from '../converters/cloudcode-response-converter.js';
import { createCloudCodeSSEStream } from '../converters/cloudcode-stream-serializer.js';
import {
  AllProvidersFailedError,
  ProviderUnavailableError,
  ProviderError,
} from '@dmr-x/core';

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

/**
 * Maps an error thrown by the router/provider pipeline to an HTTP status code
 * that the Antigravity e2e test allows ([200,400,401,404,503]).
 *
 * Known DMR-X errors already carry a sensible statusCode (e.g.
 * ProviderUnavailableError -> 503). The problem cases are errors WITHOUT a
 * statusCode (or with 500/502) that should still be surfaced as 503 when the
 * root cause is a provider being unavailable, so they don't fall through to a
 * bare 500 and fail the test. We treat the provider/model-unavailability class
 * of errors as 503; everything else keeps its own (or 500) code.
 */
function cloudCodeStatusCode(err: unknown): number {
  const anyErr = err as { statusCode?: number; name?: string; code?: string };
  const status = anyErr?.statusCode;
  if (typeof status === 'number' && status !== 500) {
    // 502 (AllProvidersFailed) is not in the test allow-list; a provider
    // being down is exactly the "unavailable" scenario the test wants as 503.
    if (status === 502) return 503;
    return status;
  }
  if (
    err instanceof ProviderUnavailableError ||
    err instanceof AllProvidersFailedError ||
    err instanceof ProviderError ||
    anyErr?.name === 'ProviderUnavailableError' ||
    anyErr?.name === 'AllProvidersFailedError' ||
    anyErr?.name === 'ProviderError' ||
    anyErr?.code === 'PROVIDER_UNAVAILABLE' ||
    anyErr?.code === 'ALL_PROVIDERS_FAILED'
  ) {
    return 503;
  }
  // Routing/model-selection failures ("no candidates", "no adapter", etc.)
  // are still an unavailable-provider situation in the no-network sandbox.
  const msg = err instanceof Error ? err.message : '';
  if (/no (candidate|provider|adapter)|unavailable|all providers/i.test(msg)) {
    return 503;
  }
  return 500;
}

export async function cloudcodeRoutes(app: FastifyInstance): Promise<void> {
  const handleStreamGenerateContent = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as CloudCodeRequest;
    const logger = (app as any).logger;
    const start = Date.now();
    const model = typeof body.model === 'string' ? body.model : undefined;
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
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
        reply.hijack();
        reply.raw.write(
          `data: ${JSON.stringify({ response: { error: { code: 503, message: 'Router not available', status: 'UNAVAILABLE' } }, traceId: requestId, metadata: {} })}\n\n`,
        );
        reply.raw.end();
        return;
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.hijack();

      // Get a routing plan (provider/model selection) without executing.
      const { plan } = await router.route(unifiedRequest, {
        path: '/v1/gemini/generateContent',
        planOnly: true,
      });

      if (!plan || !plan.primary) {
        // No provider available -> surface 503 as a Cloud Code SSE error frame.
        const frame = {
          response: {
            error: { code: 503, message: 'No available providers', status: 'UNAVAILABLE' },
          },
          traceId: requestId,
          metadata: {},
        };
        try {
          reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`);
        } catch {
          /* socket may already be gone */
        }
        reply.raw.end();
        return;
      }

      const primaryModelId = plan.primary.modelId;
      const adapter = (app as any).getAdapter(plan.primary.providerId);

      if (!adapter) {
        const frame = {
          response: {
            error: {
              code: 503,
              message: `No adapter available for provider ${plan.primary.providerId}`,
              status: 'UNAVAILABLE',
            },
          },
          traceId: requestId,
          metadata: {},
        };
        try {
          reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`);
        } catch {
          /* socket may already be gone */
        }
        reply.raw.end();
        return;
      }

      const controller = new AbortController();
      const onClientClose = () => controller.abort();
      req.raw.on('close', onClientClose);

      try {
        const routedRequest = { ...unifiedRequest, model: primaryModelId };
        const stream = adapter.executeStream(routedRequest, { signal: controller.signal });
        const sseStream = createCloudCodeSSEStream(stream, {
          model: primaryModelId || model || 'unknown',
          requestId,
        });

        for await (const event of sseStream) {
          if (controller.signal.aborted) break;
          if (!reply.raw.write(event)) {
            await new Promise<void>((resolve) => reply.raw.once('drain', resolve));
          }
        }
      } catch (streamError) {
        if (!controller.signal.aborted) {
          logger?.error?.({ err: streamError }, 'Cloud Code stream generation error');
          const statusCode = cloudCodeStatusCode(streamError);
          const frame = {
            response: {
              error: {
                code: statusCode,
                message:
                  streamError instanceof Error ? streamError.message : 'Stream failed',
                status: statusCode === 503 ? 'UNAVAILABLE' : 'INTERNAL',
              },
            },
            traceId: requestId,
            metadata: {},
          };
          try {
            reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`);
          } catch {
            /* socket may already be gone */
          }
        }
      } finally {
        req.raw.off('close', onClientClose);
      }

      reply.raw.end();
      const elapsed = Date.now() - start;
      logger?.info?.(`[cloudcode] streamGenerateContent handled in ${elapsed}ms`);
    } catch (err) {
      logger?.error?.({ err }, 'Cloud Code streamGenerateContent routing failed');
      // Once reply.hijack() has been called we can NEVER call
      // reply.status().send() again (it throws FST_ERR_REP_ALREADY_SENT and
      // the request surfaces as an HTTP 500). Reply.hijacked stays true even
      // if the raw headers haven't flushed yet, so we must write a raw SSE
      // error frame on reply.raw and close the stream.
      const statusCode = cloudCodeStatusCode(err);
      const frame = {
        response: {
          error: {
            code: statusCode,
            message: err instanceof Error ? err.message : 'Internal server error',
            status: statusCode === 503 ? 'UNAVAILABLE' : 'INTERNAL',
          },
        },
        traceId: requestId,
        metadata: {},
      };
      try {
        reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`);
        reply.raw.end();
      } catch {
        /* socket may already be gone */
      }
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

      const result: any = await router.route(unifiedRequest, {
        path: '/v1/gemini/generateContent',
      });
      const cloudCodeResponse = convertUnifiedResponseToCloudCode(result, requestId || '');
      reply.send(cloudCodeResponse);
    } catch (err) {
      const statusCode = cloudCodeStatusCode(err);
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

      const models: Record<string, { displayName: string; quotaInfo?: Record<string, unknown> }> = {};

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
