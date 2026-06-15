import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '@dmr-x/db';
import crypto from 'node:crypto';
import { logger } from '@dmr-x/utils';

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
  imageUrl: z.string().url().optional(),
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

// `core` doesn't export a NotFoundError, so the rest of the gateway uses
// a plain `{ status(404); return { error: { ... } } }` pattern. We mirror
// that here for consistency.
function notFound(message: string) {
  return { error: { message, type: 'not_found', code: 'not_found' } };
}

export default async function conversationRoutes(server: FastifyInstance) {
  // List conversations
  server.get('/conversations', async (request) => {
    const db = getDb();
    const query = request.query as any;
    
    const limit = Math.min(query.limit ?? 50, 100);
    const offset = query.offset ?? 0;
    const mode = query.mode;
    const search = query.search;
    const isTemporary = query.temporary;
    
    let sql = `
      SELECT c.*, 
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
      FROM conversations c
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (mode) {
      sql += ` AND c.mode = ?`;
      params.push(mode);
    }
    
    if (isTemporary !== undefined) {
      sql += ` AND c.is_temporary = ?`;
      params.push(isTemporary === 'true' ? 1 : 0);
    }
    
    if (search) {
      sql += ` AND c.id IN (SELECT rowid FROM conversations_fts WHERE conversations_fts MATCH ?)`;
      params.push(search);
    }
    
    sql += ` ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    const conversations = db.prepare(sql).all(...params);
    
    // Get total count for pagination
    let countSql = `SELECT COUNT(*) as total FROM conversations WHERE 1=1`;
    const countParams: any[] = [];
    
    if (mode) {
      countSql += ` AND mode = ?`;
      countParams.push(mode);
    }
    
    if (isTemporary !== undefined) {
      countSql += ` AND is_temporary = ?`;
      countParams.push(isTemporary === 'true' ? 1 : 0);
    }
    
    if (search) {
      countSql += ` AND id IN (SELECT rowid FROM conversations_fts WHERE conversations_fts MATCH ?)`;
      countParams.push(search);
    }
    
    const { total } = db.prepare(countSql).get(...countParams) as any;
    
    return { conversations, total, limit, offset };
  });
  
  // Get conversation with messages
  server.get('/conversations/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as any;
    
    const conversation = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
      FROM conversations c
      WHERE c.id = ?
    `).get(id) as any;
    
    if (!conversation) {
      reply.status(404);
      return notFound('Conversation not found');
    }
    
    const messages = db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(id) as any[];

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
    
    const id = crypto.randomUUID();
    
    db.prepare(`
      INSERT INTO conversations (id, mode, model, is_temporary)
      VALUES (?, ?, ?, ?)
    `).run(id, body.mode, body.model ?? null, body.isTemporary ? 1 : 0);
    
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    
    return conversation;
  });
  
  // Update conversation
  server.put('/conversations/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as any;
    const body = UpdateConversationSchema.parse(request.body);
    
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    if (!conversation) {
      reply.status(404);
      return notFound('Conversation not found');
    }
    
    if (body.title !== undefined) {
      db.prepare('UPDATE conversations SET title = ?, updated_at = datetime(\'now\') WHERE id = ?').run(body.title, id);
    }
    
    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    return updated;
  });
  
  // Delete conversation
  server.delete('/conversations/:id', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as any;
    
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    if (!conversation) {
      reply.status(404);
      return notFound('Conversation not found');
    }
    
    // Messages will be deleted by CASCADE
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    
    return { success: true };
  });
  
  // Add message to conversation
  server.post('/conversations/:id/messages', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as any;
    const body = AddMessageSchema.parse(request.body);
    
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
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
        id, conversation_id, role, content, audio_url, image_url, embedding_data,
        model, provider, tokens_input, tokens_output, cost, latency_ms, routing_decision, metadata, events
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      id,
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
    db.prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ?').run(id);
    
    // Auto-generate title from first user message
    if (body.role === 'user' && !conversation.title) {
      const title = body.content.slice(0, 100) + (body.content.length > 100 ? '...' : '');
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
    }
    
    return { success: true, id: messageId };
  });
  
  // Batch add messages (for efficiency)
  server.post('/conversations/:id/messages/batch', async (request, reply) => {
    const db = getDb();
    const { id } = request.params as any;
    const { messages } = request.body as any;
    
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
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
        id, conversation_id, role, content, audio_url, image_url, embedding_data,
        model, provider, tokens_input, tokens_output, cost, latency_ms, routing_decision, metadata, events
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    db.prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ?').run(id);

    return { success: true, count: messages.length };
  });
  
  // Delete message
  server.delete('/conversations/:conversationId/messages/:messageId', async (request, reply) => {
    const db = getDb();
    const { conversationId, messageId } = request.params as any;
    
    const message = db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
    if (!message) {
      reply.status(404);
      return notFound('Message not found');
    }
    
    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    
    return { success: true };
  });
}