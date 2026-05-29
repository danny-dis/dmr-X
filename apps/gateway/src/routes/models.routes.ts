import type { FastifyInstance } from 'fastify';
import { getDb } from '@dmr-x/db';

export async function modelsRoutes(server: FastifyInstance): Promise<void> {
  server.get('/models', async () => {
    const rows = getDb().prepare(
      `SELECT mp.model_id, mp.display_name, mp.modality, p.name as provider_name,
              mp.context_window, mp.supports_streaming, mp.supports_vision,
              mp.supports_tool_use, mp.created_at
       FROM model_profiles mp
       JOIN providers p ON p.id = mp.provider_id
       WHERE mp.is_active = 1 AND p.is_healthy = 1
       ORDER BY mp.modality, mp.model_id`
    ).all() as any[];

    return {
      object: 'list',
      data: rows.map((row) => ({
        id: row.model_id,
        object: 'model',
        created: Math.floor(new Date(row.created_at).getTime() / 1000),
        owned_by: row.provider_name,
        meta: {
          modality: row.modality,
          display_name: row.display_name,
          context_window: row.context_window,
          supports_streaming: row.supports_streaming,
          supports_vision: row.supports_vision,
          supports_tool_use: row.supports_tool_use,
        },
      })),
    };
  });

  server.get('/models/:modelId', async (request, reply) => {
    const { modelId } = request.params as { modelId: string };
    const row = getDb().prepare(
      `SELECT mp.*, p.name as provider_name
       FROM model_profiles mp
       JOIN providers p ON p.id = mp.provider_id
       WHERE mp.model_id = ? AND mp.is_active = 1`
    ).get(modelId) as any;

    if (!row) {
      reply.status(404);
      return { error: { message: `Model '${modelId}' not found`, type: 'not_found' } };
    }

    return {
      id: row.model_id,
      object: 'model',
      created: Math.floor(new Date(row.created_at).getTime() / 1000),
      owned_by: row.provider_name,
    };
  });
}
