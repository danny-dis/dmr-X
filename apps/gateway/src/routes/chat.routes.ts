import { ValidationError, ProviderUnavailableError, type UnifiedRequest } from '@dmr-x/core';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
import type { Router } from '@dmr-x/router';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ChatMessageSchema, ToolSchema } from './shared-schemas.js';
import { parseQualityTarget } from '../utils/quality-target.js';
import { compressionService } from '../services/compression.js';
import { semanticCacheService } from '@dmr-x/cache';

const ChatRequestSchema = z.object({
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

export async function chatRoutes(server: FastifyInstance): Promise<void> {
  server.post('/chat/completions', async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);

    // Apply compression if enabled
    let compressionMetadata = undefined;
    const tenantId = (request as any).tenant?.id;
    const apiKeyId = (request as any).apiKeyId;
    const compressionHeader = request.headers['x-compression'] as string;

    if (tenantId || apiKeyId || compressionHeader) {
      try {
        const tenantConfig = tenantId ? compressionService.getTenantConfig(tenantId) : undefined;
        const apiKeyConfig = apiKeyId ? compressionService.getApiKeyConfig(apiKeyId) : undefined;

        // Allow per-request engine override via header
        const headerConfig = compressionHeader ? { enabled: true, engine: compressionHeader as any } : undefined;

        if (tenantConfig?.enabled || apiKeyConfig?.enabled || headerConfig) {
          const messagesForCompression = body.messages.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          }));

          const { compressed, metadata } = await compressionService.compressPrompt(
            messagesForCompression,
            tenantConfig,
            apiKeyConfig ?? headerConfig
          );

          // Convert back to original format
          body.messages = compressed.map((m, i) => ({
            ...body.messages[i],
            content: m.content,
          })) as any;

          compressionMetadata = metadata;
          logger.debug({ requestId, saved: metadata.saved, engine: metadata.algorithmUsed }, 'Applied compression');
        }
      } catch (err) {
        logger.warn({ err, requestId }, 'Compression failed, continuing without');
      }
    }

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

    if (body.stream) {
      if (unifiedRequest.metadata?.freeTierStrategy) {
        reply.header('X-Free-Tier-Strategy', String(unifiedRequest.metadata.freeTierStrategy));
      }

      const streamHeaders: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };
      reply.raw.writeHead(200, streamHeaders);

      let plan;
      try {
        const routed = await router.route(unifiedRequest, {
          path: '/v1/chat/completions',
          qualityTarget,
          planOnly: true,
        });
        plan = routed.plan;
      } catch (routeError: any) {
        const errMsg = routeError?.message || 'Routing failed';
        logger.error({ err: routeError, requestId }, 'Streaming chat routing error');
        (server as any).recordTelemetryEvent?.({
          level: 'error',
          service: 'gateway',
          message: errMsg,
          metadata: { path: request.url, model: body.model, requestId },
        });
        reply.raw.write(`data: ${JSON.stringify({
          error: { message: errMsg, type: 'routing_error' },
        })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return reply;
      }

      if (!plan.primary) {
        (server as any).recordTelemetryEvent?.({
          level: 'warning',
          service: 'gateway',
          message: 'No provider available for streaming chat request',
          metadata: { path: request.url, model: body.model, requestId },
        });
        reply.raw.write(`data: ${JSON.stringify({
          error: { message: 'No provider available for this request', type: 'routing_error' },
        })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return reply;
      }

      const rls = (server as any).rateLimitService as RateLimitService | undefined;
      const qs = (server as any).quotaService as QuotaService | undefined;
      const tenantId = (request as any).tenant?.id;

      if (rls) {
        const limitCheck = rls.checkLimit(plan.primary.providerId, plan.primary.modelId, 0);
        if (!limitCheck.allowed) {
          (server as any).recordTelemetryEvent?.({
            level: 'warning',
            service: 'gateway',
            message: 'Rate limit hit on streaming chat request',
            metadata: {
              path: request.url,
              providerId: plan.primary.providerId,
              modelId: plan.primary.modelId,
              requestId,
              retryAfterMs: limitCheck.retryAfterMs,
            },
          });
          reply.raw.write(`data: ${JSON.stringify({
            error: { message: `Rate limited. Retry after ${limitCheck.retryAfterMs ? Math.ceil(limitCheck.retryAfterMs / 1000) : 30}s`, type: 'rate_limit_error' },
          })}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
          return reply;
        }
      }
      if (qs && tenantId) {
        try {
          await qs.checkQuota(tenantId, plan.primary.providerId, 0, 0);
        } catch (quotaError: any) {
          reply.raw.write(`data: ${JSON.stringify({
            error: { message: quotaError?.message || 'Quota exceeded', type: 'quota_error' },
          })}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
          return reply;
        }
      }

      const adapter = (server as any).getAdapter(plan.primary.providerId);
      if (adapter) {
        const controller = new AbortController();
        const onClientClose = () => controller.abort();
        request.raw.on('close', onClientClose);

        try {
          const routedRequest = { ...unifiedRequest, model: plan.primary.modelId };
          (request as any).metrics = {
            providerId: plan.primary.providerId,
            modelId: plan.primary.modelId,
            modality: unifiedRequest.modality ?? 'llm',
            tenantId,
            taskProfile: unifiedRequest.modality,
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
            firstTokenLatencyMs: undefined,
            tokens: undefined,
            errorCode: undefined,
            qualityTarget,
            freeTierStrategy: unifiedRequest.metadata?.freeTierStrategy ?? undefined,
            compression: compressionMetadata ? {
              saved: compressionMetadata.saved,
              algorithm: compressionMetadata.algorithmUsed,
            } : undefined,
          };
          const stream = adapter.executeStream(routedRequest, { signal: controller.signal });
          const streamStart = Date.now();
          let firstTokenAt: number | undefined;
          let streamErrorCode: string | undefined;
          let streamPromptTokens = 0;
          let streamCompletionTokens = 0;
          const collectedContent: string[] = [];
          for await (const chunk of stream) {
            if (controller.signal.aborted) break;
            if (chunk.type === 'token' && firstTokenAt === undefined) {
              firstTokenAt = Date.now();
              (request as any).metrics.firstTokenLatencyMs = firstTokenAt - streamStart;
            }
            if (chunk.type === 'done' && (chunk.data as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | undefined)?.usage) {
              const usage = (chunk.data as { usage: { prompt_tokens?: number; completion_tokens?: number } }).usage;
              streamPromptTokens = usage.prompt_tokens ?? streamPromptTokens;
              streamCompletionTokens = usage.completion_tokens ?? streamCompletionTokens;
            }
            if (chunk.type === 'token' && chunk.data?.content) {
              collectedContent.push(chunk.data.content);
            }
            let data: string;
            if (chunk.type === 'token') {
              data = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: chunk.data, finish_reason: null }],
              })}\n\n`;
            } else if (chunk.type === 'done') {
              data = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              })}\n\n`;
            } else if (chunk.type === 'error') {
              logger.error({ requestId, chunkError: chunk.data }, 'Adapter stream error chunk');
              streamErrorCode = (chunk.data as { code?: string } | undefined)?.code ?? 'stream_error';
              data = `data: ${JSON.stringify({
                error: { message: 'Stream error', type: 'stream_error' },
              })}\n\n`;
            } else {
              continue;
            }
            if (!reply.raw.write(data)) {
              await new Promise<void>(resolve => reply.raw.once('drain', resolve));
            }
          }
          if (streamPromptTokens || streamCompletionTokens) {
            (request as any).metrics.tokens = {
              prompt: streamPromptTokens,
              completion: streamCompletionTokens,
              total: streamPromptTokens + streamCompletionTokens,
            };
          }
          if (streamErrorCode) {
            (request as any).metrics.errorCode = streamErrorCode;
          }
          try {
            if (rls) {
              await rls.recordUsage(plan.primary.providerId, plan.primary.modelId, streamPromptTokens + streamCompletionTokens);
            }
            if (qs && tenantId) {
              await qs.recordUsage(tenantId, plan.primary.providerId, streamPromptTokens + streamCompletionTokens, 0);
            }
          } catch (usageErr) {
            logger.warn({ err: usageErr, provider: plan.primary.providerId }, 'Failed to record streaming usage');
          }
          if (collectedContent.length > 0 && !streamErrorCode) {
            const { storeRouteCache } = await import('@dmr-x/cache');
            const assembledResponse = {
              id: requestId,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: plan.primary.modelId,
              choices: [{
                index: 0,
                message: { role: 'assistant', content: collectedContent.join('') },
                finish_reason: 'stop',
              }],
              usage: { prompt_tokens: streamPromptTokens, completion_tokens: streamCompletionTokens, total_tokens: streamPromptTokens + streamCompletionTokens },
            };
            const useCache = !body.tools?.length && body.temperature === undefined && body.seed === undefined;
            if (useCache) {
              storeRouteCache('chat', tenantId, body as Record<string, unknown>, assembledResponse);
            }
          }
        } catch (streamError) {
          if (controller.signal.aborted) {
            logger.debug({ requestId, provider: plan.primary.providerId }, 'Stream aborted by client disconnect');
          } else {
            logger.error({ err: streamError, requestId }, 'Streaming error');
            (server as any).recordTelemetryEvent?.({
              level: 'error',
              service: 'gateway',
              message: streamError instanceof Error ? streamError.message : 'Streaming error',
              metadata: {
                path: request.url,
                providerId: plan.primary.providerId,
                modelId: plan.primary.modelId,
                requestId,
              },
            });
            if (!reply.raw.write(`data: ${JSON.stringify({
              error: { message: 'Stream failed', type: 'stream_error' },
            })}\n\n`)) {
              await new Promise<void>(resolve => reply.raw.once('drain', resolve));
            }
          }
        } finally {
          request.raw.off('close', onClientClose);
        }
      } else {
        reply.raw.write(`data: ${JSON.stringify({
          error: { message: 'No adapter available for provider', type: 'routing_error' },
        })}\n\n`);
      }
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return reply;
    }

    const useCache = !body.tools?.length && body.temperature === undefined && body.seed === undefined;

    if (useCache) {
      // First check semantic cache
      if (semanticCacheService.isEnabled()) {
        const semanticCached = await semanticCacheService.lookup('chat', tenantId, body as Record<string, unknown>);
        if (semanticCached) {
          logger.debug({ requestId, model: body.model, similarity: semanticCached.similarity }, 'Semantic cache hit for chat request');
          reply.header('X-Cache', 'HIT');
          reply.header('X-Semantic-Similarity', String(semanticCached.similarity));
          return semanticCached.entry.response;
        }
      }

      // Then check exact-match cache
      const { checkRouteCache } = await import('@dmr-x/cache');
      const cached = checkRouteCache('chat', tenantId, body as Record<string, unknown>);
      if (cached) {
        logger.debug({ requestId, model: body.model }, 'Exact cache hit for chat request');
        reply.header('X-Cache', 'HIT');
        return cached.response;
      }
    }

    const { plan, response } = await router.route(unifiedRequest, {
      path: '/v1/chat/completions',
      qualityTarget,
    });
    if (!plan.primary) {
      (server as any).recordTelemetryEvent?.({
        level: 'warning',
        service: 'gateway',
        message: 'No provider available for non-streaming chat request',
        metadata: { path: request.url, model: body.model, requestId },
      });
      throw new ProviderUnavailableError([]);
    }
    if (unifiedRequest.metadata?.freeTierStrategy) {
      reply.header('X-Free-Tier-Strategy', String(unifiedRequest.metadata.freeTierStrategy));
    }

    if (useCache && response) {
      const { storeRouteCache } = await import('@dmr-x/cache');
      storeRouteCache('chat', tenantId, body as Record<string, unknown>, response);

      // Also store in semantic cache
      if (semanticCacheService.isEnabled()) {
        const tokens = response.usage?.total_tokens ?? 0;
        await semanticCacheService.store('chat', tenantId, body as Record<string, unknown>, response, tokens);
      }

      reply.header('X-Cache', 'MISS');
    }

    (request as any).metrics = {
      providerId: plan.primary.providerId,
      modelId: response.modelId,
      modality: unifiedRequest.modality ?? 'llm',
      tenantId: (request as any).tenant?.id,
      taskProfile: unifiedRequest.modality,
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
      tokens: response.usage
        ? {
            prompt: response.usage.prompt_tokens ?? 0,
            completion: response.usage.completion_tokens ?? 0,
            total: response.usage.total_tokens ?? 0,
          }
        : undefined,
      qualityTarget,
      freeTierStrategy: unifiedRequest.metadata?.freeTierStrategy ?? undefined,
      compression: compressionMetadata ? {
        saved: compressionMetadata.saved,
        algorithm: compressionMetadata.algorithmUsed,
      } : undefined,
    };

    return {
      id: requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.modelId,
      choices: [
        {
          index: 0,
          message: response.message,
          finish_reason: response.finishReason,
        },
      ],
      usage: response.usage,
    };
  });
}