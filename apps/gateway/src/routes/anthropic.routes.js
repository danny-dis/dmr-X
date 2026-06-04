import { z } from 'zod';
import { ValidationError, ProviderUnavailableError } from '@dmr-x/core';
import { generateRequestId, logger } from '@dmr-x/utils';
import { convertAnthropicRequestToUnified, convertUnifiedResponseToAnthropic, } from '../converters/anthropic-converter.js';
import { createAnthropicSSEStream } from '../converters/anthropic-stream-serializer.js';
const AnthropicContentBlockSchema = z.union([
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({
        type: z.literal('image'),
        source: z.object({
            type: z.literal('base64'),
            media_type: z.string(),
            data: z.string(),
        }),
    }),
    z.object({
        type: z.literal('tool_use'),
        id: z.string(),
        name: z.string(),
        input: z.record(z.unknown()),
    }),
    z.object({
        type: z.literal('tool_result'),
        tool_use_id: z.string(),
        content: z.union([z.string(), z.array(z.any())]).optional(),
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
const AnthropicMessagesRequestSchema = z.object({
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
export async function anthropicRoutes(server) {
    server.post('/messages', async (request, reply) => {
        const parsed = AnthropicMessagesRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid Anthropic request', {
                errors: parsed.error.errors,
            });
        }
        const body = parsed.data;
        const requestId = generateRequestId();
        const router = server.router;
        const unifiedRequest = convertAnthropicRequestToUnified(body, {
            requestId,
            tenant: request.tenant,
            apiFormat: 'anthropic',
        });
        if (body.stream) {
            // Streaming: get routing plan only, then stream from adapter
            const { plan } = await router.route(unifiedRequest, {
                path: '/v1/messages',
                qualityTarget: 'balanced',
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
            const adapter = server.getAdapter(plan.primary.providerId);
            if (adapter) {
                try {
                    const routedRequest = { ...unifiedRequest, model: plan.primary.modelId };
                    const stream = adapter.executeStream(routedRequest);
                    for await (const sseLine of createAnthropicSSEStream(stream, {
                        model: plan.primary.modelId,
                        requestId,
                    })) {
                        reply.raw.write(sseLine);
                    }
                }
                catch (streamError) {
                    logger.error({ err: streamError, requestId }, 'Anthropic streaming error');
                    reply.raw.write(`event: error\ndata: ${JSON.stringify({
                        type: 'error',
                        error: { type: 'stream_error', message: 'Stream failed' },
                    })}\n\n`);
                }
            }
            else {
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
            qualityTarget: 'balanced',
        });
        if (!plan.primary) {
            throw new ProviderUnavailableError([]);
        }
        return convertUnifiedResponseToAnthropic(response);
    });
}
//# sourceMappingURL=anthropic.routes.js.map