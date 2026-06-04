import { getDb } from '@dmr-x/db';
export async function modelsRoutes(server) {
    server.get('/models', async () => {
        const rows = getDb().prepare(`SELECT mp.model_id, mp.display_name, mp.modality, p.name as provider_name,
              mp.context_window, mp.max_output_tokens, mp.supports_streaming, mp.supports_vision,
              mp.supports_tool_use, mp.supports_json_mode, mp.supports_function_call, mp.supports_reasoning,
              mp.input_cost_per_1k, mp.output_cost_per_1k, mp.cost_per_image, mp.cost_per_1k_chars,
              mp.created_at
       FROM model_profiles mp
       JOIN providers p ON p.id = mp.provider_id
       WHERE mp.is_active = 1 AND p.is_healthy = 1
       ORDER BY mp.modality, mp.model_id`).all();
        return {
            object: 'list',
            data: rows.map((row) => ({
                id: row.model_id,
                object: 'model',
                created: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : 0,
                owned_by: row.provider_name,
                meta: {
                    modality: row.modality,
                    display_name: row.display_name,
                    context_window: row.context_window,
                    max_output_tokens: row.max_output_tokens,
                    supports_streaming: row.supports_streaming,
                    supports_vision: row.supports_vision,
                    supports_tool_use: row.supports_tool_use,
                    supports_json_mode: row.supports_json_mode,
                    supports_function_call: row.supports_function_call,
                    supports_reasoning: row.supports_reasoning,
                    input_cost_per_1k: row.input_cost_per_1k,
                    output_cost_per_1k: row.output_cost_per_1k,
                    cost_per_image: row.cost_per_image,
                    cost_per_1k_chars: row.cost_per_1k_chars,
                },
            })),
        };
    });
    server.get('/models/:modelId', async (request, reply) => {
        const { modelId } = request.params;
        const row = getDb().prepare(`SELECT mp.*, p.name as provider_name
       FROM model_profiles mp
       JOIN providers p ON p.id = mp.provider_id
       WHERE mp.model_id = ? AND mp.is_active = 1 AND p.is_healthy = 1`).get(modelId);
        if (!row) {
            reply.status(404);
            return { error: { message: `Model '${modelId}' not found`, type: 'not_found', code: 'model_not_found' } };
        }
        return {
            id: row.model_id,
            object: 'model',
            created: Math.floor(new Date(row.created_at).getTime() / 1000),
            owned_by: row.provider_name,
        };
    });
}
//# sourceMappingURL=models.routes.js.map