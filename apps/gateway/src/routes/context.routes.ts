/**
 * Thin REST surface for conversation-context persistence.
 *
 * The underlying capability (dmrx_context_save / dmrx_context_load /
 * dmrx_context_list) is MCP-server-only. This module exposes the same
 * behaviour over the gateway's REST API so the Playground "Handoff" tab can
 * save the current conversation to DMR-X and reload it later, and so a
 * conversation can be exported into a fresh agent run.
 *
 * It reuses the exact same store the MCP server uses
 * (`persistentContextStore` from @dmr-x/db) and the same key scheme
 * (`context:<id>`), so contexts saved via REST are visible to the MCP tools
 * and vice versa.
 */
import type { FastifyInstance } from 'fastify';
import { persistentContextStore } from '@dmr-x/db';

const KEY_PREFIX = 'context:';

function genId(): string {
  return `ctx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function registerContextRoutes(server: FastifyInstance): void {
  // POST /v1/context/save  — persist a conversation context
  server.post('/context/save', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as any;
      const id = typeof body.id === 'string' && body.id ? body.id : genId();
      const ttl = typeof body.ttl_seconds === 'number' ? body.ttl_seconds : (body.ttl ?? 86400);
      const isPermanent = Boolean(body.permanent) || ttl <= 0;
      const messages = Array.isArray(body.messages) ? body.messages : (Array.isArray(body.content) ? body.content : []);
      const user = typeof body.user === 'string' && body.user ? body.user : 'playground';

      const context = {
        id,
        messages,
        user,
        ttl_seconds: ttl,
        permanent: isPermanent,
        created_at: new Date().toISOString(),
      };

      persistentContextStore.set(`${KEY_PREFIX}${id}`, JSON.stringify(context), isPermanent ? 0 : ttl);

      return reply.send({ success: true, context_id: id, message: isPermanent ? 'Context saved permanently' : 'Context saved', permanent: isPermanent });
    } catch (error: any) {
      server.log.error({ err: error }, 'context/save failed');
      return reply.code(500).send({ error: { message: error?.message ?? 'Unknown error' } });
    }
  });

  // POST /v1/context/load  — retrieve a saved context
  server.post('/context/load', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as any;
      const id = body.id;
      if (!id || typeof id !== 'string') {
        return reply.code(400).send({ error: { message: 'Missing context id' } });
      }
      const cached = persistentContextStore.get(`${KEY_PREFIX}${id}`);
      if (!cached) {
        return reply.code(404).send({ error: { message: `Context not found: ${id}` } });
      }
      const context = JSON.parse(cached as string);
      return reply.send({ success: true, context });
    } catch (error: any) {
      server.log.error({ err: error }, 'context/load failed');
      return reply.code(500).send({ error: { message: error?.message ?? 'Unknown error' } });
    }
  });

  // GET /v1/context/list  — list saved contexts (optional ?user= filter, ?limit=)
  server.get('/context/list', async (request, reply) => {
    try {
      const query = request.query as any;
      const limit = typeof query.limit === 'string' ? parseInt(query.limit, 10) || 20 : 20;
      const userFilter = typeof query.user === 'string' ? query.user : undefined;

      const keys = persistentContextStore.keys(`${KEY_PREFIX}`);
      const contexts: Array<{ id: string; user: string; created_at: string; preview: string }> = [];
      for (const key of keys) {
        const cached = persistentContextStore.get(key);
        if (!cached) continue;
        try {
          const ctx = JSON.parse(cached as string);
          if (!userFilter || ctx.user === userFilter) {
            const lastMsg = (ctx.messages || []).slice(-1)[0];
            const preview = typeof lastMsg?.content === 'string' ? lastMsg.content.slice(0, 50) : '';
            contexts.push({ id: ctx.id, user: ctx.user, created_at: ctx.created_at, preview });
          }
        } catch {
          // skip unparseable entries
        }
      }
      contexts.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return reply.send({ success: true, count: contexts.length, contexts: contexts.slice(0, limit) });
    } catch (error: any) {
      server.log.error({ err: error }, 'context/list failed');
      return reply.code(500).send({ error: { message: error?.message ?? 'Unknown error' } });
    }
  });

  // DELETE /v1/context/:id  — remove a saved context
  server.delete('/context/:id', async (request, reply) => {
    try {
      const { id } = request.params as any;
      persistentContextStore.delete(`${KEY_PREFIX}${id}`);
      return reply.send({ success: true, context_id: id });
    } catch (error: any) {
      server.log.error({ err: error }, 'context/delete failed');
      return reply.code(500).send({ error: { message: error?.message ?? 'Unknown error' } });
    }
  });
}
