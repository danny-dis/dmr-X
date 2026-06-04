import { z } from 'zod';
import { ValidationError, ProviderUnavailableError } from '@dmr-x/core';
import { generateRequestId, logger } from '@dmr-x/utils';
import { ChatMessageSchema, ToolSchema } from './shared-schemas.js';
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
export async function chatRoutes(server) {
    server.post('/chat/completions', async (request, reply) => {
        const parsed = ChatRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid request', { errors: parsed.error.errors });
        }
        const body = parsed.data;
        const requestId = generateRequestId();
        const router = server.router;
        // Convert to UnifiedRequest
        const unifiedRequest = {
            modality: 'llm',
            model: body.model,
            messages: body.messages,
            tools: body.tools,
            tool_choice: body.tool_choice,
            temperature: body.temperature,
            max_tokens: body.max_tokens,
            top_p: body.top_p,
            frequency_penalty: body.frequency_penalty,
            presence_penalty: body.presence_penalty,
            stop: body.stop,
            response_format: body.response_format,
            seed: body.seed,
            n: body.n,
            stream: body.stream,
            user: body.user,
            metadata: {
                requestId,
                tenant: request.tenant,
                freeTierStrategy: request.headers['x-free-tier-strategy'] || undefined,
            },
        };
        // Streaming: route through pipeline for plan, enforce rate-limit/quota, then stream
        if (body.stream) {
            // Get routing plan (runs full pipeline: capability, availability, rate-limit, policy, quota filters)
            const { plan } = await router.route(unifiedRequest, {
                path: '/v1/chat/completions',
                qualityTarget: 'balanced',
                planOnly: true,
            });
            if (!plan.primary) {
                throw new ProviderUnavailableError([]);
            }
            // Enforce rate limits and quotas before streaming (same checks as executeWithFallback)
            const rls = server.rateLimitService;
            const qs = server.quotaService;
            const tenantId = request.tenant?.id;
            if (rls) {
                const limitCheck = rls.checkLimit(plan.primary.providerId, plan.primary.modelId, 0);
                if (!limitCheck.allowed) {
                    throw new ProviderUnavailableError([plan.primary.providerId], limitCheck.retryAfterMs ? Math.ceil(limitCheck.retryAfterMs / 1000) : 30);
                }
            }
            if (qs && tenantId) {
                await qs.checkQuota(tenantId, plan.primary.providerId, 0, 0);
            }
            if (unifiedRequest.metadata?.freeTierStrategy) {
                reply.header('X-Free-Tier-Strategy', String(unifiedRequest.metadata.freeTierStrategy));
            }
            const streamHeaders = {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            };
            reply.raw.writeHead(200, streamHeaders);
            const adapter = server.getAdapter(plan.primary.providerId);
            if (adapter) {
                try {
                    const routedRequest = { ...unifiedRequest, model: plan.primary.modelId };
                    const stream = adapter.executeStream(routedRequest);
                    for await (const chunk of stream) {
                        if (chunk.type === 'token') {
                            reply.raw.write(`data: ${JSON.stringify({
                                id: requestId,
                                object: 'chat.completion.chunk',
                                choices: [{ index: 0, delta: chunk.data, finish_reason: null }],
                            })}\n\n`);
                        }
                        else if (chunk.type === 'done') {
                            reply.raw.write(`data: ${JSON.stringify({
                                id: requestId,
                                object: 'chat.completion.chunk',
                                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                            })}\n\n`);
                        }
                        else if (chunk.type === 'error') {
                            logger.error({ requestId, chunkError: chunk.data }, 'Adapter stream error chunk');
                            reply.raw.write(`data: ${JSON.stringify({
                                error: { message: 'Stream error', type: 'stream_error' },
                            })}\n\n`);
                        }
                    }
                    // Record usage after successful stream completion (fire-and-forget)
                    try {
                        if (rls) {
                            await rls.recordUsage(plan.primary.providerId, plan.primary.modelId, 0);
                        }
                        if (qs && tenantId) {
                            await qs.recordUsage(tenantId, plan.primary.providerId, 0, 0);
                        }
                    }
                    catch (usageErr) {
                        logger.warn({ err: usageErr, provider: plan.primary.providerId }, 'Failed to record streaming usage');
                    }
                }
                catch (streamError) {
                    logger.error({ err: streamError, requestId }, 'Streaming error');
                    reply.raw.write(`data: ${JSON.stringify({
                        error: { message: 'Stream failed', type: 'stream_error' },
                    })}\n\n`);
                }
            }
            else {
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
            qualityTarget: 'balanced',
        });
        if (!plan.primary) {
            throw new ProviderUnavailableError([]);
        }
        if (unifiedRequest.metadata?.freeTierStrategy) {
            reply.header('X-Free-Tier-Strategy', String(unifiedRequest.metadata.freeTierStrategy));
        }
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
//# sourceMappingURL=chat.routes.js.map