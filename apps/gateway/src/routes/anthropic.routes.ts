import { ValidationError, ProviderUnavailableError } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  convertAnthropicRequestToUnified,
  convertUnifiedResponseToAnthropic,
} from '../converters/anthropic-converter.js';
import { createAnthropicSSEStream } from '../converters/anthropic-stream-serializer.js';
import {
  anthropicWireError,
  shouldExposeInternalError,
} from '../lib/wire-errors.js';
import { parseQualityTarget } from '../utils/quality-target.js';
import { compressionService } from '../services/compression.js';
import { parseCompressionHeader, compressionControlEnabled } from '../services/compression-control.js';

// `cache_control` (prompt caching) is accepted and preserved through parsing
// on every block type that supports it below. It is NOT yet threaded through
// convertAnthropicRequestToUnified / UnifiedRequest / the provider adapters --
// forwarding it all the way to the upstream request is a larger change
// (touches packages/core's ContentPart type and every adapter's message
// builder) and is left as follow-up work. Accepting it here at least stops
// Zod from silently stripping it off requests that include it.
const CacheControlSchema = z.object({
  type: z.literal('ephemeral'),
  ttl: z.enum(['5m', '1h']).optional(),
});

export const AnthropicContentBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string(), cache_control: CacheControlSchema.optional() }),
  z.object({
    type: z.literal('image'),
    source: z.object({
      type: z.literal('base64'),
      media_type: z.string(),
      data: z.string(),
    }),
    cache_control: CacheControlSchema.optional(),
  }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.unknown()),
    cache_control: CacheControlSchema.optional(),
  }),
  z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z.union([z.string(), z.array(z.any())]).optional(),
    cache_control: CacheControlSchema.optional(),
  }),
  // Extended-thinking blocks replayed back on a second turn. Clients that
  // enable thinking MUST send these back verbatim alongside the assistant
  // message that produced them, or Anthropic rejects the request -- previously
  // this union matched neither shape and Zod rejected the WHOLE request.
  z.object({
    type: z.literal('thinking'),
    thinking: z.string(),
    signature: z.string(),
  }),
  z.object({
    type: z.literal('redacted_thinking'),
    data: z.string(),
  }),
  // Native document (PDF) input.
  z.object({
    type: z.literal('document'),
    source: z.union([
      z.object({ type: z.literal('base64'), media_type: z.string(), data: z.string() }),
      z.object({ type: z.literal('url'), url: z.string() }),
    ]),
    cache_control: CacheControlSchema.optional(),
  }),
]);

const AnthropicMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(AnthropicContentBlockSchema)]),
});

const AnthropicToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.record(z.unknown()),
});

export const AnthropicMessagesRequestSchema = z.object({
  model: z.string(),
  max_tokens: z.number().positive(),
  system: z.union([z.string(), z.array(z.any())]).optional(),
  messages: z.array(AnthropicMessageSchema).min(1),
  tools: z.array(AnthropicToolSchema).optional(),
  tool_choice: z
    .union([
      z.object({ type: z.literal('auto') }),
      z.object({ type: z.literal('any') }),
      z.object({ type: z.literal('none') }),
      z.object({ type: z.literal('tool'), name: z.string() }),
    ])
    .optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional().default(false),
  metadata: z.object({ user_id: z.string().optional() }).optional(),
});

/** Anthropic-native tool def → OpenAI-format tool def (godmode wrap expects OpenAI shape). */
function anthropicToolsToOpenAi(tools: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>): any[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.input_schema,
    },
  }));
}

/** Anthropic tool_choice → OpenAI tool_choice. */
function anthropicToolChoiceToOpenAi(toolChoice: { type: string; name?: string }): any {
  switch (toolChoice.type) {
    case 'any':
      return 'required';
    case 'none':
      return 'none';
    case 'tool':
      return { type: 'function', function: { name: toolChoice.name ?? '' } };
    case 'auto':
    default:
      return 'auto';
  }
}

