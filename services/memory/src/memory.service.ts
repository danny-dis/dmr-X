import crypto from 'node:crypto';

import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

import { EmbeddingsService } from './embeddings.js';
import { VectorSearch } from './vector-search.js';

const cache = createNamespacedCache('memory');

export interface MemoryItem {
  id: string;
  tenantId: string;
  content: string;
  namespace: string;
  confidence: number;
  source: string;
  embeddingModel: string | null;
  embeddingDim: number | null;
  redactionStatus: string;
  retentionDays: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  retrievedAt: string | null;
}

export interface CreateMemoryInput {
  tenantId: string;
  content: string;
  namespace?: string;
  source?: string;
  embeddingModel?: string;
  retentionDays?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchMemoryInput {
  tenantId?: string;
  query: string;
  namespace?: string;
  limit?: number;
  minScore?: number;
}

export class MemoryService {
  private embeddings: EmbeddingsService;
  private vectorSearch: VectorSearch;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.embeddings = new EmbeddingsService();
    this.vectorSearch = new VectorSearch();
  }

  start(): void {
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60 * 60 * 1000);
    logger.info('Memory service started');
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    logger.info('Memory service stopped');
  }

  async create(input: CreateMemoryInput): Promise<MemoryItem> {
    const db = getDb();
    const id = crypto.randomUUID();
    const namespace = input.namespace || 'default';
    const source = input.source || 'manual';
    const retentionDays = input.retentionDays || 90;
    const metadata = JSON.stringify(input.metadata || {});

    let embedding: Buffer | null = null;
    let embeddingDim: number | null = null;
    let embeddingModel: string | null = input.embeddingModel || null;

    try {
      const emb = await this.embeddings.embed(input.content);
      embedding = Buffer.from(new Float32Array(emb).buffer);
      embeddingDim = emb.length;
      if (!embeddingModel) embeddingModel = this.embeddings.getDefaultModel();
    } catch (err) {
      logger.warn({ error: String(err) }, 'Failed to generate embedding for memory item');
    }

    db.prepare(`
      INSERT INTO memory_items (id, tenant_id, content, namespace, confidence, source, embedding_model, embedding, embedding_dim, redaction_status, retention_days, metadata)
      VALUES (?, ?, ?, ?, 1.0, ?, ?, ?, ?, 'clean', ?, ?)
    `).run(id, input.tenantId, input.content, namespace, source, embeddingModel, embedding, embeddingDim, retentionDays, metadata);

    cache.delete(`list:${input.tenantId}`);

    const item = this.getById(id);
    if (!item) {
      throw new Error('Failed to retrieve created memory item');
    }
    return item;
  }

  getById(id: string): MemoryItem | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT id, tenant_id, content, namespace, confidence, source,
             embedding_model, embedding_dim, redaction_status, retention_days,
             metadata, created_at, retrieved_at
      FROM memory_items WHERE id = ?
    `).get(id) as any;

    return row ? this.mapRow(row) : null;
  }

  list(tenantId?: string, limit = 200): MemoryItem[] {
    const cacheKey = `list:${tenantId || 'all'}:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const db = getDb();
    const query = tenantId
      ? `SELECT * FROM memory_items WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM memory_items ORDER BY created_at DESC LIMIT ?`;
    const rows = tenantId
      ? db.prepare(query).all(tenantId, limit)
      : db.prepare(query).all(limit);

    const items = (rows as any[]).map(r => this.mapRow(r));
    cache.set(cacheKey, JSON.stringify(items), 30);
    return items;
  }

  async search(input: SearchMemoryInput): Promise<(MemoryItem & { score: number })[]> {
    const db = getDb();

    let queryEmb: number[];
    try {
      queryEmb = await this.embeddings.embed(input.query);
    } catch (err) {
      logger.warn({ error: String(err) }, 'Embedding failed for search, falling back to LIKE');
      return this.fallbackSearch(input);
    }

    const whereClauses: string[] = ['embedding IS NOT NULL'];
    const params: unknown[] = [];

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

    const rows = db.prepare(sql).all(...params) as any[];
    const scored = rows.map(row => {
      const emb = new Float32Array(row.embedding.buffer);
      const score = this.vectorSearch.cosineSimilarity(queryEmb, Array.from(emb));
      return { ...this.mapRow(row), score };
    });

    scored.sort((a, b) => b.score - a.score);

    const minScore = input.minScore ?? 0.3;
    return scored.filter(s => s.score >= minScore).slice(0, input.limit || 20);
  }

  private fallbackSearch(input: SearchMemoryInput): (MemoryItem & { score: number })[] {
    const db = getDb();
    const params: unknown[] = [];
    const whereClauses: string[] = ['content LIKE ?'];
    params.push(`%${input.query}%`);

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

    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({ ...this.mapRow(r), score: 0.5 }));
  }

  delete(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM memory_items WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private cleanupExpired(): void {
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

  private mapRow(row: any): MemoryItem {
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
