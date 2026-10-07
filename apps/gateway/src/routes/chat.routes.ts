import { ValidationError, ProviderUnavailableError, type UnifiedRequest } from '@dmr-x/core';
import type { RateLimitService, QuotaService } from '@dmr-x/quota';
import { getMetaModel, assertValidOutput, validateOutputContract, type Router } from '@dmr-x/router';
import { generateRequestId, logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ChatMessageSchema, ToolSchema } from './shared-schemas.js';
import { parseQualityTarget } from '../utils/quality-target.js';
import { parseProviderPreferencesHeader } from '../utils/provider-preferences.js';
import { resolveServedProviderId } from '../utils/served-provider.js';
import { compressionService } from '../services/compression.js';
import { parseCompressionHeader, compressionControlEnabled } from '../services/compression-control.js';
import { semanticCacheService } from '@dmr-x/cache';
import { hashConversation, breakStickySession, accountedLLMStream, isInferenceSettlementError } from '@dmr-x/router';

/**
 * Race a promise against a bounded timer. The timer is ALWAYS cleared on
 * settle (winner or loser), so bounded waits never leak past the request.
 * Timer bounds are failover triggers, never performance fixes: callers move
 * to the next candidate / error path instead of waiting longer.
 */
function withBoundedWait<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Enforce deadlines even when an adapter ignores AbortSignal while next() hangs. */
async function* boundedProviderStream<T extends { type: string; data?: any }>(
  stream: AsyncIterable<T>, ttftMs: number, totalMs: number, fallbackDeadline: number,
): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]();
  const started = Date.now();
  let semanticOutput = false;
  try {
    while (true) {
      const now = Date.now();
      const bounds = [totalMs > 0 ? started + totalMs - now : Infinity];
      if (!semanticOutput) {
        if (ttftMs > 0) bounds.push(started + ttftMs - now);
        if (fallbackDeadline > 0) bounds.push(fallbackDeadline - now);
      }
      const remaining = Math.min(...bounds);
      if (remaining <= 0) throw new Error('Upstream stream output deadline exceeded');
      const pending = iterator.next();
      const next = Number.isFinite(remaining)
        ? await withBoundedWait(pending, remaining, 'Upstream stream output deadline exceeded')
        : await pending;
      if (next.done) {
        if (!semanticOutput) throw new Error('Upstream stream completed with zero content tokens');
        return;
      }
      const chunk = next.value;
      if (!chunk || typeof chunk.type !== 'string') continue;
      if (chunk.type === 'token') {
        if (!chunk.data?.content && !chunk.data?.tool_calls?.length) continue;
        semanticOutput = true;
      }
      yield chunk;
      if (chunk.type === 'done') return;
    }
  } finally {
    // Never await return(): an uncooperative upstream may still be stuck in next().
    void Promise.resolve().then(() => iterator.return?.()).catch(() => {});
  }
}

const ChatRequestSchema = z.object({  model: z.string(),
  costFilter: z.enum(['free', 'all']).optional(),
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
  // Opt out of Router.route's composite decomposition for this request only.
  // Default (absent / true) leaves the existing decompose path untouched.
  decompose: z.boolean().optional(),
});

