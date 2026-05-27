import { z } from 'zod';
import { getPool } from '@dmr-x/db';
import { ValidationError } from '@dmr-x/core';
const CreateProviderSchema = z.object({
    name: z.string().min(1),
    adapter_type: z.string().min(1),
    base_url: z.string().url().optional(),
    api_key_ref: z.string().optional(),
    config: z.record(z.unknown()).optional().default({}),
});
const CreateModelSchema = z.object({
    provider_id: z.string().uuid(),
    model_id: z.string().min(1),
    display_name: z.string().optional(),
    modality: z.enum(['llm', 'diffusion', 'embedding', 'audio_speech', 'audio_transcription', 'video', 'music']),
    intelligence_layer: z.enum(['brain', 'thinker', 'executor', 'worker', 'temp_worker']).optional().default('executor'),
    context_window: z.number().positive().optional(),
    max_output_tokens: z.number().positive().optional(),
    supports_streaming: z.boolean().optional().default(false),
    supports_vision: z.boolean().optional().default(false),
    supports_tool_use: z.boolean().optional().default(false),
    input_cost_per_1k: z.number().min(0).optional().default(0),
    output_cost_per_1k: z.number().min(0).optional().default(0),
    cost_per_image: z.number().min(0).optional().default(0),
});
export async function adminRoutes(server) {
    // List providers
    server.get('/admin/providers', async () => {
        const pool = getPool();
        const result = await pool.query('SELECT * FROM providers ORDER BY name');
        return { providers: result.rows };
    });
    // Create provider
    server.post('/admin/providers', async (request, reply) => {
        const parsed = CreateProviderSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid request', { errors: parsed.error.errors });
        }
        const body = parsed.data;
        const pool = getPool();
        const result = await pool.query(`INSERT INTO providers (name, adapter_type, base_url, api_key_ref, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`, [body.name, body.adapter_type, body.base_url, body.api_key_ref, JSON.stringify(body.config)]);
        reply.status(201);
        return result.rows[0];
    });
    // List models
    server.get('/admin/models', async () => {
        const pool = getPool();
        const result = await pool.query(`SELECT mp.*, p.name as provider_name
       FROM model_profiles mp
       JOIN providers p ON p.id = mp.provider_id
       ORDER BY mp.modality, mp.model_id`);
        return { models: result.rows };
    });
    // Create model
    server.post('/admin/models', async (request, reply) => {
        const parsed = CreateModelSchema.safeParse(request.body);
        if (!parsed.success) {
            throw new ValidationError('Invalid request', { errors: parsed.error.errors });
        }
        const body = parsed.data;
        const pool = getPool();
        const result = await pool.query(`INSERT INTO model_profiles (
        provider_id, model_id, display_name, modality, intelligence_layer,
        context_window, max_output_tokens, supports_streaming, supports_vision,
        supports_tool_use, input_cost_per_1k, output_cost_per_1k, cost_per_image
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`, [
            body.provider_id, body.model_id, body.display_name, body.modality,
            body.intelligence_layer, body.context_window, body.max_output_tokens,
            body.supports_streaming, body.supports_vision, body.supports_tool_use,
            body.input_cost_per_1k, body.output_cost_per_1k, body.cost_per_image,
        ]);
        reply.status(201);
        return result.rows[0];
    });
    // Create tenant
    server.post('/admin/tenants', async (request, reply) => {
        const { name } = request.body;
        if (!name) {
            throw new ValidationError('Name is required');
        }
        const pool = getPool();
        const result = await pool.query('INSERT INTO tenants (name) VALUES ($1) RETURNING *', [name]);
        reply.status(201);
        return result.rows[0];
    });
    // Create API key
    server.post('/admin/api-keys', async (request, reply) => {
        const { tenant_id, name } = request.body;
        if (!tenant_id) {
            throw new ValidationError('tenant_id is required');
        }
        const { generateApiKey, hashApiKey } = await import('@dmr-x/utils');
        const apiKey = generateApiKey();
        const keyHash = hashApiKey(apiKey);
        const pool = getPool();
        const result = await pool.query('INSERT INTO api_keys (tenant_id, key_hash, name) VALUES ($1, $2, $3) RETURNING id, tenant_id, name, created_at', [tenant_id, keyHash, name]);
        reply.status(201);
        return {
            ...result.rows[0],
            key: apiKey, // Only shown once
        };
    });
}
//# sourceMappingURL=admin.routes.js.map