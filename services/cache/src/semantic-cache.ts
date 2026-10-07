import crypto from 'node:crypto';
import { semanticCacheIdentity } from './semantic-cache-identity.js';
import { isCacheableChatResponse } from './response-cache-policy.js';

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

/** How often to run cleanup and eviction (ms) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const EVICTION_INTERVAL_MS = 60 * 1000; // 60 seconds

export interface SemanticCacheEntry {
  id: string;
  tenantId: string | null;
  requestType: string;
  promptText: string;
  embedding: Float32Array;
  response: unknown;
  tokens: number;
  hitCount: number;
  createdAt: string;
  expiresAt: string;
}

/** Lightweight candidate for phase 1 lookup (no response payload) */
interface SemanticCacheCandidate {
  id: string;
  tenantId: string | null;
  requestType: string;
  promptText: string;
  embedding: Float32Array;
  tokens: number;
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
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private usingRealEmbeddings: boolean;
  private embeddingTimeoutMs: number;

  constructor() {
    this.embeddings = new EmbeddingsService();
    this.enabled = process.env.DMRX_SEMANTIC_CACHE_ENABLED === 'true';
    this.threshold = parseFloat(process.env.DMRX_SEMANTIC_CACHE_THRESHOLD || '0.95');
    this.maxEntries = parseInt(process.env.DMRX_SEMANTIC_CACHE_MAX_ENTRIES || '10000', 10);
    this.ttlSeconds = parseInt(process.env.DMRX_SEMANTIC_CACHE_TTL_SECONDS || '600', 10);
    this.embeddingTimeoutMs = this.cacheEmbeddingTimeout();

    // Env presence only permits trying a real provider; runtime failures fail open.
    this.usingRealEmbeddings = !!(process.env.OPENAI_API_KEY || process.env.OLLAMA_BASE_URL);
    if (this.enabled && !this.usingRealEmbeddings) {
      logger.warn(
        'Semantic cache enabled but no embedding provider available (OPENAI_API_KEY or OLLAMA_BASE_URL). ' +
        'Cache will be disabled until a provider is configured.'
      );
      this.enabled = false;
    }

    if (this.enabled) {
      this.startCleanupTimer();
      this.startEvictionTimer();
    }
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
   * Uses two-phase query: first fetch lightweight candidates (no response),
   * then fetch the full response only for the best match.
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

    const identity = semanticCacheIdentity(requestType, requestBody);
    if (!identity) return null;
    const { prompt: promptText, scope } = identity;

    try {
      const realEmbedding = await this.getRealEmbedding(promptText);
      const queryVec = new Float32Array(realEmbedding.embedding);
      if (!this.normalizeInPlace(queryVec)) return null;
      const namespaceScope = `${realEmbedding.namespace}:${scope}`;

      // Phase 1: fetch lightweight candidates (no response payload)
      const candidates = this.getCandidates(namespaceScope, tenantId);
      if (candidates.length === 0) return null;

      let bestCandidate: SemanticCacheCandidate | null = null;
      let bestSimilarity = 0;

      for (const candidate of candidates) {
        const similarity = this.dotProduct(queryVec, candidate.embedding);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestCandidate = candidate;
        }
      }

      if (bestCandidate && bestSimilarity >= this.threshold) {
        // Phase 2: fetch full response for the winning entry only
        const fullEntry = this.getEntryById(bestCandidate.id);
        if (!fullEntry || !isCacheableChatResponse(fullEntry.response)) return null;

        // Bump hit count (with error handling)
        this.incrementHitCount(bestCandidate.id);

        logger.debug(
          {
            requestId: bestCandidate.id,
            similarity: bestSimilarity,
            hitCount: bestCandidate.hitCount + 1,
          },
          'Semantic cache hit',
        );

        return { entry: fullEntry, similarity: bestSimilarity };
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
   * @param tokens - Token count
   */
  async store(
    requestType: string,
    tenantId: string | undefined,
    requestBody: Record<string, unknown>,
    response: unknown,
    tokens: number = 0,
  ): Promise<void> {
    if (!this.enabled) return;

    // Don't cache streaming responses
    if (requestBody.stream) return;

    // Don't cache responses with tool calls (stateful) — multi-provider detection
    if (this.hasToolCalls(response) || !isCacheableChatResponse(response)) return;

    const identity = semanticCacheIdentity(requestType, requestBody);
    if (!identity) return;
    const { prompt: promptText, scope } = identity;

    try {
      const realEmbedding = await this.getRealEmbedding(promptText);
      const normalized = new Float32Array(realEmbedding.embedding);
      if (!this.normalizeInPlace(normalized)) return;
      const namespaceScope = `${realEmbedding.namespace}:${scope}`;

      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);

      const db = getDb();

      // Deduplication: check if entry with same (tenant, type, prompt) exists
      const existing = db.prepare(`
        SELECT id FROM semantic_cache_entries
        WHERE request_type = ? AND prompt_text = ? AND
              (tenant_id = ? OR (tenant_id IS NULL AND ? IS NULL))
      `).get(
        namespaceScope,
        promptText,
        tenantId || null,
        tenantId || null,
      ) as any;

      if (existing) {
        // Update existing entry instead of creating duplicate
        db.prepare(`
          UPDATE semantic_cache_entries
          SET embedding = ?, response = ?, tokens = ?, hit_count = 0,
              created_at = ?, expires_at = ?
          WHERE id = ?
        `).run(
          Buffer.from(normalized.buffer),
          JSON.stringify(response),
          tokens,
          now.toISOString(),
          expiresAt.toISOString(),
          existing.id,
        );
        logger.debug({ id: existing.id, requestType }, 'Semantic cache entry updated (dedup)');
      } else {
        // Insert new entry
        const id = crypto.randomUUID();
        db.prepare(`
          INSERT INTO semantic_cache_entries
            (id, tenant_id, request_type, prompt_text, embedding, response, tokens, hit_count, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(
          id,
          tenantId || null,
          namespaceScope,
          promptText,
          Buffer.from(normalized.buffer),
          JSON.stringify(response),
          tokens,
          now.toISOString(),
          expiresAt.toISOString(),
        );
        logger.debug({ id, requestType }, 'Semantic cache stored');
      }
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
    try {
      const db = getDb();
      const result = db.prepare(
        "DELETE FROM semantic_cache_entries WHERE julianday(expires_at) <= julianday('now')",
      ).run();
      if (result.changes > 0) {
        logger.info({ deleted: result.changes }, 'Semantic cache cleanup');
      }
    } catch (err) {
      logger.warn({ error: String(err) }, 'Semantic cache cleanup failed');
    }
  }

  /**
   * Destroy timers (for testing or shutdown).
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract prompt text from request body.
   * Handles OpenAI, Anthropic, and simple prompt/input formats.
   */
  private extractPromptText(body: Record<string, unknown>): string {
    // Messages array (OpenAI and Anthropic formats)
    if (body.messages && Array.isArray(body.messages)) {
      return (body.messages as any[])
        .filter((m: any) => m.role === 'user')
        .map((m: any) => {
          // Simple string content (OpenAI format)
          if (typeof m.content === 'string') return m.content;
          // Array content blocks (Anthropic format)
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

  /**
   * Detect if a response contains tool calls in any provider format.
   */
  private hasToolCalls(response: unknown): boolean {
    if (!response || typeof response !== 'object') return false;
    const resp = response as Record<string, unknown>;

    // OpenAI format: choices[].message.tool_calls
    if (resp.choices && Array.isArray(resp.choices)) {
      const has = resp.choices.some(
        (c: any) => c.message?.tool_calls && c.message.tool_calls.length > 0,
      );
      if (has) return true;
    }

    // Anthropic/Bedrock format: stop_reason === 'tool_use'
    if (resp.stop_reason === 'tool_use') return true;

    // Normalized format: finishReason === 'tool_calls'
    if (resp.finishReason === 'tool_calls') return true;

    return false;
  }

  /**
   * Normalize a finite, non-zero vector in place to unit length.
   */
  private normalizeInPlace(vec: Float32Array): boolean {
    if (vec.length === 0) return false;
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      if (!Number.isFinite(vec[i])) return false;
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (!Number.isFinite(norm) || norm === 0) return false;
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
    return true;
  }

  private cacheEmbeddingTimeout(): number {
    const configured = Number(process.env.DMRX_SEMANTIC_CACHE_EMBEDDING_TIMEOUT_MS);
    if (!Number.isFinite(configured) || configured <= 0) return 500;
    return Math.min(10_000, Math.max(1, Math.floor(configured)));
  }

  private async getRealEmbedding(text: string) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort(new Error('Semantic cache embedding deadline exceeded'));
        reject(new Error('Semantic cache embedding deadline exceeded'));
      }, this.embeddingTimeoutMs);
    });
    try {
      return await Promise.race([
        this.embeddings.embedReal(text, { signal: controller.signal, timeoutMs: this.embeddingTimeoutMs }),
        deadline,
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Dot product of two vectors. Both should be pre-normalized for cosine similarity.
   */
  private dotProduct(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }

  /**
   * Phase 1: Fetch lightweight candidates (no response payload).
   */
  private getCandidates(
    requestType: string,
    tenantId: string | undefined,
  ): SemanticCacheCandidate[] {
    const db = getDb();
    const whereClauses = [
      "request_type = ?",
      "julianday(expires_at) > julianday('now')",
    ];
    const params: unknown[] = [requestType];

    if (tenantId) {
      whereClauses.push('tenant_id = ?');
      params.push(tenantId);
    } else {
      whereClauses.push('tenant_id IS NULL');
    }

    const rows = db.prepare(`
      SELECT id, tenant_id, request_type, prompt_text, embedding, tokens, hit_count, created_at, expires_at
      FROM semantic_cache_entries
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 500
    `).all(...params) as any[];

    return rows.flatMap((row) => {
      const embedding = this.readCandidateEmbedding(row.embedding);
      if (!embedding) return [];
      return [{
        id: row.id,
        tenantId: row.tenant_id,
        requestType: row.request_type,
        promptText: row.prompt_text,
        embedding,
        tokens: row.tokens,
        hitCount: row.hit_count,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      }];
    });
  }

  private readCandidateEmbedding(value: unknown): Float32Array | null {
    // node:sqlite exposes BLOBs as Uint8Array; better-sqlite3 uses Buffer.
    if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return null;
    const bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    const vector = new Float32Array(bytes);
    return this.normalizeInPlace(vector) ? vector : null;
  }

  /**
   * Phase 2: Fetch full entry by ID (includes response payload).
   */
  private getEntryById(id: string): SemanticCacheEntry | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT id, tenant_id, request_type, prompt_text, embedding, response, tokens, hit_count, created_at, expires_at
      FROM semantic_cache_entries
      WHERE id = ? AND julianday(expires_at) > julianday('now')
    `).get(id) as any;

    if (!row) return null;
    const embedding = this.readCandidateEmbedding(row.embedding);
    if (!embedding) return null;

    return {
      id: row.id,
      tenantId: row.tenant_id,
      requestType: row.request_type,
      promptText: row.prompt_text,
      embedding,
      response: JSON.parse(row.response),
      tokens: row.tokens,
      hitCount: row.hit_count,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  /**
   * Increment hit count with error handling.
   */
  private incrementHitCount(id: string): void {
    try {
      const db = getDb();
      db.prepare('UPDATE semantic_cache_entries SET hit_count = hit_count + 1 WHERE id = ?').run(id);
    } catch (err) {
      logger.warn({ error: String(err), id }, 'Failed to increment semantic cache hit count');
    }
  }

  /**
   * Periodic cleanup of expired entries.
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Periodic eviction when over capacity.
   */
  private startEvictionTimer(): void {
    this.evictionTimer = setInterval(() => this.evictIfNeeded(), EVICTION_INTERVAL_MS);
    if (this.evictionTimer && typeof this.evictionTimer === 'object' && 'unref' in this.evictionTimer) {
      (this.evictionTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Evict oldest entries when over capacity.
   * Runs on a timer, not per-write.
   */
  private evictIfNeeded(): void {
    try {
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) as count FROM semantic_cache_entries').get() as any)?.count || 0;

      if (count > this.maxEntries) {
        // Delete oldest 10% of entries (by hit count, then creation time)
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
    } catch (err) {
      logger.warn({ error: String(err) }, 'Semantic cache eviction failed');
    }
  }
}

export const semanticCacheService = new SemanticCacheService();
