import crypto from 'node:crypto';

import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

import { EmbeddingsService } from '@dmr-x/memory';

/**
 * Semantic Response Cache
 *
 * Inspired by workweave/router's semantic cache that uses cosine similarity
 * on prompt embeddings to find near-duplicate requests and short-circuit
 * before hitting upstream providers.
 *
 * Unlike the exact-match cache (hash-based), this cache:
 * - Uses embeddings to find semantically similar requests
 * - Can match requests with different wording but same intent
 * - Stores responses in SQLite for persistence across restarts
 * - Embedding lookup uses OpenAI/Ollama/hash fallback (same as memory service)
 *
 * Streaming requests bypass this cache entirely (same as workweave/router).
 * Responses with tool calls also bypass cache (tool calls are stateful).
 *
 * Configuration via env vars:
 * - DMRX_SEMANTIC_CACHE_ENABLED=true  (default: false)
 * - DMRX_SEMANTIC_CACHE_THRESHOLD=0.95  (default: 0.95, cosine similarity threshold)
 * - DMRX_SEMANTIC_CACHE_MAX_ENTRIES=10000  (default: 10000)
 * - DMRX_SEMANTIC_CACHE_TTL_SECONDS=600  (default: 600 = 10 minutes)
 */

export interface SemanticCacheEntry {
  id: string;
  tenantId: string | null;
  requestType: string;
  promptText: string;
  embedding: number[];
  response: unknown;
  tokens: number;
  cost: number;
  hitCount: number;
  createdAt: string;
  expiresAt: string;
}

export interface SemanticCacheLookupResult {
  entry: SemanticCacheEntry;
  similarity: number;
}

export class SemanticCacheService {
  private embeddings: EmbeddingsService;
  private enabled: boolean;
  private threshold: number;
  private maxEntries: number;
  private ttlSeconds: number;

  constructor() {
    this.embeddings = new EmbeddingsService();
    this.enabled = process.env.DMRX_SEMANTIC_CACHE_ENABLED === 'true';
    this.threshold = parseFloat(process.env.DMRX_SEMANTIC_CACHE_THRESHOLD || '0.95');
    this.maxEntries = parseInt(process.env.DMRX_SEMANTIC_CACHE_MAX_ENTRIES || '10000', 10);
    this.ttlSeconds = parseInt(process.env.DMRX_SEMANTIC_CACHE_TTL_SECONDS || '600', 10);
  }

