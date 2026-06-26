import crypto from 'node:crypto';

import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';


const CreateConversationSchema = z.object({
  mode: z.enum(['chat', 'image', 'embed', 'tts', 'rerank', 'moderate']).default('chat'),
  model: z.string().optional(),
  isTemporary: z.boolean().optional().default(false),
});

const UpdateConversationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
});

const AddMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  audioUrl: z.string().url().optional(),
  imageUrl: z.string().refine(
    (val) => val.startsWith('data:') || /^https?:\/\//.test(val),
    { message: 'Invalid url' },
  ).optional(),
  embeddingData: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  tokensInput: z.number().optional().default(0),
  tokensOutput: z.number().optional().default(0),
  cost: z.number().optional().default(0),
  latencyMs: z.number().optional().default(0),
  routingDecision: z.string().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
  events: z.array(z.object({ name: z.string(), data: z.unknown() })).optional(),
});

/**
 * HIGH-4: cap batch size at 100 messages so a single request cannot
 * blow up the DB transaction or memory. The cap mirrors the per-message
 * AddMessageSchema shape; messages are validated individually so a single
 * bad row produces a clear 400 instead of silently being dropped.
 */
const BatchMessageItemSchema = z.object({
  id: z.string().uuid().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  audioUrl: z.string().url().optional(),
  imageUrl: z.string().refine(
    (val) => val.startsWith('data:') || /^https?:\/\//.test(val),
    { message: 'Invalid url' },
  ).optional(),
  embeddingData: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  tokensInput: z.number().optional().default(0),
  tokensOutput: z.number().optional().default(0),
  cost: z.number().optional().default(0),
  latencyMs: z.number().optional().default(0),
  routingDecision: z.string().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
  events: z.array(z.object({ name: z.string(), data: z.unknown() })).optional(),
});

const MAX_BATCH_MESSAGES = 100;

const BatchAddMessagesSchema = z.object({
  messages: z.array(BatchMessageItemSchema).min(1).max(MAX_BATCH_MESSAGES),
});

/**
 * HIGH-4: query validation for GET /conversations.
 *   * `limit`  capped at 100 (was: Math.min(limit ?? 50, 100) — the min
 *     was correct, but the type wasn't enforced).
 *   * `search` capped at 200 chars so a long string can't blow up the
 *     FTS5 MATCH expression or the underlying DB.
 */
const ListConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  mode: z.enum(['chat', 'image', 'embed', 'tts', 'rerank', 'moderate']).optional(),
  search: z.string().min(1).max(200).optional(),
  temporary: z.union([z.literal('true'), z.literal('false')]).optional(),
});

// `core` doesn't export a NotFoundError, so the rest of the gateway uses
// a plain `{ status(404); return { error: { ... } } }` pattern. We mirror
// that here for consistency.
function notFound(message: string) {
  return { error: { message, type: 'not_found', code: 'not_found' } };
}

// CRIT-1: Resolve the active tenant id for a request. The auth middleware
// always sets request.tenant (in local mode it falls back to the first
// tenant row, or 'local' if the table is empty). If somehow no tenant
// is attached we refuse the request rather than silently leaking data
// across tenants.
function tenantIdFor(request: FastifyRequest): string {
  const tenant = (request as any).tenant as { id?: string } | undefined;
  if (!tenant?.id) {
    throw new Error('tenant context missing on request');
  }
  return tenant.id;
}

