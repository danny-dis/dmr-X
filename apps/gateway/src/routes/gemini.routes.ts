import { ValidationError, ProviderUnavailableError } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  convertGeminiRequestToUnified,
  convertUnifiedResponseToGemini,
} from '../converters/gemini-converter.js';
import { createGeminiSSEStream } from '../converters/gemini-stream-serializer.js';
import {
  geminiWireError,
  shouldExposeInternalError,
} from '../lib/wire-errors.js';
import { parseQualityTarget } from '../utils/quality-target.js';
import { compressionService } from '../services/compression.js';

// --- Zod schemas for Gemini wire format ---

const GeminiPartSchema = z.union([
  z.object({ text: z.string(), thought: z.boolean().optional() }),
  z.object({ functionCall: z.object({ name: z.string(), args: z.record(z.unknown()) }) }),
  z.object({ functionResponse: z.object({ name: z.string(), response: z.record(z.unknown()) }) }),
  z.object({ inlineData: z.object({ mimeType: z.string(), data: z.string() }) }),
]);

const GeminiContentSchema = z.object({
  role: z.enum(['user', 'model', 'function']),
  parts: z.array(GeminiPartSchema).min(1),
});

const GeminiToolDeclarationSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
});

const GeminiGenerateContentRequestSchema = z.object({
  contents: z.array(GeminiContentSchema).min(1),
  systemInstruction: GeminiContentSchema.optional(),
  tools: z.array(z.object({
    functionDeclarations: z.array(GeminiToolDeclarationSchema),
  })).optional(),
  toolConfig: z.object({
    functionCallingConfig: z.object({
      mode: z.enum(['AUTO', 'ANY', 'NONE']).optional(),
      allowedFunctionNames: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
  generationConfig: z.object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    topK: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    stopSequences: z.array(z.string()).optional(),
    candidateCount: z.number().int().positive().optional(),
    responseMimeType: z.string().optional(),
    responseSchema: z.record(z.unknown()).optional(),
    thinkingConfig: z.object({ thinkingBudget: z.number().int().optional() }).optional(),
  }).optional(),
  safetySettings: z.array(z.object({
    category: z.string(),
    threshold: z.string(),
  })).optional(),
  stream: z.boolean().optional().default(false),
});

/**
 * Shared handler for both the DMR-X path (`/v1/gemini/generateContent`) and
 * the Google-native path (`/v1beta/models/<model>:generateContent`).
 *
 * `modelOverride` carries the model the caller named in the URL. The Gemini
 * wire format has no `model` field in the body — Google puts it in the path —
 * so without this the converter always emitted `model: undefined` and the
 * router picked whatever it liked. A client asking for `gemini-2.5-flash`
 * silently got some other model.
 *
 * `forceStream` lets `:streamGenerateContent` stream even though the body has
 * no `stream` flag, which again is how the real API works.
 */
async function handleGenerateContent(
  server: FastifyInstance,
  request: any,
  reply: any,
  opts: { modelOverride?: string; forceStream?: boolean; routePath: string } ,
): Promise<unknown> {
    const parsed = GeminiGenerateContentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid Gemini request', {
        errors: parsed.error.errors,
      });
    }

    const body = parsed.data;
    if (opts.forceStream) body.stream = true;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);

    // Apply compression if enabled
    let compressionMetadata = undefined;
    const tenantId = (request as any).tenant?.id;
    const apiKeyId = (request as any).apiKeyId;

    if (tenantId || apiKeyId) {
      try {
        const tenantConfig = tenantId ? compressionService.getTenantConfig(tenantId) : undefined;
        const apiKeyConfig = apiKeyId ? compressionService.getApiKeyConfig(apiKeyId) : undefined;

        if (tenantConfig?.enabled || apiKeyConfig?.enabled) {
          // Convert Gemini contents to standard format for compression
          const messagesForCompression = body.contents.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: c.parts.map(p => ('text' in p ? p.text : '') || '').join(''),
          }));

          const { compressed, metadata } = await compressionService.compressPrompt(
            messagesForCompression,
            tenantConfig,
            apiKeyConfig
          );

          // Convert back to Gemini format
          body.contents = compressed.map((m, i) => ({
            ...body.contents[i],
            parts: [{ text: m.content }],
          }));

          compressionMetadata = metadata;
          logger.debug({ requestId, saved: metadata.saved }, 'Applied compression to Gemini request');
        }
      } catch (err) {
        logger.warn({ err, requestId }, 'Compression failed for Gemini request, continuing without');
      }
    }

    const converted = convertGeminiRequestToUnified(body, {
      requestId,
      tenant: (request as any).tenant,
      apiFormat: 'gemini',
      costFilter: (request.headers['x-cost-filter'] as 'free' | 'all') || undefined,
    });
    // Honour the model named in the URL. Meta aliases ("auto", "free", …) are
    // passed through untouched so `/v1beta/models/auto:generateContent` routes
    // exactly like the OpenAI surface does.
    const unifiedRequest = opts.modelOverride
      ? { ...converted, model: opts.modelOverride }
      : converted;

    if (body.stream) {
      // Streaming: get routing plan only, then stream from adapter
      const { plan } = await router.route(unifiedRequest, {
        path: opts.routePath,
        qualityTarget,
        planOnly: true,
      });

      if (!plan.primary) {
        reply.raw.writeHead(503, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        reply.raw.write(`data: ${JSON.stringify({ error: { message: 'No available providers', code: 503 } })}\n\n`);
        reply.raw.end();
        return;
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const adapter = (server as any).getAdapter(plan.primary.providerId);
      if (adapter) {
        // CRIT-5: AbortController wired to client disconnect — see
        // chat.routes.ts for the full rationale.
        const controller = new AbortController();
        const onClientClose = () => controller.abort();
        request.raw.on('close', onClientClose);

        try {
          const routedRequest = { ...unifiedRequest, model: plan.primary.modelId };
          const stream = adapter.executeStream(routedRequest, { signal: controller.signal });
          for await (const sseLine of createGeminiSSEStream(stream, {
            model: plan.primary.modelId,
            requestId,
          })) {
            if (controller.signal.aborted) break;
            // Backpressure: pause writing if the response buffer is full.
            if (!reply.raw.write(sseLine)) {
              await new Promise<void>(resolve => reply.raw.once('drain', resolve));
            }
          }
        } catch (streamError) {
          if (controller.signal.aborted) {
            logger.debug({ requestId }, 'Gemini stream aborted by client disconnect');
          } else {
            logger.error({ err: streamError, requestId }, 'Gemini streaming error');
            if (!reply.raw.write(`data: ${JSON.stringify({ error: { message: 'Stream failed', code: 500 } })}\n\n`)) {
              await new Promise<void>(resolve => reply.raw.once('drain', resolve));
            }
          }
        } finally {
          request.raw.off('close', onClientClose);
        }
      } else {
        reply.raw.write(`data: ${JSON.stringify({ error: { message: 'No adapter available for provider', code: 503 } })}\n\n`);
      }
      reply.raw.end();
      return reply;
    }

    // Non-streaming: route and execute
    const { plan, response } = await router.route(unifiedRequest, {
      path: opts.routePath,
      qualityTarget,
    });
    if (!plan.primary) {
      throw new ProviderUnavailableError([]);
    }

    return convertUnifiedResponseToGemini(response);
}

export async function geminiRoutes(server: FastifyInstance): Promise<void> {
  // Encapsulated error handler: non-streaming failures on the DMR-X
  // `/gemini/generateContent` path are serialized in the Gemini wire format
  // (`{ error: { code, message, status } }`) that the official SDKs parse.
  // Streaming errors stay inline as `data:` SSE (see handleGenerateContent).
  server.setErrorHandler((error, request, reply) => {
    const err = error as { statusCode?: number; message?: string } & Error;
    logger.error({ err, req: request, requestId: request.id }, `Gemini API error: ${err.message}`);
    const { statusCode, body } = geminiWireError(err, {
      exposeMessage: shouldExposeInternalError(),
      requestId: request.id,
    });
    return reply.status(statusCode).send(body);
  });

  // DMR-X's own path. Kept verbatim — existing clients depend on it, and it
  // has no model in the URL, so the router chooses as it always has.
  server.post('/gemini/generateContent', async (request, reply) =>
    handleGenerateContent(server, request, reply, {
      routePath: '/v1/gemini/generateContent',
    }),
  );
}

/**
 * Google-native surface, mounted at the server root so the paths match
 * `generativelanguage.googleapis.com` exactly:
 *
 *   POST /v1beta/models/gemini-2.5-flash:generateContent
 *   POST /v1beta/models/gemini-2.5-flash:streamGenerateContent
 *   POST /v1/models/gemini-2.5-flash:generateContent
 *
 * Without these, pointing a real Gemini SDK at DMR-X 404'd: the SDK builds
 * that URL itself and cannot be told to call `/v1/gemini/generateContent`.
 * Supporting them is what makes "Gemini wire format" true for actual clients
 * rather than only for hand-rolled requests.
 *
 * Fastify cannot express the `<model>:<action>` segment as two params, so the
 * whole segment is captured and split on the LAST colon — model ids may
 * themselves contain colons (e.g. `tencent/hy3:free`).
 */
export async function geminiNativeRoutes(server: FastifyInstance): Promise<void> {
  // Encapsulated error handler for the Google-native surface, same rationale
  // as geminiRoutes: real Gemini SDKs read `error.code`/`error.status`.
  server.setErrorHandler((error, request, reply) => {
    const err = error as { statusCode?: number; message?: string } & Error;
    logger.error({ err, req: request, requestId: request.id }, `Gemini native API error: ${err.message}`);
    const { statusCode, body } = geminiWireError(err, {
      exposeMessage: shouldExposeInternalError(),
      requestId: request.id,
    });
    return reply.status(statusCode).send(body);
  });

  const handler = async (request: any, reply: any) => {
    const segment = String((request.params as { modelAction: string }).modelAction ?? '');
    const sep = segment.lastIndexOf(':');
    if (sep <= 0) {
      throw new ValidationError(
        `Malformed Gemini path segment "${segment}" — expected "<model>:generateContent"`,
      );
    }
    const model = decodeURIComponent(segment.slice(0, sep));
    const action = segment.slice(sep + 1);

    if (action !== 'generateContent' && action !== 'streamGenerateContent') {
      // Gemini wire shape (`{ error: { code, message, status } }`), not the
      // gateway-wide shape — real SDKs read error.code / error.status.
      reply.status(404);
      return {
        error: {
          code: 404,
          message: `Unsupported Gemini action "${action}". Supported: generateContent, streamGenerateContent.`,
          status: 'NOT_FOUND',
        },
      };
    }

    return handleGenerateContent(server, request, reply, {
      modelOverride: model,
      forceStream: action === 'streamGenerateContent',
      routePath: `/v1beta/models/${model}:${action}`,
    });
  };

  server.post('/v1beta/models/:modelAction', handler);
  server.post('/v1/models/:modelAction', handler);
}
