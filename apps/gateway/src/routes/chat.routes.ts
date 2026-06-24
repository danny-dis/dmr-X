import { ValidationError, ProviderUnavailableError, type UnifiedRequest } from '@dmr-x/core';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
import type { Router } from '@dmr-x/router';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ChatMessageSchema, ToolSchema } from './shared-schemas.js';
import { parseQualityTarget } from '../utils/quality-target.js';

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

    // Convert to UnifiedRequest
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

    // Streaming: route through pipeline for plan, enforce rate-limit/quota, then stream
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

      // Get routing plan (runs full pipeline: capability, availability, rate-limit, policy, quota filters)
      // Wrapped in try-catch: errors are sent as SSE events so the client always gets a 200 stream
      // rather than a raw HTTP 500 that the UI can't parse.
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

      // Enforce rate limits and quotas before streaming (same checks as executeWithFallback)
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
        // CRIT-5: wire an AbortController to the client request lifecycle.
        // When the SSE consumer disconnects (browser tab close, curl cancel,
        // proxy timeout), `request.raw` fires `close` and we abort the
        // upstream fetch — otherwise the provider keeps generating tokens
        // and billing the customer for bytes that go straight into /dev/null.
        const controller = new AbortController();
        const onClientClose = () => controller.abort();
        request.raw.on('close', onClientClose);

        try {
          const routedRequest = { ...unifiedRequest, model: plan.primary.modelId };
          // CRIT-6: stamp metrics so the onResponse hook writes a request_logs
          // row for streaming requests too. Tokens are unknown at this point
          // (the stream is about to start) and are filled in below as the
          // usage chunk arrives. The onResponse hook reads the final shape.
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
          };
          const stream = adapter.executeStream(routedRequest, { signal: controller.signal });
          // CRIT-6: track when the first token arrives so the request_logs
          // row can carry `time_to_first_token_ms` for streaming requests.
          const streamStart = Date.now();
          let firstTokenAt: number | undefined;
          let streamErrorCode: string | undefined;
          let streamPromptTokens = 0;
          let streamCompletionTokens = 0;
          for await (const chunk of stream) {
            if (controller.signal.aborted) break;
            if (chunk.type === 'token' && firstTokenAt === undefined) {
              firstTokenAt = Date.now();
              (request as any).metrics.firstTokenLatencyMs = firstTokenAt - streamStart;
            }
            // The `done` chunk carries final usage. The union of StreamChunk
            // shapes means we narrow on `chunk.type` before reading `chunk.data`.
            if (chunk.type === 'done' && (chunk.data as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | undefined)?.usage) {
              const usage = (chunk.data as { usage: { prompt_tokens?: number; completion_tokens?: number } }).usage;
              streamPromptTokens = usage.prompt_tokens ?? streamPromptTokens;
              streamCompletionTokens = usage.completion_tokens ?? streamCompletionTokens;
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
            // Backpressure: Node's stream.write returns false when the
            // kernel buffer is full. If we ignore that, a slow consumer
            // accumulates memory in the response buffer until OOM.
            if (!reply.raw.write(data)) {
              await new Promise<void>(resolve => reply.raw.once('drain', resolve));
            }
          }
          // CRIT-6: fill in token totals + error code on the metrics
          // before the request_logs write happens in onResponse.
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
          // Record usage after successful stream completion (fire-and-forget)
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
        } catch (streamError) {
          // AbortError is the expected outcome of a client disconnect — log
          // at debug, not error, so it doesn't pollute the error dashboard.
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

    // Non-streaming: route and execute through full pipeline with fallback
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

    // Telemetry: populate metrics for the onResponse hook
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