export default async function conversationRoutes(server: FastifyInstance) {
  // List conversations
  server.get('/conversations', async (request, reply) => {
    const db = getDb();
    const parsed = ListConversationsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400);
      return { error: { message: 'Invalid query', type: 'validation', code: 'invalid_query', details: parsed.error.errors } };
    }
    const query = parsed.data;
    const tenantId = tenantIdFor(request);

    const limit = query.limit;
    const offset = query.offset;
    const mode = query.mode;
    const search = query.search;
    const isTemporary = query.temporary;

    let sql = `
      SELECT c.*,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
      FROM conversations c
      WHERE c.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (mode) {
      sql += ` AND c.mode = ?`;
      params.push(mode);
    }

    if (isTemporary !== undefined) {
      sql += ` AND c.is_temporary = ?`;
      params.push(isTemporary === 'true' ? 1 : 0);
    }

    if (search) {
      // Wrap in double-quotes and escape internal quotes so FTS5 treats
      // the input as a literal phrase instead of interpreting operators
      // like OR, NEAR, *, etc.
      const escapedSearch = `"${search.replace(/"/g, '""')}"`;
      sql += ` AND c.id IN (SELECT rowid FROM conversations_fts WHERE conversations_fts MATCH ?)`;
      params.push(escapedSearch);
    }

    sql += ` ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const conversations = db.prepare(sql).all(...params);

    // Get total count for pagination
    let countSql = `SELECT COUNT(*) as total FROM conversations WHERE tenant_id = ?`;
    const countParams: any[] = [tenantId];

    if (mode) {
      countSql += ` AND mode = ?`;
      countParams.push(mode);
    }

    if (isTemporary !== undefined) {
      countSql += ` AND is_temporary = ?`;
      countParams.push(isTemporary === 'true' ? 1 : 0);
    }

    if (search) {
      const escapedSearch = `"${search.replace(/"/g, '""')}"`;
      countSql += ` AND id IN (SELECT rowid FROM conversations_fts WHERE conversations_fts MATCH ?)`;
      countParams.push(escapedSearch);
    }

    const { total } = db.prepare(countSql).get(...countParams) as any;

    return { conversations, total, limit, offset };
  });

  // Get conversation with messages
  server.get('/conversations/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as any;
    const tenantId = tenantIdFor(request);

    const conversation = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
      FROM conversations c
      WHERE c.id = ? AND c.tenant_id = ?
    `).get(id, tenantId) as any;

    if (!conversation) {
      reply.status(404);
      return notFound('Conversation not found');
    }

    const messages = db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ? AND tenant_id = ?
      ORDER BY created_at ASC
    `).all(id, tenantId) as any[];

    return {
      ...conversation,
      messages: messages.map((m) => ({
        ...m,
        events: m.events ? JSON.parse(m.events) : undefined,
      })),
    };
  });

  // Create new conversation
  server.post('/conversations', async (request) => {
    const db = getDb();
    const body = CreateConversationSchema.parse(request.body);
    const tenantId = tenantIdFor(request);

    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO conversations (id, tenant_id, mode, model, is_temporary)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, tenantId, body.mode, body.model ?? null, body.isTemporary ? 1 : 0);

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(id, tenantId);

    return conversation;
  });

  // Update conversation
  server.put('/conversations/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as any;
    const body = UpdateConversationSchema.parse(request.body);
    const tenantId = tenantIdFor(request);

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!conversation) {
      reply.status(404);
      return notFound('Conversation not found');
    }

    if (body.title !== undefined) {
      db.prepare('UPDATE conversations SET title = ?, updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?').run(body.title, id, tenantId);
    }

    const updated = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    return updated;
  });

  // Delete conversation
  server.delete('/conversations/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as any;
    const tenantId = tenantIdFor(request);

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!conversation) {
      reply.status(404);
      return notFound('Conversation not found');
    }

    // Messages will be deleted by CASCADE
    db.prepare('DELETE FROM conversations WHERE id = ? AND tenant_id = ?').run(id, tenantId);

    return { success: true };
  });

  // Add message to conversation
  server.post('/conversations/:id/messages', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as any;
    const body = AddMessageSchema.parse(request.body);
    const tenantId = tenantIdFor(request);

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!conversation) {
      reply.status(404);
      return notFound('Conversation not found');
    }

    // Skip persistence if temporary
    if (conversation.is_temporary) {
      return { success: true, temporary: true };
    }

    const messageId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO messages (
        id, conversation_id, tenant_id, role, content, audio_url, image_url, embedding_data,
        model, provider, tokens_input, tokens_output, cost, latency_ms, routing_decision, metadata, events
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      id,
      tenantId,
      body.role,
      body.content,
      body.audioUrl ?? null,
      body.imageUrl ?? null,
      body.embeddingData ?? null,
      body.model ?? null,
      body.provider ?? null,
      body.tokensInput,
      body.tokensOutput,
      body.cost,
      body.latencyMs,
      body.routingDecision ?? null,
      JSON.stringify(body.metadata),
      JSON.stringify(body.events ?? null)
    );

    // Update conversation timestamp
    db.prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?').run(id, tenantId);

    // Auto-generate title from first user message
    if (body.role === 'user' && !conversation.title) {
      const title = body.content.slice(0, 100) + (body.content.length > 100 ? '...' : '');
      db.prepare('UPDATE conversations SET title = ? WHERE id = ? AND tenant_id = ?').run(title, id, tenantId);
    }

    return { success: true, id: messageId };
  });

  // Batch add messages (for efficiency)
  server.post('/conversations/:id/messages/batch', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as any;
    const tenantId = tenantIdFor(request);
    const parsed = BatchAddMessagesSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: { message: 'Invalid request', type: 'validation', code: 'invalid_batch', details: parsed.error.errors } };
    }
    const { messages } = parsed.data;

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!conversation) {
      reply.status(404);
      return notFound('Conversation not found');
    }

    // Skip persistence if temporary
    if (conversation.is_temporary) {
      return { success: true, temporary: true, count: messages.length };
    }

    const insert = db.prepare(`
      INSERT INTO messages (
        id, conversation_id, tenant_id, role, content, audio_url, image_url, embedding_data,
        model, provider, tokens_input, tokens_output, cost, latency_ms, routing_decision, metadata, events
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Wrap the per-row inserts in a single transaction so a mid-batch
    // failure rolls back the whole batch instead of leaving a half-written
    // message log. The DB client exposes `db.transaction(() => void)` —
    // it runs the callback inside BEGIN/COMMIT and rolls back on throw.
    db.transaction(() => {
      for (const msg of messages) {
        insert.run(
          msg.id || crypto.randomUUID(),
          id,
          tenantId,
          msg.role,
          msg.content,
          msg.audioUrl ?? null,
          msg.imageUrl ?? null,
          msg.embeddingData ?? null,
          msg.model ?? null,
          msg.provider ?? null,
          msg.tokensInput ?? 0,
          msg.tokensOutput ?? 0,
          msg.cost ?? 0,
          msg.latencyMs ?? 0,
          msg.routingDecision ?? null,
          JSON.stringify(msg.metadata ?? {}),
          JSON.stringify(msg.events ?? null)
        );
      }
    });

    // Update conversation timestamp
    db.prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?').run(id, tenantId);

    return { success: true, count: messages.length };
  });

  // Delete message
  server.delete('/conversations/:conversationId/messages/:messageId', async (request, reply) => {
    const db = getDb();
    const { conversationId, messageId } = request.params as any;
    const tenantId = tenantIdFor(request);

    const message = db.prepare(
      'SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND tenant_id = ?'
    ).get(messageId, conversationId, tenantId);
    if (!message) {
      reply.status(404);
      return notFound('Message not found');
    }

    db.prepare('DELETE FROM messages WHERE id = ? AND tenant_id = ?').run(messageId, tenantId);

    return { success: true };
  });
}