/** Best-effort JSON.parse of a tool-arguments string (null when invalid). */
function safeJsonParse(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function anthropicRoutes(server: FastifyInstance): Promise<void> {
  // Encapsulated error handler: this plugin only registers `/messages`, so
  // non-streaming failures are serialized in the Anthropic wire format the
  // official SDKs parse (`{ type: 'error', error: { type, message } }`)
  // instead of the gateway-wide `{ error: { message, type, code } }` shape.
  // Streaming errors stay inline as event-typed SSE (see the route below).
  server.setErrorHandler((error, request, reply) => {
    const err = error as { statusCode?: number; message?: string } & Error;
    logger.error({ err, req: request, requestId: request.id }, `Anthropic API error: ${err.message}`);
    const { statusCode, body } = anthropicWireError(err, {
      exposeMessage: shouldExposeInternalError(),
      requestId: request.id,
    });
    return reply.status(statusCode).send(body);
  });

  server.post('/messages', async (request, reply) => {
    const parsed = AnthropicMessagesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid Anthropic request', {
        errors: parsed.error.errors,
      });
    }

    const body = parsed.data;
    const headerConfig = parseCompressionHeader(request.headers['x-compression']);
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);
    const godmodeRequest = convertAnthropicRequestToUnified(body, {
      requestId,
      tenant: (request as any).tenant,
      apiFormat: 'anthropic',
      costFilter: (request.headers['x-cost-filter'] as 'free' | 'all') || undefined,
    });

    // ── auto-free → pick active model, then G0DM0D3 wrap ───────────────────
    // Loop-breaker: X-DMRX-Godmode-Proxy means this is a relay from godmode
    // back into the gateway — fall through to normal routing (sticky concrete
    // model already chosen on the outbound wrap).
    const isGodmodeProxyRelay = request.headers['x-dmrx-godmode-proxy'] === '1';
    if (body.model === 'auto-free' && !isGodmodeProxyRelay) {
      try {
        const {
          wrapAutoFreeViaGodmode,
          isGodmodeStrict,
          ensureGodmodeProxy,
          buildGodmodeWrapOrder,
        } = await import('../lib/godmode-guard.js');
        const costFilter = (request.headers['x-cost-filter'] as 'free' | 'all') || undefined;
        const candidates = router.getCandidates();

        if (!body.stream) {
          const result = await wrapAutoFreeViaGodmode({
            requestId,
            messages: godmodeRequest.messages ?? [],
            model: body.model,
            candidates,
            costFilter,
            temperature: body.temperature,
            maxTokens: body.max_tokens,
            topP: body.top_p,
            tools: body.tools ? anthropicToolsToOpenAi(body.tools) : undefined,
            tool_choice: body.tool_choice ? anthropicToolChoiceToOpenAi(body.tool_choice) : undefined,
          });

          if (result.status === 'wrapped' && result.completion) {
            const choice = result.completion.choices?.[0];
            const message = choice?.message;
            const content = message?.content ?? '';
            const toolCalls = message?.tool_calls;
            const blocks: any[] = [];
            if (content) blocks.push({ type: 'text', text: content });
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
              for (const tc of toolCalls) {
                blocks.push({
                  type: 'tool_use',
                  id: tc.id ?? `toolu_${requestId}`,
                  name: tc.function?.name ?? 'tool',
                  input: safeJsonParse(tc.function?.arguments) ?? {},
                });
              }
            }
            return {
              id: result.completion.id ?? `msg_${requestId}`,
              type: 'message',
              role: 'assistant',
              content: blocks,
              model: result.wrapModel ?? result.completion.model ?? body.model,
              stop_reason: toolCalls && toolCalls.length > 0
                ? 'tool_use'
                : (choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn'),
              stop_sequence: null,
              usage: {
                input_tokens: result.completion.usage?.prompt_tokens ?? 0,
                output_tokens: result.completion.usage?.completion_tokens ?? 0,
              },
            };
          }

          if (isGodmodeStrict()) {
            throw new ProviderUnavailableError([]);
          }
          // Non-strict: fall through — resolve to top concrete for normal routing
          const wrapOrder = result.wrapOrder ?? buildGodmodeWrapOrder(candidates, costFilter);
          if (wrapOrder[0]) body.model = wrapOrder[0];
        } else {
          const wrapOrder = buildGodmodeWrapOrder(candidates, costFilter);
          const proxyReady = await ensureGodmodeProxy(requestId).catch(() => false);
          let completed = false;
          let anySemanticOutput = false;
          if (proxyReady) {
            const { getGodmodeService } = await import('@dmr-x/godmode');
            const godmode = getGodmodeService();
            if (godmode.isInitialized()) {
              const streamService = godmode as unknown as {
                chatStreamFull(request: Record<string, unknown>, options?: { signal?: AbortSignal; timeoutMs?: number }): AsyncIterable<{
                  content?: string; tool_calls?: any[]; finish_reason?: string | null;
                  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
                }>;
              };
              const chainTimeoutMs = Number(process.env.DMRX_AUTOFREE_STREAM_TIMEOUT_MS) || 120000;
              const firstOutputTimeoutMs = Number(process.env.DMRX_AUTOFREE_TTFT_MS) || 12000;
              const chainDeadline = Date.now() + chainTimeoutMs;

              for (const wrapModel of wrapOrder) {
                if (Date.now() >= chainDeadline || reply.raw.destroyed) break;
                const controller = new AbortController();
                const onDisconnect = () => controller.abort(new Error('Anthropic client disconnected'));
                reply.raw.once('close', onDisconnect);
                const startedAt = Date.now();
                let emittedSemanticOutput = false;
                let finishReason: string | null = null;
                let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
                let index = 0;
                const normalized = async function* () {
                  const source = streamService.chatStreamFull({
                    messages: godmodeRequest.messages ?? [],
                    model: wrapModel,
                    temperature: body.temperature,
                    max_tokens: body.max_tokens,
                    top_p: body.top_p,
                    stop: body.stop_sequences,
                    tools: godmodeRequest.tools,
                    tool_choice: godmodeRequest.tool_choice,
                  }, { signal: controller.signal, timeoutMs: Math.max(1, chainDeadline - Date.now()) });
                  const iterator = source[Symbol.asyncIterator]();
                  try {
                    while (true) {
                      const now = Date.now();
                      const remaining = Math.min(
                        chainDeadline - now,
                        emittedSemanticOutput ? chainDeadline - now : firstOutputTimeoutMs - (now - startedAt),
                      );
                      if (remaining <= 0) throw new Error(emittedSemanticOutput ? 'GODMODE stream chain deadline exceeded' : 'GODMODE stream first-output deadline exceeded');
                      let timer: ReturnType<typeof setTimeout> | undefined;
                      let next: IteratorResult<any>;
                      try {
                        next = await Promise.race([
                          iterator.next(),
                          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(emittedSemanticOutput ? 'GODMODE stream chain deadline exceeded' : 'GODMODE stream first-output deadline exceeded')), remaining); }),
                        ]);
                      } finally { if (timer) clearTimeout(timer); }
                      if (next.done) break;
                      const delta = next.value;
                      if (delta.finish_reason !== undefined && delta.finish_reason !== null) finishReason = delta.finish_reason;
                      if (delta.usage) usage = delta.usage;
                      const tokenData: any = {};
                      if (typeof delta.content === 'string' && delta.content.length > 0) tokenData.content = delta.content;
                      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) tokenData.tool_calls = delta.tool_calls;
                      if (tokenData.content !== undefined || tokenData.tool_calls) {
                        emittedSemanticOutput = true;
                        anySemanticOutput = true;
                        yield { type: 'token', data: tokenData, index: index++ };
                      }
                    }
                  } finally {
                    // Abort before closing: return() cannot unblock a pending read
                    // in an iterator that ignores cancellation. Never await it here.
                    if (!controller.signal.aborted) controller.abort();
                    void Promise.resolve().then(() => iterator.return?.()).catch(() => {});
                  }
                  if (!emittedSemanticOutput) throw new Error('GODMODE stream returned no semantic output');
                  yield { type: 'done', data: {
                    requestId, modelId: wrapModel, finishReason: finishReason ?? 'stop',
                    ...(usage ? { usage: {
                      ...(typeof usage.prompt_tokens === 'number' ? { prompt_tokens: usage.prompt_tokens } : {}),
                      ...(typeof usage.completion_tokens === 'number' ? { completion_tokens: usage.completion_tokens } : {}),
                      ...(typeof usage.total_tokens === 'number' ? { total_tokens: usage.total_tokens } : {}),
                    } } : {}),
                  }, index: index++ };
                };
                try {
                  const events = createAnthropicSSEStream(normalized() as any, { model: wrapModel, requestId })[Symbol.asyncIterator]();
                  let event = await events.next();
                  if (event.done) throw new Error('GODMODE stream ended without an Anthropic message');
                  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
                  reply.raw.write(event.value);
                  while (!(event = await events.next()).done) reply.raw.write(event.value);
                  reply.raw.end();
                  completed = true;
                  return reply;
                } catch (error) {
                  controller.abort(error);
                  if (reply.raw.headersSent) {
                    if (!controller.signal.reason?.message?.includes('disconnected')) {
                      reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'GODMODE stream failed' } })}\n\n`);
                    }
                    reply.raw.end();
                    return reply;
                  }
                  logger.warn({ requestId, wrapModel, err: error }, 'auto-free Anthropic GODMODE attempt failed before output');
                } finally {
                  reply.raw.off('close', onDisconnect);
                }
              }
            }
          }
          if (!completed && isGodmodeStrict()) {
            const failure = new ProviderUnavailableError([]);
            const wire = anthropicWireError(failure, { exposeMessage: shouldExposeInternalError(), requestId });
            return reply.status(wire.statusCode).send(wire.body);
          }
          if (!anySemanticOutput && wrapOrder[0]) body.model = wrapOrder[0];
        }
      } catch (err) {
        if (err instanceof ProviderUnavailableError) throw err;
        const { isGodmodeStrict } = await import('../lib/godmode-guard.js');
        if (isGodmodeStrict()) throw new ProviderUnavailableError([]);
        logger.error({ err, requestId }, 'auto-free godmode reroute failed; falling back to normal routing');
      }
    }

    // Apply compression if enabled
    let compressionMetadata = undefined;
    const tenantId = (request as any).tenant?.id;
    const apiKeyId = (request as any).tenant?.apiKeyId ?? (request as any).apiKeyId;

    if (tenantId || apiKeyId || headerConfig) {
      try {
        const tenantConfig = tenantId ? compressionService.getTenantConfig(tenantId) : undefined;
        const apiKeyConfig = apiKeyId ? compressionService.getApiKeyConfig(apiKeyId) : undefined;

        if (compressionControlEnabled(compressionService.getGlobalConfig(), tenantConfig, apiKeyConfig, headerConfig)) {
          // Convert Anthropic messages to standard format for compression
          const messagesForCompression = body.messages;

          const { compressed, metadata } = await compressionService.compressPrompt(
            messagesForCompression,
            tenantConfig,
            { ...apiKeyConfig, ...headerConfig },
            tenantId ? { tenantId, apiKeyId } : undefined
          );

          // Convert back to Anthropic format
          body.messages = compressed.map((m, i) => ({
            ...body.messages[i],
            content: m.content,
          }));

          compressionMetadata = metadata;
          logger.debug({ requestId, saved: metadata.saved }, 'Applied compression to Anthropic request');
        }
      } catch (err) {
        logger.warn({ err, requestId }, 'Compression failed for Anthropic request, continuing without');
      }
    }

    const unifiedRequest = convertAnthropicRequestToUnified(body, {
      requestId,
      tenant: (request as any).tenant,
      apiFormat: 'anthropic',
      costFilter: (request.headers['x-cost-filter'] as 'free' | 'all') || undefined,
    });

    if (body.stream) {
        // Streaming: get routing plan only, then stream from adapter
        const { plan } = await router.route(unifiedRequest, {
          path: '/v1/messages',
          qualityTarget,
          planOnly: true,
        });

        if (!plan.primary) {
          reply.raw.writeHead(503, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'No available providers' } })}\n\n`);
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
          // chat.routes.ts for the full rationale. The Anthropic adapter
          // forwards this signal to both the fetch and the body reader.
          const controller = new AbortController();
          const onClientClose = () => controller.abort();
          request.raw.on('close', onClientClose);

          try {
            const routedRequest = { ...unifiedRequest, model: plan.primary.modelId };
            const stream = adapter.executeStream(routedRequest, { signal: controller.signal });
            for await (const sseLine of createAnthropicSSEStream(stream, {
              model: plan.primary.modelId,
              requestId,
            })) {
              if (controller.signal.aborted) break;
              // Backpressure: pause writing if the response buffer is full.
              if (!reply.raw.write(sseLine)) {
                await new Promise<void>((resolve) => {
                  const onDrain = () => { reply.raw.off('close', onClose); reply.raw.off('error', onError); resolve(); };
                  const onClose = () => { reply.raw.off('drain', onDrain); reply.raw.off('error', onError); resolve(); };
                  const onError = () => { reply.raw.off('drain', onDrain); reply.raw.off('close', onClose); resolve(); };
                  reply.raw.once('drain', onDrain);
                  reply.raw.once('close', onClose);
                  reply.raw.once('error', onError);
                });
              }
            }
          } catch (streamError) {
            if (controller.signal.aborted) {
              logger.debug({ requestId }, 'Anthropic stream aborted by client disconnect');
            } else {
              logger.error({ err: streamError, requestId }, 'Anthropic streaming error');
              const streamErrorMsg = JSON.stringify({ type: 'error', error: { type: 'stream_error', message: 'Stream failed' } });
              if (!reply.raw.write(`event: error\ndata: ${streamErrorMsg}\n\n`)) {
                await new Promise<void>((resolve) => {
                  const onDrain = () => { reply.raw.off('close', onClose); reply.raw.off('error', onError); resolve(); };
                  const onClose = () => { reply.raw.off('drain', onDrain); reply.raw.off('error', onError); resolve(); };
                  const onError = () => { reply.raw.off('drain', onDrain); reply.raw.off('close', onClose); resolve(); };
                  reply.raw.once('drain', onDrain);
                  reply.raw.once('close', onClose);
                  reply.raw.once('error', onError);
                });
              }
            }
          } finally {
            request.raw.off('close', onClientClose);
          }
        } else {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({
            type: 'error',
            error: { type: 'routing_error', message: 'No adapter available for provider' },
          })}\n\n`);
        }
        reply.raw.end();
        return reply;
      }

      // Non-streaming: route and execute
      const { plan, response } = await router.route(unifiedRequest, {
        path: '/v1/messages',
        qualityTarget,
      });
      if (!plan.primary) {
        throw new ProviderUnavailableError([]);
      }

      return convertUnifiedResponseToAnthropic(response);
  });
}
