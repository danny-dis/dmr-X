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

export async function geminiRoutes(server: FastifyInstance): Promise<void> {
  server.post('/gemini/generateContent', async (request, reply) => {
    const parsed = GeminiGenerateContentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid Gemini request', {
        errors: parsed.error.errors,
      });
    }

    const body = parsed.data;
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

    const unifiedRequest = convertGeminiRequestToUnified(body, {
      requestId,
      tenant: (request as any).tenant,
      apiFormat: 'gemini',
      costFilter: (request.headers['x-cost-filter'] as 'free' | 'all') || undefined,
    });

    if (body.stream) {
      // Streaming: get routing plan only, then stream from adapter
      const { plan } = await router.route(unifiedRequest, {
        path: '/v1/gemini/generateContent',
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
      path: '/v1/gemini/generateContent',
      qualityTarget,
    });
    if (!plan.primary) {
      throw new ProviderUnavailableError([]);
    }

    return convertUnifiedResponseToGemini(response);
  });
}
