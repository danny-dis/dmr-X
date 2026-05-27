import { z } from 'zod';
import { ValidationError } from '@dmr-x/core';
import { generateRequestId } from '@dmr-x/utils';
const EmbeddingRequestSchema = z.object({
    model: z.string(),
    input: z.union([z.string(), z.array(z.string())]),
    encoding_format: z.enum(['float', 'base64']).optional().default('float'),
    dimensions: z.number().positive().optional(),
    user: z.string().optional(),
});
export async function embeddingsRoutes(server) {
    server.post('/embeddings', async (request, reply) => {
        const parsed = EmbeddingRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid request', { errors: parsed.error.errors });
        }
        const body = parsed.data;
        const requestId = generateRequestId();
        const router = server.router;
        const unifiedRequest = {
            modality: 'embedding',
            model: body.model,
            input: body.input,
            encoding_format: body.encoding_format,
            dimensions: body.dimensions,
            stream: false,
            user: body.user,
            metadata: {
                requestId,
                tenant: request.tenant,
            },
        };
        try {
            const { response } = await router.route(unifiedRequest, {
                path: '/v1/embeddings',
                qualityTarget: 'balanced',
            });
            const inputArray = Array.isArray(body.input) ? body.input : [body.input];
            return {
                object: 'list',
                data: (response.embeddings || []).map((embedding, i) => ({
                    object: 'embedding',
                    embedding,
                    index: i,
                })),
                model: response.modelId,
                usage: response.usage || { prompt_tokens: 0, total_tokens: 0 },
            };
        }
        catch (error) {
            throw error;
        }
    });
}
//# sourceMappingURL=embeddings.routes.js.map