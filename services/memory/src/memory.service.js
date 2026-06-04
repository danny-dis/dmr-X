import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import crypto from 'node:crypto';
import { EmbeddingsService } from './embeddings.js';
import { VectorSearch } from './vector-search.js';
const cache = createNamespacedCache('memory');
export class MemoryService {
    embeddings;
    vectorSearch;
    cleanupInterval = null;
    constructor() {
        this.embeddings = new EmbeddingsService();
        this.vectorSearch = new VectorSearch();
    }
    start() {
        this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60 * 60 * 1000);
        logger.info('Memory service started');
    }
    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        logger.info('Memory service stopped');
    }
    async create(input) {
        const db = getDb();
        const id = crypto.randomUUID();
        const namespace = input.namespace || 'default';
        const source = input.source || 'manual';
        const retentionDays = input.retentionDays || 90;
        const metadata = JSON.stringify(input.metadata || {});
        let embedding = null;
        let embeddingDim = null;
        let embeddingModel = input.embeddingModel || null;
        try {
            const emb = await this.embeddings.embed(input.content);
            embedding = Buffer.from(new Float32Array(emb).buffer);
            embeddingDim = emb.length;
            if (!embeddingModel)
                embeddingModel = this.embeddings.getDefaultModel();
        }
        catch (err) {
            logger.warn({ error: String(err) }, 'Failed to generate embedding for memory item');
        }
        db.prepare(`
      INSERT INTO memory_items (id, tenant_id, content, namespace, confidence, source, embedding_model, embedding, embedding_dim, redaction_status, retention_days, metadata)
      VALUES (?, ?, ?, ?, 1.0, ?, ?, ?, ?, 'clean', ?, ?)
    `).run(id, input.tenantId, input.content, namespace, source, embeddingModel, embedding, embeddingDim, retentionDays, metadata);
        cache.delete(`list:${input.tenantId}`);
        return this.getById(id);
    }
    getById(id) {
        const db = getDb();
        const row = db.prepare(`
      SELECT id, tenant_id, content, namespace, confidence, source,
             embedding_model, embedding_dim, redaction_status, retention_days,
             metadata, created_at, retrieved_at
      FROM memory_items WHERE id = ?
    `).get(id);
        return row ? this.mapRow(row) : null;
    }
    list(tenantId, limit = 200) {
        const cacheKey = `list:${tenantId || 'all'}:${limit}`;
        const cached = cache.get(cacheKey);
        if (cached)
            return JSON.parse(cached);
        const db = getDb();
        const query = tenantId
            ? `SELECT * FROM memory_items WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`
            : `SELECT * FROM memory_items ORDER BY created_at DESC LIMIT ?`;
        const rows = tenantId
            ? db.prepare(query).all(tenantId, limit)
            : db.prepare(query).all(limit);
        const items = rows.map(r => this.mapRow(r));
        cache.set(cacheKey, JSON.stringify(items), 30);
        return items;
    }
    async search(input) {
        const db = getDb();
        let queryEmb;
        try {
            queryEmb = await this.embeddings.embed(input.query);
        }
        catch (err) {
            logger.warn({ error: String(err) }, 'Embedding failed for search, falling back to LIKE');
            return this.fallbackSearch(input);
        }
        const whereClauses = ['embedding IS NOT NULL'];
        const params = [];
        if (input.tenantId) {
            whereClauses.push('tenant_id = ?');
            params.push(input.tenantId);
        }
        if (input.namespace) {
            whereClauses.push('namespace = ?');
            params.push(input.namespace);
        }
        const sql = `
      SELECT id, tenant_id, content, namespace, confidence, source,
             embedding_model, embedding_dim, redaction_status, retention_days,
             metadata, created_at, retrieved_at, embedding
      FROM memory_items
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 500
    `;
        const rows = db.prepare(sql).all(...params);
        const scored = rows.map(row => {
            const emb = new Float32Array(row.embedding.buffer);
            const score = this.vectorSearch.cosineSimilarity(queryEmb, Array.from(emb));
            return { ...this.mapRow(row), score };
        });
        scored.sort((a, b) => b.score - a.score);
        const minScore = input.minScore ?? 0.3;
        return scored.filter(s => s.score >= minScore).slice(0, input.limit || 20);
    }
    fallbackSearch(input) {
        const db = getDb();
        const whereClauses = [`content LIKE '%${input.query.replace(/'/g, "''")}%'`];
        const params = [];
        if (input.tenantId) {
            whereClauses.push('tenant_id = ?');
            params.push(input.tenantId);
        }
        if (input.namespace) {
            whereClauses.push('namespace = ?');
            params.push(input.namespace);
        }
        const sql = `
      SELECT id, tenant_id, content, namespace, confidence, source,
             embedding_model, embedding_dim, redaction_status, retention_days,
             metadata, created_at, retrieved_at
      FROM memory_items
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ?
    `;
        params.push(input.limit || 20);
        const rows = db.prepare(sql).all(...params);
        return rows.map(r => ({ ...this.mapRow(r), score: 0.5 }));
    }
    delete(id) {
        const db = getDb();
        const result = db.prepare('DELETE FROM memory_items WHERE id = ?').run(id);
        return result.changes > 0;
    }
    cleanupExpired() {
        const db = getDb();
        const result = db.prepare(`
      DELETE FROM memory_items
      WHERE retention_days > 0
        AND datetime(created_at, '+' || retention_days || ' days') < datetime('now')
    `).run();
        if (result.changes > 0) {
            logger.info(`Memory cleanup: removed ${result.changes} expired items`);
        }
    }
    mapRow(row) {
        return {
            id: row.id,
            tenantId: row.tenant_id,
            content: row.content,
            namespace: row.namespace,
            confidence: row.confidence,
            source: row.source,
            embeddingModel: row.embedding_model,
            embeddingDim: row.embedding_dim,
            redactionStatus: row.redaction_status,
            retentionDays: row.retention_days,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
            createdAt: row.created_at,
            retrievedAt: row.retrieved_at,
        };
    }
}
export const memoryService = new MemoryService();
//# sourceMappingURL=memory.service.js.map