export async function chatRoutes(server: FastifyInstance): Promise<void> {
  server.post('/chat/completions', async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }

    const body = parsed.data;
    // Cache on original input, not a potentially compressed upstream representation.
    const originalCacheBody = structuredClone(body) as Record<string, unknown>;
    const headerConfig = parseCompressionHeader(request.headers['x-compression']);
    const requestId = generateRequestId();
    const router = (server as any).router as Router;
    const qualityTarget = parseQualityTarget(request.headers['x-quality-target'] as string);
    const providerPreferences = parseProviderPreferencesHeader(request.headers['x-provider-preferences'] as string | undefined);

    // ── auto-free → pick active model, then G0DM0D3 wrap ───────────────────
    // Gateway ranks candidates first; the top concrete model gets the godmode
    // package. Relay calls carry X-DMRX-Godmode-Proxy and fall through here
    // to normal routing with that sticky model (no re-wrap / no recursion).
    const isGodmodeProxyRelay = request.headers['x-dmrx-godmode-proxy'] === '1';
    if (body.model === 'auto-free' && !isGodmodeProxyRelay) {
      try {
        const { getMetaModel } = await import('@dmr-x/router');
        const meta = getMetaModel('auto-free');
        if (meta?.godmode) {
          const {
            wrapAutoFreeViaGodmode,
            isGodmodeStrict,
            ensureGodmodeProxy,
            buildGodmodeWrapOrder,
          } = await import('../lib/godmode-guard.js');
          const costFilter = (request.headers['x-cost-filter'] as 'free' | 'all') || body.costFilter;
          const candidates = router.getCandidates();

          if (body.stream) {
            const wrapOrder = buildGodmodeWrapOrder(candidates, costFilter);
            // Bound the sidecar readiness wait (health probe + serialized
            // restart + initialize share one budget): a slow spawn must not
            // stall past the client's patience before headers are even sent.
            // Conservative default 15s, separately configurable. This bounds
            // the wait; it does not extend any timeout as a performance fix.
            const AUTOFREE_PROXY_READY_MS =
              Number(process.env.DMRX_AUTOFREE_PROXY_READY_MS ?? 15000);
            const proxyReady = await withBoundedWait(
              ensureGodmodeProxy(requestId).catch(() => false),
              AUTOFREE_PROXY_READY_MS,
              `auto-free godmode proxy not ready within ${AUTOFREE_PROXY_READY_MS}ms`,
            ).catch(() => false);
            if (proxyReady) {
              const { getGodmodeService } = await import('@dmr-x/godmode');
              const godmode = getGodmodeService();
              if (!godmode.isInitialized()) {
                await withBoundedWait(
                  godmode.initialize().catch(() => {}),
                  AUTOFREE_PROXY_READY_MS,
                  `auto-free godmode proxy initialize exceeded ${AUTOFREE_PROXY_READY_MS}ms`,
                ).catch(() => {});
              }
              if (godmode.isInitialized()) {
                reply.header('Content-Type', 'text/event-stream');
                reply.header('Cache-Control', 'no-cache');
                reply.header('Connection', 'keep-alive');
                reply.raw.writeHead(200);
                // Watchdog: total caller budget for the whole godmode relay
                // (unchanged default 120s). Per-attempt stalls are bounded
                // below; this only guards the aggregate.
                const AUTOFREE_STREAM_TIMEOUT_MS =
                  Number(process.env.DMRX_AUTOFREE_STREAM_TIMEOUT_MS) || 120_000;
                // Per-model first-SEMANTIC-output deadline (conservative
                // default 12s TTFT, separately configurable). A wrap attempt
                // that yields nothing in this budget is aborted and the next
                // wrapped candidate is tried BEFORE any output. After output
                // starts, attempts never retry (see catch below).
                const AUTOFREE_TTFT_MS =
                  Number(process.env.DMRX_AUTOFREE_TTFT_MS ?? 12000);
                // SSE keepalive comments while waiting pre-first-chunk so
                // idle intermediaries don't reap the connection. 0 disables.
                // Keepalives are transport comments, never semantic output:
                // they never set `sent`, so a stalled attempt still fails
                // over even after pings were emitted.
                const AUTOFREE_KEEPALIVE_MS =
                  Number(process.env.DMRX_AUTOFREE_KEEPALIVE_MS ?? 15000);
                let godmodeClientAborted = false;
                let wrapOutputStarted = false;
                const onGodmodeClientClose = () => { godmodeClientAborted = true; };
                request.raw.on('close', onGodmodeClientClose);
                const drainWrapStream = async (): Promise<void> => {
                  let keepalive: ReturnType<typeof setInterval> | undefined;
                  const stopKeepalive = () => {
                    if (keepalive !== undefined) {
                      clearInterval(keepalive);
                      keepalive = undefined;
                    }
                  };
                  try {
                    if (AUTOFREE_KEEPALIVE_MS > 0) {
                      keepalive = setInterval(() => {
                        if (!reply.raw.writableEnded) reply.raw.write(': ping\n\n');
                      }, AUTOFREE_KEEPALIVE_MS);
                    }
                  for (const wrapModel of wrapOrder) {
                    if (godmodeClientAborted) return;
                    // Declared OUTSIDE the per-attempt try so the catch
                    // below (failover vs terminal-close decision) always
                    // observes them.
                    let sent = false;
                    let sawToolCalls = false;
                  try {
                    // Manual iterator (not for-await) so a hung upstream
                    // next() can be abandoned on the TTFT bound. The done
                    // edge is never dereferenced and nullish frames are
                    // skipped, never thrown — genuine errors still throw and
                    // take the per-attempt catch path below.
                    const iterable = godmode.chatStreamFull({
                      messages: body.messages as any,
                      model: wrapModel,
                      temperature: body.temperature,
                      max_tokens: body.max_tokens,
                      top_p: body.top_p,
                      tools: (body as any).tools,
                      tool_choice: (body as any).tool_choice,
                    });
                    const it = (iterable as AsyncIterable<unknown>)[Symbol.asyncIterator]();
                    // TTFT is measured from attempt start to the first
                    // SEMANTIC chunk — empty keepalive-style deltas from the
                    // upstream do not re-arm it. `AUTOFREE_TTFT_MS <= 0`
                    // disables the per-model bound (total watchdog remains).
                    const attemptStart = Date.now();
                    const abortAttempt = () => {
                      void Promise.resolve()
                        .then(() => it.return?.() as unknown)
                        .then(
                          () => {},
                          () => {},
                        );
                    };
                    while (true) {
                      if (godmodeClientAborted) return;
                      const nextP = it.next();
                      let next: IteratorResult<unknown>;
                      if (!sent && AUTOFREE_TTFT_MS > 0) {
                        const remaining = AUTOFREE_TTFT_MS - (Date.now() - attemptStart);
                        if (remaining <= 0) {
                          // Abort the stalled attempt: best-effort iterator
                          // release (never awaited — the upstream may never
                          // settle) and fall through to the per-attempt
                          // catch, which tries the next candidate.
                          abortAttempt();
                          throw new Error(`auto-free wrap model ${wrapModel}: no output within ${AUTOFREE_TTFT_MS}ms`);
                        }
                        try {
                          next = await withBoundedWait(
                            nextP,
                            remaining,
                            `auto-free wrap model ${wrapModel}: no output within ${AUTOFREE_TTFT_MS}ms`,
                          );
                        } catch (ttftErr) {
                          abortAttempt();
                          throw ttftErr;
                        }
                      } else {
                        next = await nextP;
                      }
                      // Real done edge: finish the attempt WITHOUT
                      // dereferencing the iterator's return value.
                      if (godmodeClientAborted) return;
                      if (next.done) break;
                      const delta = next.value as any;
                      if (!delta || typeof delta !== 'object') continue;
                      const chunkDelta: any = {};
                      if (delta.content) chunkDelta.content = delta.content;
                      if (delta.tool_calls) {
                        chunkDelta.tool_calls = delta.tool_calls;
                        sawToolCalls = true;
                      }
                      if (delta.content || delta.tool_calls) {
                        reply.raw.write(
                          `data: ${JSON.stringify({
                            id: `gm-${requestId}`,
                            object: 'chat.completion.chunk',
                            model: wrapModel,
                            choices: [{ index: 0, delta: { role: 'assistant', ...chunkDelta }, finish_reason: null }],
                          })}\n\n`,
                        );
                        sent = true;
                        wrapOutputStarted = true;
                        stopKeepalive();
                      }
                    }
                    if (sent) {
                      reply.raw.write(
                        `data: ${JSON.stringify({
                          id: `gm-${requestId}`,
                          object: 'chat.completion.chunk',
                          model: wrapModel,
                          choices: [{ index: 0, delta: {}, finish_reason: sawToolCalls ? 'tool_calls' : 'stop' }],
                        })}\n\n`,
                      );
                      reply.raw.write('data: [DONE]\n\n');
                      reply.raw.end();
                      return;
                    }
                    logger.info({ requestId, wrapModel }, 'auto-free godmode stream attempt empty; trying next picked model');
                  } catch (e) {
                    if (sent) {
                      // Output already began on this model: never retry or
                      // mix in another model's chunks — close terminally.
                      logger.warn({ requestId, wrapModel, err: e }, 'auto-free godmode stream failed after output started; closing without retry');
                      if (!reply.raw.writableEnded) {
                        reply.raw.write(`data: ${JSON.stringify({ error: { message: `auto-free stream failed on ${wrapModel}: ${(e as Error).message}` } })}\n\n`);
                        reply.raw.write('data: [DONE]\n\n');
                        reply.raw.end();
                      }
                      return;
                    }
                    logger.warn({ requestId, wrapModel, err: e }, 'auto-free godmode stream attempt failed; trying next picked model');
                  }
                  }
                  // Exhaustion without semantic output is a failure, not a
                  // completed drain. Throw so the outer catch emits an error
                  // and closes the socket instead of returning with it open.
                  throw new Error('all godmode stream attempts failed');
                  } finally {
                    stopKeepalive();
                  }
                };
                let watchdog: ReturnType<typeof setTimeout> | undefined;
                try {
                  await Promise.race([
                    drainWrapStream(),
                    new Promise((_, reject) => {
                      watchdog = setTimeout(() => reject(new Error('auto-free stream watchdog timeout')), AUTOFREE_STREAM_TIMEOUT_MS);
                    }),
                  ]);
                  return;
                } catch (e) {
                  // Fail over only before semantic output, and only when the
                  // operator permits an unwrapped answer. Never mix models.
                  const mayFallback = !wrapOutputStarted && !godmodeClientAborted && !isGodmodeStrict();
                  godmodeClientAborted = true; // stop any late watchdog drain
                  logger.warn({ requestId, err: e, mayFallback }, 'auto-free godmode stream failed');
                  if (!mayFallback) {
                    if (!reply.raw.writableEnded) {
                      reply.raw.write(`data: ${JSON.stringify({ error: { message: `auto-free stream failed: ${(e as Error).message}` } })}\n\n`);
                      reply.raw.write('data: [DONE]\n\n');
                      reply.raw.end();
                    }
                    return;
                  }
                } finally {
                  if (watchdog !== undefined) clearTimeout(watchdog);
                  request.raw.off('close', onGodmodeClientClose);
                }
                // Non-strict, pre-output failure falls through to the same
                // free-only router path used when the proxy is unavailable.
              }
            }
            if (isGodmodeStrict()) {
              reply.header('Content-Type', 'text/event-stream');
              reply.raw.writeHead(503);
              reply.raw.write(`data: ${JSON.stringify({ error: { message: `auto-free godmode proxy unavailable within ${AUTOFREE_PROXY_READY_MS}ms (strict mode): sidecar not reachable, failing without fallback` } })}\n\n`);
              reply.raw.end();
              return;
            }
            // Same rationale as the non-streaming path: keep the meta-model so
            // the router walks its full free-candidate fallback chain.
            logger.info(
              { requestId, wrapOrder },
              'auto-free fallback → router free-candidate chain (no godmode)',
            );
          } else {
            const result = await wrapAutoFreeViaGodmode({
              requestId,
              messages: body.messages as any,
              model: body.model,
              candidates,
              costFilter,
              temperature: body.temperature,
              maxTokens: body.max_tokens,
              topP: body.top_p,
              tools: (body as any).tools,
              tool_choice: (body as any).tool_choice,
            });
            if (result.status === 'wrapped' && result.completion) {
              const gm = result.completion;
              const gmMessage = Array.isArray(gm.choices) ? gm.choices[0]?.message : undefined;
              const gmContent = typeof gmMessage?.content === 'string' ? gmMessage.content : '';
              const gmToolCalls = gmMessage?.tool_calls;
              return reply.send({
                id: `gm-${requestId}`,
                object: 'chat.completion',
                model: result.wrapModel ?? gm.model ?? 'auto-free',
                choices: [{
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: gmContent,
                    ...(gmToolCalls ? { tool_calls: gmToolCalls } : {}),
                  },
                  finish_reason: gmToolCalls ? 'tool_calls' : (gm.choices?.[0]?.finish_reason ?? 'stop'),
                }],
                usage: gm.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                ...(gm.x_g0dm0d3 ? { x_g0dm0d3: gm.x_g0dm0d3 } : {}),
              });
            }
            if (isGodmodeStrict()) {
              return reply.status(503).send({
                error: {
                  message: 'auto-free godmode proxy unavailable (strict mode)',
                  type: 'server_error',
                  code: 'godmode_unavailable',
                },
              });
            }
            // Leave body.model as the `auto-free` meta-model so the router's
            // own ranked fallback chain runs over EVERY free candidate.
            // Pinning wrapOrder[0] collapsed that chain to a single concrete
            // model, so one unroutable top pick (e.g. a provider whose key is
            // exhausted) failed the whole request even though other free
            // models were available.
            logger.info(
              { requestId, wrapOrder: result.wrapOrder },
              'auto-free fallback → router free-candidate chain (no godmode)',
            );
          }
        }
      } catch (err) {
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
          const messagesForCompression = body.messages;

          const { compressed, metadata } = await compressionService.compressPrompt(
            messagesForCompression,
            tenantConfig,
            { ...apiKeyConfig, ...headerConfig },
            tenantId ? { tenantId, apiKeyId } : undefined
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
        // Allow callers to pass routing/behavior flags (e.g. strictProvider /
        // fallback) via the request body's `metadata` field (F-1).
        ...((body as any).metadata && typeof (body as any).metadata === 'object' ? (body as any).metadata : {}),
        requestId,
        tenant: (request as any).tenant,
        // Set ONLY when the caller explicitly sent decompose:false — any other
        // body (absent / true) must leave the flag unset so Router.route's
        // default decompose decision is unchanged.
        ...(body.decompose === false ? { skipDecomposition: true } : {}),
        freeTierStrategy: (request.headers['x-free-tier-strategy'] as string) || undefined,
        costFilter: (request.headers['x-cost-filter'] as 'free' | 'all') || body.costFilter,
        // X-Provider-Preferences (see ../utils/provider-preferences.ts) wins
        // over any body.metadata.providerPreferences above — it's validated
        // input, the body spread above is not.
        ...(providerPreferences ? { providerPreferences } : {}),
      },
    };

    const cacheRouter = router as unknown as {
      getEffectiveFreeTierStrategy?: (override?: string) => string | undefined;
      getEffectiveCostFilter?: (model: string, override?: 'free' | 'all') => string;
    };
    const strategyOverride = typeof unifiedRequest.metadata?.freeTierStrategy === 'string' ? unifiedRequest.metadata.freeTierStrategy : undefined;
    const costOverride = unifiedRequest.metadata?.costFilter as 'free' | 'all' | undefined;
    const cacheRequestBody: Record<string, unknown> = {
      ...originalCacheBody,
      metadata: {
        ...(originalCacheBody.metadata && typeof originalCacheBody.metadata === 'object' ? originalCacheBody.metadata : {}),
        __dmrxRoutingPolicy: {
          version: 1,
          qualityTarget,
          freeTierStrategy: cacheRouter.getEffectiveFreeTierStrategy?.(strategyOverride) ?? strategyOverride,
          costFilter: cacheRouter.getEffectiveCostFilter?.(body.model, costOverride) ?? costOverride,
          providerPreferences: unifiedRequest.metadata?.providerPreferences,
        },
      },
    };
    if (!body.stream) validateOutputContract(unifiedRequest.metadata?.outputContract);

    if (body.stream) {
      if (unifiedRequest.metadata?.freeTierStrategy) {
        reply.header('X-Free-Tier-Strategy', String(unifiedRequest.metadata.freeTierStrategy));
      }

      const streamHeaders: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };
      if (!reply.raw.headersSent) reply.raw.writeHead(200, streamHeaders);

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

      // Build the ordered candidate list: primary first, then the fallback chain.
      // The streaming path previously only tried plan.primary with no fallback, so
      // any bad primary provider (402/404/etc.) killed the request with "Stream
      // failed" even though healthy fallbacks existed. We now iterate candidates and
      // fall back as long as NOTHING has been streamed to the client yet.
      //
      // ROOT-CAUSE FIX (smooth-flow guarantee): the `auto`/balanced meta-model
      // selection can yield an EMPTY plan.chain, leaving a failed primary with no
      // fallback and surfacing a raw provider error to the client. When the chain is
      // empty (or has only the primary), we FORCE healthy candidates from the
      // router's full pool so there is always somewhere to fall back to *before*
      // any token reaches the client. This is what keeps DMR-X's "no raw provider
      // errors reach the client" contract intact for streaming.
      const streamCandidates: Array<{ providerId: string; modelId: string; score: number }> = [
        { providerId: plan.primary.providerId, modelId: plan.primary.modelId, score: plan.primary.score },
        ...plan.chain.map((step) => ({
          providerId: step.provider.providerId,
          modelId: step.provider.modelId,
          score: step.provider.score,
        })),
      ];

      // Augment the planned chain only for unconstrained all-cost meta-models.
      // Global candidates may include paid or excluded providers.
      // Never augment when free_only is active — paid candidates must not enter
      // the streaming fallback chain. The strategy MUST be resolved through the
      // router (request override, else the configured default): reading only
      // request metadata misses a deployment-wide `freeTierStrategy: 'free_only'`
      // default, which sends no per-request override, and would then append paid
      // candidates to the chain after the free primary failed.
      const streamPrefs = unifiedRequest.metadata?.providerPreferences;
      const costFilter = unifiedRequest.metadata?.costFilter as 'free' | 'all' | undefined;
      const routerAny = router as unknown as {
        getEffectiveFreeTierStrategy?: (override?: string) => string | undefined;
        getCandidates?: () => Array<{ providerId: string; modelId: string; score: number; isHealthy?: boolean; providerName?: string }>;
      };
      const freeTierStrategy = routerAny.getEffectiveFreeTierStrategy
        ? routerAny.getEffectiveFreeTierStrategy(typeof unifiedRequest.metadata?.freeTierStrategy === 'string' ? unifiedRequest.metadata.freeTierStrategy : undefined)
        : unifiedRequest.metadata?.freeTierStrategy;
      const isFreeOnly = freeTierStrategy === 'free_only' || costFilter === 'free';
      const unconstrainedMetaModel = !isFreeOnly &&
        getMetaModel(body.model)?.costFilter === 'all' &&
        router.getEffectiveCostFilter(body.model, costFilter) === 'all' &&
        !streamPrefs?.zdr && !streamPrefs?.only?.length && !streamPrefs?.ignore?.length;
      if (unconstrainedMetaModel) try {
        const allCandidates = routerAny.getCandidates?.();
        if (allCandidates && allCandidates.length) {
          const seen = new Set(streamCandidates.map((c) => `${c.providerId}:${c.modelId}`));
          // Prefer healthy candidates; if none healthy, still include others so the
          // request does not die with an empty chain (better a degraded answer than
          // a raw provider error to the client).
          const healthy = allCandidates.filter((c) => c.isHealthy && !seen.has(`${c.providerId}:${c.modelId}`));
          const unhealthy = allCandidates.filter((c) => !c.isHealthy && !seen.has(`${c.providerId}:${c.modelId}`));
          for (const c of [...healthy, ...unhealthy]) {
            seen.add(`${c.providerId}:${c.modelId}`);
            streamCandidates.push({ providerId: c.providerId, modelId: c.modelId, score: c.score });
          }
        }
      } catch (candErr) {
        logger.warn({ err: candErr, requestId }, 'Failed to augment stream candidates from router pool');
      }

      let streamedAnyOutput = false;
      let succeeded = false;
      let clientAborted = false;
      let lastStreamError: unknown;
      let usedProviderId = plan.primary.providerId;

      // Global fallback timeout: bound the entire candidate walk so a string
      // of slow providers can't stall the request past the client's patience.
      // Default 12s. The fallback-executor has the same guard for non-streaming.
      const fallbackTimeoutMs = Number(process.env.DMRX_FALLBACK_TIMEOUT_MS ?? 12000);
      const fallbackDeadline = fallbackTimeoutMs > 0 ? Date.now() + fallbackTimeoutMs : 0;

      for (let attempt = 0; attempt < streamCandidates.length; attempt++) {
        const candidate = streamCandidates[attempt];
        const adapter = (server as any).getAdapter(candidate.providerId);
        if (!adapter) {
          lastStreamError = new Error(`No adapter available for provider ${candidate.providerId}`);
          continue;
        }

        // Global fallback timeout check: if the deadline has passed, fail
        // fast instead of trying another slow provider. This bounds the total
        // streaming candidate walk so the client gets a timely error.
        if (fallbackDeadline > 0 && Date.now() >= fallbackDeadline) {
          lastStreamError = new Error(`Fallback timeout (${fallbackTimeoutMs}ms) reached with ${streamCandidates.length - attempt} candidates remaining`);
          logger.warn({ requestId, fallbackTimeoutMs, attempt, total: streamCandidates.length }, 'Streaming fallback timeout reached');
          break;
        }

        usedProviderId = candidate.providerId;
        const controller = new AbortController();
        const onClientClose = () => controller.abort();
        request.raw.on('close', onClientClose);

        // Upstream stream deadline: bound every candidate's stream so a slow/hung
        // provider cannot stall the gateway indefinitely (which previously surfaced
        // as pi "Connection error" / client timeouts with no gateway log output).
        // On deadline fire we abort the candidate controller; the catch block then
        // falls back to the next candidate (if nothing has been streamed yet) or
        // emits a clean "Stream failed" error.
        const upstreamTimeoutMs = Number(process.env.DMRX_UPSTREAM_STREAM_TIMEOUT_MS ?? 60000);
        let deadlineFired = false;
        const deadline = setTimeout(() => { deadlineFired = true; controller.abort(); }, upstreamTimeoutMs);
        // Declared OUTSIDE the try so the catch block (benign-error + fallback paths) can read them.
        let collectedToolCalls = false;
        let firstTokenAt: number | undefined;
        let streamPromptTokens = 0;
        let streamCompletionTokens = 0;
        const collectedContent: string[] = [];

        try {
          const routedRequest = { ...unifiedRequest, model: candidate.modelId };
          (request as any).metrics = {
            providerId: candidate.providerId,
            modelId: candidate.modelId,
            modality: unifiedRequest.modality ?? 'llm',
            tenantId,
            taskProfile: JSON.stringify({ taskType: unifiedRequest.modality }),
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
          const streamStart = Date.now();
          const ttftMs = Number(process.env.DMRX_STREAM_TTFT_MS ?? 8000);
          // Authoritative inference accounting for the streaming seam
          // (`services/router/src/inference-accounting.ts`):
          //   - `begin` runs BEFORE the factory opens, so a denied reservation
          //     never opens an upstream stream;
          //   - the lease is held across every chunk (including `done`) and
          //     settled exactly once at EOF / early return, with the actual
          //     measured usage;
          //   - a pre-output failure releases instead of settling;
          //   - a rejected `settle` surfaces as InferenceSettlementError from
          //     the iterator (see the catch below) so we never fail over to a
          //     second provider after one already answered.
          // The deadline wrapper stays INSIDE the factory so finalisation runs
          // in the accounted generator's own control flow instead of through
          // a detached `iterator.return()`.
          const accountedStream = accountedLLMStream({
            boundary: qs,
            request: routedRequest,
            providerId: candidate.providerId,
            modelId: candidate.modelId,
            tenantId,
            requestId,
            signal: controller.signal,
            factory: () => boundedProviderStream(
              adapter.executeStream(routedRequest, { signal: controller.signal }),
              ttftMs,
              upstreamTimeoutMs,
              fallbackDeadline,
            ),
          });
          // `any` preserves the loop body's pre-existing loose access to
          // `chunk.data` (each branch casts it itself).
          const stream: AsyncIterable<any> = accountedStream;
          for await (const chunk of stream) {
            if (controller.signal.aborted) break;
            // ROOT-CAUSE FIX (stream_error chunk.type): a degrading provider
            // can yield nullish frames; dereferencing chunk.type then threw
            // (JSC: "undefined is not an object (evaluating 'chunk.type')")
            // and poisoned an otherwise-good stream after correct content.
            // Skip such frames. Genuine thrown errors and in-band
            // `{type:'error'}` chunks still take the catch/fallback path.
            if (!chunk || typeof (chunk as { type?: unknown }).type !== 'string') continue;
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
            // Track tool-call deltas so the empty-content reliability guard
            // (below) does not wrongly abort legitimate tool-use turns, which
            // carry zero *text* content by design.
            if (chunk.type === 'token' && (chunk.data as { tool_calls?: unknown[] } | undefined)?.tool_calls?.length) {
              collectedToolCalls = true;
            }
            let data: string | null = null;
            // Every streamed frame carries the ACTUAL serving candidate
            // (model + provider). After a fallback this is the fallback
            // model — never the failed primary. Additive keys only: `model`
            // is the standard OpenAI chunk field (previously omitted here),
            // `dmrx_provider` follows the `dmrx_fallback` namespacing.
            if (chunk.type === 'token') {
              data = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                model: candidate.modelId,
                dmrx_provider: candidate.providerId,
                choices: [{ index: 0, delta: chunk.data, finish_reason: null }],
              })}\n\n`;
            } else if (chunk.type === 'done') {
              // ROOT-CAUSE FIX (empty-content reliability): a stream that ends
              // with `done` but zero content tokens AND no tool calls is a
              // silent free-tier failure (e.g. gemini-3.5-flash returning an
              // empty body). Treat it as a retryable error so the existing
              // fallback path (next healthy candidate, since no bytes were sent
              // to the client yet) engages instead of delivering an empty
              // "Stream failed". Tool-use turns legitimately have no text
              // content, so they are exempt from this guard.
              if (collectedContent.length === 0 && !collectedToolCalls) {
                throw new Error('Upstream stream completed with zero content tokens');
              }
              data = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                model: candidate.modelId,
                dmrx_provider: candidate.providerId,
                choices: [{ index: 0, delta: {}, finish_reason: collectedToolCalls ? 'tool_calls' : 'stop' }],
                usage: {
                  prompt_tokens: streamPromptTokens,
                  completion_tokens: streamCompletionTokens,
                  total_tokens: streamPromptTokens + streamCompletionTokens,
                },
              })}\n\n`;
            } else if (chunk.type === 'error') {
              // Funnel in-band adapter error chunks through the same catch/fallback
              // path as thrown ProviderErrors so a bad provider can fall back to the
              // next candidate (as long as nothing has been streamed to the client yet).
              const chunkCode = (chunk.data as { code?: string } | undefined)?.code ?? 'stream_error';
              const chunkMsg = (chunk.data as { message?: string } | undefined)?.message ?? 'Adapter stream error';
              const chunkErr = new Error(chunkMsg) as Error & { code?: string; __streamChunkError?: boolean };
              chunkErr.code = chunkCode;
              chunkErr.__streamChunkError = true;
              throw chunkErr;
            } else {
              continue;
            }
            if (!reply.raw.write(data)) {
              await new Promise<void>((resolve) => {
                const onDrain = () => { reply.raw.off('close', onClose); reply.raw.off('error', onError); resolve(); };
                const onClose = () => { reply.raw.off('drain', onDrain); reply.raw.off('error', onError); resolve(); };
                const onError = () => { reply.raw.off('drain', onDrain); reply.raw.off('close', onClose); resolve(); };
                reply.raw.once('drain', onDrain);
                reply.raw.once('close', onClose);
                reply.raw.once('error', onError);
              });
            }
            // Once any token/done bytes reach the client, we can no longer fall back.
            if (chunk.type === 'token' || chunk.type === 'done') {
              streamedAnyOutput = true;
            }
            // Finite DONE: `done` is terminal. A misbehaving iterator that
            // yields multiple done frames must not emit duplicate terminal
            // frames — the first one ends this candidate's stream.
            if (chunk.type === 'done') break;
          }
          if (controller.signal.aborted) {
            if (deadlineFired) {
              // Upstream stream exceeded the deadline: treat as a stream error so the
              // fallback path (next candidate, if nothing streamed yet) engages.
              lastStreamError = new Error(`Upstream stream exceeded ${upstreamTimeoutMs}ms deadline`);
              (request as any).metrics = (request as any).metrics || {};
              (request as any).metrics.errorCode = 'upstream_stream_timeout';
              break;
            }
            clientAborted = true;
            break;
          }
          succeeded = true;
          if (streamPromptTokens || streamCompletionTokens) {
            (request as any).metrics.tokens = {
              prompt: streamPromptTokens,
              completion: streamCompletionTokens,
              total: streamPromptTokens + streamCompletionTokens,
            };
          }
          try {
            if (rls) {
              await rls.recordUsage(candidate.providerId, candidate.modelId, streamPromptTokens + streamCompletionTokens);
            }
            // Accounted streams already settled the canonical usage/cost at EOF:
            // `recordUsage(..., 0)` here would be a second debit for the same
            // tokens. Reliability (rls) bookkeeping is NOT money — always kept.
            if (qs && tenantId && !accountedStream.accounted) {
              await qs.recordUsage(tenantId, candidate.providerId, streamPromptTokens + streamCompletionTokens, 0);
            }
          } catch (usageErr) {
            logger.warn({ err: usageErr, provider: candidate.providerId }, 'Failed to record streaming usage');
          }
          if (collectedContent.length > 0) {
            const { storeRouteCache } = await import('@dmr-x/cache');
            const assembledResponse = {
              id: requestId,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: candidate.modelId,
              choices: [{
                index: 0,
                message: { role: 'assistant', content: collectedContent.join('') },
                finish_reason: 'stop',
              }],
              usage: { prompt_tokens: streamPromptTokens, completion_tokens: streamCompletionTokens, total_tokens: streamPromptTokens + streamCompletionTokens },
            };
            // See the non-streaming useCache below for why providerPreferences
            // disables caching: the cache key is body-only, so storing a
            // preference-constrained response under it could later be served
            // to a request with different (or no) constraints.
            const useCache = !body.tools?.length && body.temperature === undefined && body.seed === undefined && !providerPreferences && body.decompose !== false;
            if (useCache) {
              storeRouteCache('chat', tenantId, cacheRequestBody, assembledResponse);
            }
          }
          break;
        } catch (streamError) {
          // Inference-lease accounting failure: the upstream already ran (and
          // may already have answered), so failing over would spend a SECOND
          // generation on top of one that consumed capacity. The accounting
          // system broke — not the provider — so stop the candidate walk here.
          if (isInferenceSettlementError(streamError)) {
            lastStreamError = streamError;
            logger.error(
              { err: streamError, requestId, provider: candidate.providerId },
              'Inference lease settlement failed; closing stream without provider failover',
            );
            (request as any).metrics = (request as any).metrics || {};
            (request as any).metrics.errorCode = 'inference_settlement_failed';
            if (streamedAnyOutput) {
              // The client already received the terminal frame: report success
              // so no synthetic error frame is appended after `done`.
              succeeded = true;
            } else if (controller.signal.aborted) {
              clientAborted = true;
            }
            break;
          }
          if (controller.signal.aborted) {
            clientAborted = true;
            logger.debug({ requestId, provider: candidate.providerId }, 'Stream aborted by client disconnect');
            break;
          }
          lastStreamError = streamError;
          const moreCandidates = attempt < streamCandidates.length - 1;
          if (!streamedAnyOutput && moreCandidates) {
            // Safe to fall back: nothing was sent to the client yet.
            logger.warn(
              { err: streamError instanceof Error ? streamError.message : streamError, requestId, provider: candidate.providerId, nextAttempt: attempt + 1 },
              'Streaming provider failed before any output; falling back to next candidate'
            );
            continue;
          }
          // If a stream errors after bytes have been sent, the handler writes a
          // clean terminal frame with `finish_reason: 'stop'` and sets
          // `succeeded = true`. The comment scopes this to free-tier providers
          // emitting a trailing error frame, but the branch has **no such
          // discriminator** — it catches a provider dropping at token 5 of 500
          // identically. The client receives a truncated response
          // indistinguishable from a complete one.
          //
          // FIX (R7): only treat a post-output error as benign if the stream
          // already delivered meaningful content (>100 chars) AND the error is
          // a known trailing-error pattern (free-tier providers sometimes emit
          // a trailing error frame after valid content). Otherwise, report it
          // as a real error.
          if (streamedAnyOutput) {
            const chunkErr = streamError as { __streamChunkError?: boolean };
            const isKnownTrailingError = chunkErr.__streamChunkError &&
              collectedContent.length > 100;
            if (isKnownTrailingError) {
              logger.warn(
                { err: streamError instanceof Error ? streamError.message : streamError, requestId, provider: candidate.providerId },
                'Stream error after output already sent; treating as benign and closing stream'
              );
              const finishReason = collectedToolCalls ? 'tool_calls' : 'stop';
              const doneFrame = `data: ${JSON.stringify({
                id: requestId,
                object: 'chat.completion.chunk',
                choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
                usage: {
                  prompt_tokens: streamPromptTokens,
                  completion_tokens: streamCompletionTokens,
                  total_tokens: streamPromptTokens + streamCompletionTokens,
                } })}\n\n`;
              if (!reply.raw.write(doneFrame)) {
                await new Promise<void>((resolve) => {
                  const onDrain = () => { reply.raw.off('close', onClose); reply.raw.off('error', onError); resolve(); };
                  const onClose = () => { reply.raw.off('drain', onDrain); reply.raw.off('error', onError); resolve(); };
                  const onError = () => { reply.raw.off('drain', onDrain); reply.raw.off('close', onClose); resolve(); };
                  reply.raw.once('drain', onDrain);
                  reply.raw.once('close', onClose);
                  reply.raw.once('error', onError);
                });
              }
              succeeded = true;
              break;
            }
          }
          // Cannot fall back (already streamed output, or no candidates left).
          // ROOT-CAUSE FIX (smooth-flow / sticky self-healing): if the provider
          // failed with a definitive 401/403/404 (auth / model-not-found / forbidden),
          // evict it from the sticky session so the SAME dead endpoint is not
          // re-pinned for the rest of this conversation. The non-streaming path does
          // this inside executeWithFallback, but the streaming loop here bypasses it.
          const status = (streamError as { statusCode?: number })?.statusCode;
          if (status === 401 || status === 403 || status === 404) {
            try {
              const hash = hashConversation(body.messages as any);
              if (hash) {
                await breakStickySession(hash, `Streaming provider ${candidate.providerId} returned HTTP ${status}`);
                logger.info({ requestId, provider: candidate.providerId, status }, 'Broke sticky session after definitive streaming failure');
              }
            } catch (stickyErr) {
              logger.warn({ err: stickyErr, requestId }, 'Failed to break sticky session after streaming failure');
            }
          }
          logger.error({ err: streamError, requestId, provider: candidate.providerId }, 'Streaming error');
          (server as any).recordTelemetryEvent?.({
            level: 'error',
            service: 'gateway',
            message: streamError instanceof Error ? streamError.message : 'Streaming error',
            metadata: {
              path: request.url,
              providerId: candidate.providerId,
              modelId: candidate.modelId,
              requestId,
            },
          });
          (request as any).metrics = (request as any).metrics || {};
          (request as any).metrics.errorCode = (streamError as { code?: string })?.code ?? 'stream_error';
          // Surface the actual upstream error to the client instead of a
          // generic "Stream failed" — operators debugging provider issues
          // need the real message (e.g. "rate_limit_exceeded", "context_length_exceeded").
          const streamErrorMsg = streamError instanceof Error ? streamError.message : 'Unknown streaming error';
          if (!reply.raw.write(`data: ${JSON.stringify({
            error: { message: streamErrorMsg, type: 'stream_error' },
          })}\n\n`)) {
            await new Promise<void>((resolve) => {
              const onDrain = () => { reply.raw.off('close', onClose); reply.raw.off('error', onError); resolve(); };
              const onClose = () => { reply.raw.off('drain', onDrain); reply.raw.off('error', onError); resolve(); };
              const onError = () => { reply.raw.off('drain', onDrain); reply.raw.off('close', onClose); resolve(); };
              reply.raw.once('drain', onDrain);
              reply.raw.once('close', onClose);
              reply.raw.once('error', onError);
            });
          }
          break;
        } finally {
          clearTimeout(deadline);
          request.raw.off('close', onClientClose);
          controller.abort(); // release the abandoned candidate after deciding failover
        }
      }

      // No candidate had a usable adapter, and nothing was streamed → emit a routing error.
      if (!succeeded && !streamedAnyOutput && !clientAborted) {
        const msg = lastStreamError instanceof Error ? lastStreamError.message : 'No adapter available for provider';
        logger.error({ requestId, err: lastStreamError, primary: usedProviderId }, 'Streaming request exhausted all candidates');
        reply.raw.write(`data: ${JSON.stringify({
          error: { message: msg, type: 'routing_error' },
        })}\n\n`);
      }
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return reply;
    }

    // Cache keys omit routing headers; constrained requests must neither read
    // unconstrained responses nor overwrite them (exact and semantic caches).
    const useCache = !body.tools?.length && body.temperature === undefined && body.seed === undefined && !providerPreferences && !unifiedRequest.metadata?.costFilter && body.decompose !== false;

    // The cache stores the internal UnifiedResponse, but this endpoint is the
    // OpenAI-compatible surface. Returning the cached value verbatim shipped
    // `{modality, providerId, message}` with no `choices[]`, so any OpenAI
    // client (SDKs, LangChain, external agents) read
    // `choices[0].message.content` as undefined the moment a request hit the
    // cache. Both paths now go through the same envelope.
    // `content` is nullable in the OpenAI schema but it is never absent, and
    // callers rely on that: `choices[0].message.content.trim()` is ordinary
    // client code. A reasoning model that spends its whole max_tokens budget
    // on thinking returns a message with no content key at all — observed on
    // gemini-3.5-flash, which came back as bare `{role:'assistant'}` with
    // finish_reason "length" — so the key is materialised here. Null is the
    // spec's answer for a tool-call-only turn; an empty string is the honest
    // answer for a turn that was truncated before it produced any text.
    const withContentKey = (message: any) => {
      if (!message || typeof message !== 'object') return message;
      if ('content' in message && message.content !== undefined) return message;
      const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
      return { ...message, content: hasToolCalls ? null : '' };
    };

    const toOpenAIChatCompletion = (res: any) => {
      if (res && Array.isArray(res.choices)) return res; // already converted
      return {
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: res?.modelId,
        choices: [
          {
            index: 0,
            message: withContentKey(res?.message),
            finish_reason: res?.finishReason,
          },
        ],
        usage: res?.usage,
        // Additive, namespaced field — OpenAI SDKs ignore unknown keys, so
        // this is safe for existing clients while giving anyone who looks a
        // machine-readable record that the router switched models mid-request.
        ...(res?.fallback ? { dmrx_fallback: res.fallback } : {}),
      };
    };

    const acceptsCachedOutput = (candidate: unknown): boolean => {
      try {
        const cached = candidate as any;
        const output = Array.isArray(cached?.choices)
          ? (cached.choices.length === 1 ? { ...cached, message: cached.choices[0]?.message, finishReason: cached.choices[0]?.finish_reason } : null)
          : cached;
        if (!output) return false;
        assertValidOutput(unifiedRequest, output);
        return true;
      } catch {
        return false;
      }
    };

    if (useCache) {
      // Exact lookup is local and cheap: never spend an embedding budget on an exact hit.
      const { checkRouteCache } = await import('@dmr-x/cache');
      const cached = checkRouteCache('chat', tenantId, cacheRequestBody);
      if (cached && acceptsCachedOutput(cached.response)) {
        logger.debug({ requestId, model: body.model }, 'Exact cache hit for chat request');
        reply.header('X-Cache', 'HIT');
        return toOpenAIChatCompletion(cached.response);
      }

      // Semantic work is optional and only useful after an exact miss.
      if (semanticCacheService.isEnabled()) {
        const semanticCached = await semanticCacheService.lookup('chat', tenantId, cacheRequestBody);
        if (semanticCached && acceptsCachedOutput(semanticCached.entry.response)) {
          logger.debug({ requestId, model: body.model, similarity: semanticCached.similarity }, 'Semantic cache hit for chat request');
          reply.header('X-Cache', 'HIT');
          reply.header('X-Semantic-Similarity', String(semanticCached.similarity));
          return toOpenAIChatCompletion(semanticCached.entry.response);
        }
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
    if (response?.providerId) {
      reply.header('X-DMRX-Provider-Id', response.providerId);
    }

    // Announce a provider/model switch. Clients that only read headers (proxies,
    // dashboards, curl) see it here; the same information is repeated in the
    // response body by toOpenAIChatCompletion for SDK callers.
    if (response?.fallback) {
      reply.header('X-DMRX-Fallback', 'true');
      reply.header('X-DMRX-Fallback-From', response.fallback.fromModelId);
      reply.header('X-DMRX-Fallback-Reason', response.fallback.reason);
      reply.header('X-DMRX-Fallback-Attempts', String(response.fallback.attempts));
      reply.header('X-DMRX-Served-By', response.modelId);
    }

    if (useCache && response && (typeof response.message?.content === 'string'
      ? response.message.content.trim().length > 0
      : response.message?.content != null)) {
      const { storeRouteCache } = await import('@dmr-x/cache');
      storeRouteCache('chat', tenantId, cacheRequestBody, response);

      // Also store in semantic cache
      if (semanticCacheService.isEnabled()) {
        const tokens = response.usage?.total_tokens ?? 0;
        await semanticCacheService.store('chat', tenantId, cacheRequestBody, response, tokens);
      }

      reply.header('X-Cache', 'MISS');
    }

    (request as any).metrics = {
      providerId: resolveServedProviderId(plan, response),
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

    return toOpenAIChatCompletion(response);
  });
}