import { z } from 'zod';
import { ValidationError, ProviderUnavailableError } from '@dmr-x/core';
import { generateRequestId, logger } from '@dmr-x/utils';
import { convertGeminiRequestToUnified, convertUnifiedResponseToGemini, } from '../converters/gemini-converter.js';
import { createGeminiSSEStream } from '../converters/gemini-stream-serializer.js';
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
export async function geminiRoutes(server) {
    server.post('/gemini/generateContent', async (request, reply) => {
        const parsed = GeminiGenerateContentRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid Gemini request', {
                errors: parsed.error.errors,
            });
        }
        const body = parsed.data;
        const requestId = generateRequestId();
        const router = server.router;
        const unifiedRequest = convertGeminiRequestToUnified(body, {
            requestId,
            tenant: request.tenant,
            apiFormat: 'gemini',
        });
        if (body.stream) {
            // Streaming: get routing plan only, then stream from adapter
            const { plan } = await router.route(unifiedRequest, {
                path: '/v1/gemini/generateContent',
                qualityTarget: 'balanced',
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
            const adapter = server.getAdapter(plan.primary.providerId);
            if (adapter) {
                try {
                    const routedRequest = { ...unifiedRequest, model: plan.primary.modelId };
                    const stream = adapter.executeStream(routedRequest);
                    for await (const sseLine of createGeminiSSEStream(stream, {
                        model: plan.primary.modelId,
                        requestId,
                    })) {
                        reply.raw.write(sseLine);
                    }
                }
                catch (streamError) {
                    logger.error({ err: streamError, requestId }, 'Gemini streaming error');
                    reply.raw.write(`data: ${JSON.stringify({ error: { message: 'Stream failed', code: 500 } })}\n\n`);
                }
            }
            else {
                reply.raw.write(`data: ${JSON.stringify({ error: { message: 'No adapter available for provider', code: 503 } })}\n\n`);
            }
            reply.raw.end();
            return reply;
        }
        // Non-streaming: route and execute
        const { plan, response } = await router.route(unifiedRequest, {
            path: '/v1/gemini/generateContent',
            qualityTarget: 'balanced',
        });
        if (!plan.primary) {
            throw new ProviderUnavailableError([]);
        }
        return convertUnifiedResponseToGemini(response);
    });
}
//# sourceMappingURL=gemini.routes.js.map