  /**
   * Check if semantic caching is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Look up a semantically similar cached response.
   *
   * @param requestType - The request type (chat, embedding, image, etc.)
   * @param tenantId - Optional tenant ID for isolation
   * @param requestBody - The full request body (prompt text will be extracted)
   * @returns The cached entry with similarity score, or null if no match
   */
  async lookup(
    requestType: string,
    tenantId: string | undefined,
    requestBody: Record<string, unknown>,
  ): Promise<SemanticCacheLookupResult | null> {
    if (!this.enabled) return null;

    const promptText = this.extractPromptText(requestBody);
    if (!promptText || promptText.length < 10) return null;

    try {
      const queryEmbedding = await this.embeddings.embed(promptText);
      const candidates = this.getCacheEntries(requestType, tenantId);

      if (candidates.length === 0) return null;

      let bestMatch: SemanticCacheEntry | null = null;
      let bestSimilarity = 0;

      for (const candidate of candidates) {
        const similarity = this.cosineSimilarity(queryEmbedding, candidate.embedding);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = candidate;
        }
      }

      if (bestMatch && bestSimilarity >= this.threshold) {
        // Bump hit count
        this.incrementHitCount(bestMatch.id);

        logger.debug(
          {
            requestId: bestMatch.id,
            similarity: bestSimilarity,
            hitCount: bestMatch.hitCount + 1,
          },
          'Semantic cache hit',
        );

        return { entry: bestMatch, similarity: bestSimilarity };
      }

      return null;
    } catch (err) {
      logger.warn({ error: String(err) }, 'Semantic cache lookup failed, falling back to miss');
      return null;
    }
  }

  /**
   * Store a response in the semantic cache.
   *
   * @param requestType - The request type
   * @param tenantId - Optional tenant ID
   * @param requestBody - The full request body
   * @param response - The response to cache
   * @param tokens - Token count for cost-based TTL
   * @param cost - Cost in cents for cost-based TTL
   */
  async store(
    requestType: string,
    tenantId: string | undefined,
    requestBody: Record<string, unknown>,
    response: unknown,
    tokens: number = 0,
    cost: number = 0,
  ): Promise<void> {
    if (!this.enabled) return;

    // Don't cache streaming responses
    if (requestBody.stream) return;

    // Don't cache responses with tool calls (stateful)
    if (response && typeof response === 'object') {
      const resp = response as Record<string, unknown>;
      if (resp.choices && Array.isArray(resp.choices)) {
        const hasToolCalls = resp.choices.some(
          (c: any) => c.message?.tool_calls && c.message.tool_calls.length > 0,
        );
        if (hasToolCalls) return;
      }
    }

    const promptText = this.extractPromptText(requestBody);
    if (!promptText || promptText.length < 10) return;

    try {
      const embedding = await this.embeddings.embed(promptText);
      const id = crypto.randomUUID();
      const now = new Date();
      const ttl = this.getCostBasedTTL(cost, this.ttlSeconds);
      const expiresAt = new Date(now.getTime() + ttl * 1000);

      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO semantic_cache_entries
          (id, tenant_id, request_type, prompt_text, embedding, response, tokens, cost, hit_count, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        id,
        tenantId || null,
        requestType,
        promptText.slice(0, 2048), // Truncate for storage
        Buffer.from(new Float32Array(embedding).buffer),
        JSON.stringify(response),
        tokens,
        cost,
        now.toISOString(),
        expiresAt.toISOString(),
      );

      // Evict old entries if over limit
      this.evictIfNeeded();

      logger.debug({ id, requestType, ttl }, 'Semantic cache stored');
    } catch (err) {
      logger.warn({ error: String(err) }, 'Semantic cache store failed');
    }
  }

  /**
   * Invalidate all cache entries for a tenant.
   */
  invalidateTenant(tenantId: string): void {
    const db = getDb();
    const result = db.prepare('DELETE FROM semantic_cache_entries WHERE tenant_id = ?').run(tenantId);
    logger.info({ tenantId, deleted: result.changes }, 'Semantic cache invalidated for tenant');
  }

  /**
   * Get cache statistics.
   */
  getStats(): { totalEntries: number; enabled: boolean; threshold: number } {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as count FROM semantic_cache_entries').get() as any;
    return {
      totalEntries: row?.count || 0,
      enabled: this.enabled,
      threshold: this.threshold,
    };
  }

  /**
   * Clean up expired entries.
   */
  cleanup(): void {
    const db = getDb();
    const result = db.prepare(
      "DELETE FROM semantic_cache_entries WHERE expires_at < datetime('now')",
    ).run();
    if (result.changes > 0) {
      logger.info({ deleted: result.changes }, 'Semantic cache cleanup');
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractPromptText(body: Record<string, unknown>): string {
    // OpenAI format: messages array
    if (body.messages && Array.isArray(body.messages)) {
      return (body.messages as any[])
        .filter((m: any) => m.role === 'user')
        .map((m: any) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n');
    }

    // Anthropic format: messages array
    if (body.messages && Array.isArray(body.messages)) {
      return (body.messages as any[])
        .filter((m: any) => m.role === 'user')
        .map((m: any) => {
          if (typeof m.content === 'string') return m.content;
          if (Array.isArray(m.content)) {
            return m.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n');
          }
          return '';
        })
        .join('\n');
    }

    // Simple prompt field
    if (typeof body.prompt === 'string') return body.prompt;

    // Input field (embeddings, rerank)
    if (typeof body.input === 'string') return body.input;
    if (Array.isArray(body.input)) {
      return body.input.filter((i: any) => typeof i === 'string').join('\n');
    }

    return '';
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private getCacheEntries(
    requestType: string,
    tenantId: string | undefined,
  ): SemanticCacheEntry[] {
    const db = getDb();
    const whereClauses = [
      "request_type = ?",
      "expires_at > datetime('now')",
    ];
    const params: unknown[] = [requestType];

    if (tenantId) {
      whereClauses.push('tenant_id = ?');
      params.push(tenantId);
    } else {
      whereClauses.push('tenant_id IS NULL');
    }

    const rows = db.prepare(`
      SELECT id, tenant_id, request_type, prompt_text, embedding, response, tokens, cost, hit_count, created_at, expires_at
      FROM semantic_cache_entries
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 500
    `).all(...params) as any[];

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      requestType: row.request_type,
      promptText: row.prompt_text,
      embedding: Array.from(new Float32Array(row.embedding.buffer)),
      response: JSON.parse(row.response),
      tokens: row.tokens,
      cost: row.cost,
      hitCount: row.hit_count,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }

  private incrementHitCount(id: string): void {
    const db = getDb();
    db.prepare('UPDATE semantic_cache_entries SET hit_count = hit_count + 1 WHERE id = ?').run(id);
  }

  private getCostBasedTTL(costCents: number, baseTTL: number): number {
    if (costCents <= 0) return baseTTL;
    const multiplier = Math.min(1 + costCents * 0.5, 10);
    return Math.round(baseTTL * multiplier);
  }

  private evictIfNeeded(): void {
    const db = getDb();
    const count = (db.prepare('SELECT COUNT(*) as count FROM semantic_cache_entries').get() as any)?.count || 0;

    if (count > this.maxEntries) {
      // Delete oldest 10% of entries
      const toDelete = Math.ceil(this.maxEntries * 0.1);
      db.prepare(`
        DELETE FROM semantic_cache_entries
        WHERE id IN (
          SELECT id FROM semantic_cache_entries
          ORDER BY hit_count ASC, created_at ASC
          LIMIT ?
        )
      `).run(toDelete);

      logger.info({ evicted: toDelete, remaining: count - toDelete }, 'Semantic cache eviction');
    }
  }
}

export const semanticCacheService = new SemanticCacheService();
