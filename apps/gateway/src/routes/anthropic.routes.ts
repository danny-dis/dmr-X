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
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);

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
            messages: body.messages.map(m => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            })),
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
          if (proxyReady) {
            const { getGodmodeService } = await import('@dmr-x/godmode');
            const godmode = getGodmodeService();
            if (godmode.isInitialized()) {
              reply.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              });

              for (const wrapModel of wrapOrder) {
                try {
                  let sent = false;
                  const toolIdx = new Map<number, string>();
                  for await (const delta of godmode.chatStreamFull({
                    messages: body.messages.map(m => ({
                      role: m.role,
                      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                    })),
                    model: wrapModel,
                    temperature: body.temperature,
                    max_tokens: body.max_tokens,
                    top_p: body.top_p,
                    tools: body.tools ? anthropicToolsToOpenAi(body.tools) : undefined,
                    tool_choice: body.tool_choice ? anthropicToolChoiceToOpenAi(body.tool_choice) : undefined,
                  })) {
                    if (delta.content) {
                      const event = {
                        type: 'content_block_delta',
                        index: 0,
                        delta: { type: 'text_delta', text: delta.content },
                      };
                      reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`);
                      sent = true;
                    }
                    if (Array.isArray(delta.tool_calls)) {
                      for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!toolIdx.has(idx)) {
                          toolIdx.set(idx, tc.id ?? `toolu_${requestId}`);
                          reply.raw.write(`event: content_block_start\ndata: ${JSON.stringify({
                            type: 'content_block_start',
                            index: idx,
                            content_block: {
                              type: 'tool_use',
                              id: toolIdx.get(idx),
                              name: tc.function?.name ?? 'tool',
                              input: {},
                            },
                          })}\n\n`);
                        }
                        if (tc.function?.arguments) {
                          reply.raw.write(`event: content_block_delta\ndata: ${JSON.stringify({
                            type: 'content_block_delta',
                            index: idx,
                            delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
                          })}\n\n`);
                        }
                        sent = true;
                      }
                    }
                  }
                  if (sent) {
                    for (const idx of toolIdx.keys()) {
                      reply.raw.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: idx })}\n\n`);
                    }
                    reply.raw.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                    reply.raw.end();
                    return reply;
                  }
                } catch (e) {
                  logger.warn({ requestId, wrapModel, err: e }, 'auto-free godmode stream attempt failed; trying next picked model');
                }
              }
              reply.raw.end();
              return reply;
            }
          }

          if (isGodmodeStrict()) {
            reply.raw.writeHead(503, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'auto-free godmode proxy unavailable (strict mode)' } })}\n\n`);
            reply.raw.end();
            return reply;
          }
          if (wrapOrder[0]) body.model = wrapOrder[0];
        }
      } catch (err) {
        if (err instanceof ProviderUnavailableError) throw err;
        logger.error({ err, requestId }, 'auto-free godmode reroute failed; falling back to normal routing');
      }
    }

    // Apply compression if enabled
    let compressionMetadata = undefined;
    const tenantId = (request as any).tenant?.id;
    const apiKeyId = (request as any).apiKeyId;

    if (tenantId || apiKeyId) {
      try {
        const tenantConfig = tenantId ? compressionService.getTenantConfig(tenantId) : undefined;
        const apiKeyConfig = apiKeyId ? compressionService.getApiKeyConfig(apiKeyId) : undefined;

        if (tenantConfig?.enabled || apiKeyConfig?.enabled) {
          // Convert Anthropic messages to standard format for compression
          const messagesForCompression = body.messages.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          }));

          const { compressed, metadata } = await compressionService.compressPrompt(
            messagesForCompression,
            tenantConfig,
            apiKeyConfig
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
                await new Promise<void>(resolve => reply.raw.once('drain', resolve));
              }
            }
          } catch (streamError) {
            if (controller.signal.aborted) {
              logger.debug({ requestId }, 'Anthropic stream aborted by client disconnect');
            } else {
              logger.error({ err: streamError, requestId }, 'Anthropic streaming error');
              if (!reply.raw.write(`event: error\ndata: ${JSON.stringify({
                type: 'error',
                error: { type: 'stream_error', message: 'Stream failed' },
              })}\n\n`)) {
                await new Promise<void>(resolve => reply.raw.once('drain', resolve));
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
