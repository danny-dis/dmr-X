import { z } from 'zod';
import { ValidationError } from '@dmr-x/core';
import { generateRequestId } from '@dmr-x/utils';
const ImageRequestSchema = z.object({
    model: z.string().optional(),
    prompt: z.string().min(1),
    n: z.number().positive().max(10).optional().default(1),
    size: z.enum(['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792']).optional().default('1024x1024'),
    quality: z.enum(['standard', 'hd']).optional().default('standard'),
    response_format: z.enum(['url', 'b64_json']).optional().default('url'),
    style: z.enum(['vivid', 'natural']).optional(),
    user: z.string().optional(),
});
export async function imagesRoutes(server) {
    server.post('/images/generations', async (request) => {
        const parsed = ImageRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid request', { errors: parsed.error.errors });
        }
        const body = parsed.data;
        const requestId = generateRequestId();
        const [width, height] = body.size.split('x').map(Number);
        const router = server.router;
        const unifiedRequest = {
            modality: 'diffusion',
            model: body.model,
            prompt: body.prompt,
            width,
            height,
            stream: false,
            user: body.user,
            n: body.n,
            metadata: {
                requestId,
                quality: body.quality,
                style: body.style,
                responseFormat: body.response_format,
                tenant: request.tenant,
            },
        };
        const { response } = await router.route(unifiedRequest, {
            path: '/v1/images/generations',
            qualityTarget: 'balanced',
        });
        return {
            created: Math.floor(Date.now() / 1000),
            data: response.images || [],
        };
    });
}
//# sourceMappingURL=images.routes.js.map