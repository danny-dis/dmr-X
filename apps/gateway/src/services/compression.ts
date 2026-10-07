import { HeadroomClient } from 'headroom-ai';
import { logger } from '@dmr-x/utils';
import { getDb } from '@dmr-x/db';
import { compressRTK, type RTKOptions } from './engines/rtk.js';
import { compressCaveman, type CavemanOptions } from './engines/caveman.js';
import { stripComments, type CommentStripOptions } from './engines/comment-stripper.js';
import { CompressionConfigSchema } from './compression-config.js';

export interface CompressionMessage {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  function_call?: unknown;
  tool_call_id?: string;
}

// Only historical plain-text assistant prose is eligible. Never rewrite
// instructions, user intent, tool exchanges, structured data or literal code.
function canCompressMessage(message: CompressionMessage, index: number, count: number): message is CompressionMessage & { content: string } {
  return index < count - 1 && message.role === 'assistant' &&
    typeof message.content === 'string' && !message.tool_calls &&
    !message.function_call && !message.tool_call_id &&
    !/```|~~~|`|^\s*[\[{]|^ {4}\S|\t|^\s*(?:import|export|const|let|var|function|class|def|fn)\s+/m.test(message.content);
}

export type CompressionEngine = 'headroom' | 'rtk' | 'caveman' | 'comment-strip' | 'auto';

export interface CompressionConfig {
  enabled: boolean;
  proxyUrl: string;
  apiKey?: string;
  reversible: boolean;
  minTokensToCompress: number;
  /** Compression engine to use (default: 'auto') */
  engine?: CompressionEngine;
  /** RTK-specific options */
  rtkOptions?: RTKOptions;
  /** Caveman-specific options */
  cavemanOptions?: CavemanOptions;
  /** Comment strip options */
  commentStripOptions?: CommentStripOptions;
}

export interface CompressionMetadata {
  originalTokens: number;
  compressedTokens: number;
  saved: number;
  algorithmUsed: string;
  compressedId?: string;
}

const DEFAULT_CONFIG: CompressionConfig = {
  enabled: false,
  proxyUrl: process.env.HEADROOM_PROXY_URL || 'http://localhost:8787',
  reversible: true,
  minTokensToCompress: 100,
  engine: 'auto',
};

function validateConfig(value: unknown): Partial<CompressionConfig> {
  return CompressionConfigSchema.parse(value) as Partial<CompressionConfig>;
}

function definedMerge<T extends object>(...sources: Array<Partial<T> | null | undefined>): T {
  const merged: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) if (value !== undefined) merged[key] = value;
  }
  return merged as T;
}

export class CompressionService {
  private static instance: CompressionService;
  private client: HeadroomClient | null = null;
  
  private constructor() {}
  
  static getInstance(): CompressionService {
    if (!CompressionService.instance) {
      CompressionService.instance = new CompressionService();
    }
    return CompressionService.instance;
  }

  private getClient(): HeadroomClient {
    if (!this.client) {
      const config = this.getGlobalConfig();
      this.client = new HeadroomClient({
        baseUrl: config.proxyUrl,
        apiKey: config.apiKey,
      });
    }
    return this.client;
  }

  async compressPrompt<T extends CompressionMessage>(
    messages: T[],
    tenantConfig?: Partial<CompressionConfig> | null,
    apiKeyConfig?: Partial<CompressionConfig> | null,
    owner?: { tenantId: string; apiKeyId?: string }
  ): Promise<{ compressed: T[]; metadata: CompressionMetadata }> {
    const config = this.mergeConfig(tenantConfig, apiKeyConfig);
    if (config.enabled && config.reversible && !owner?.tenantId) {
      return { compressed: messages, metadata: { originalTokens: this.estimateTokens(messages), compressedTokens: this.estimateTokens(messages), saved: 0, algorithmUsed: 'failed' } };
    }

    if (!config.enabled) {
      return { compressed: messages, metadata: { originalTokens: 0, compressedTokens: 0, saved: 0, algorithmUsed: 'none' } };
    }

    const estimatedTokens = this.estimateTokens(messages);
    if (estimatedTokens < config.minTokensToCompress) {
      return { compressed: messages, metadata: { originalTokens: estimatedTokens, compressedTokens: estimatedTokens, saved: 0, algorithmUsed: 'none' } };
    }

    const engine = config.engine || 'auto';

    // Auto-detect engine based on content type
    if (engine === 'auto') {
      return this.compressWithAutoEngine(messages, config, estimatedTokens, owner);
    }

    return this.compressWithEngine(messages, config, estimatedTokens, engine, owner);
  }

  private async compressWithAutoEngine<T extends CompressionMessage>(
    messages: T[],
    config: CompressionConfig,
    estimatedTokens: number,
    owner?: { tenantId: string; apiKeyId?: string }
  ): Promise<{ compressed: T[]; metadata: CompressionMetadata }> {
    // Analyze content to pick best engine
    const allContent = messages.map(m => m.content).join('\n');
    const hasCode = /```[\s\S]*?```/.test(allContent) || /^\s*(import|export|const|let|var|function|class|def|fn)\s+/m.test(allContent);
    const hasJSON = /^\s*[[{]/.test(allContent) && /[\]}]\s*$/.test(allContent);
    const isCommandOutput = /^\s*(total|drwx|dr-x|-rw|npm|git|ls|cat|grep)/m.test(allContent);

    // Pick engine based on content characteristics
    if (isCommandOutput || (hasJSON && estimatedTokens > 200)) {
      return this.compressWithEngine(messages, config, estimatedTokens, 'rtk', owner);
    }
    if (hasCode) {
      return this.compressWithEngine(messages, config, estimatedTokens, 'comment-strip', owner);
    }
    // Default to caveman for prose-heavy content
    return this.compressWithEngine(messages, config, estimatedTokens, 'caveman', owner);
  }

  private async compressWithEngine<T extends CompressionMessage>(
    messages: T[],
    config: CompressionConfig,
    estimatedTokens: number,
    engine: CompressionEngine,
    owner?: { tenantId: string; apiKeyId?: string }
  ): Promise<{ compressed: T[]; metadata: CompressionMetadata }> {
    try {
      if (engine === 'headroom') {
        return this.compressWithHeadroom(messages, config, estimatedTokens, owner);
      }

      // For local engines, compress each message's content
      let totalSaved = 0;
      let totalOriginal = 0;
      let totalCompressed = 0;

      const compressed = messages.map((msg, index) => {
        const tokens = this.estimateTokens([msg]);
        if (!canCompressMessage(msg, index, messages.length)) {
          totalOriginal += tokens;
          totalCompressed += tokens;
          return msg;
        }
        let result: { compressed: string; originalTokens: number; compressedTokens: number; saved: number };

        switch (engine) {
          case 'rtk':
            result = compressRTK(msg.content, config.rtkOptions);
            break;
          case 'caveman':
            result = compressCaveman(msg.content, config.cavemanOptions);
            break;
          case 'comment-strip':
            result = stripComments(msg.content, config.commentStripOptions);
            break;
          default:
            result = compressRTK(msg.content, config.rtkOptions);
        }

        totalOriginal += result.originalTokens;
        totalCompressed += result.compressedTokens;
        totalSaved += result.saved;

        return { ...msg, content: result.compressed } as T;
      });

      let compressedId: string | undefined;
      if (config.reversible) {
        compressedId = crypto.randomUUID();
        if (!await this.storeOriginal(compressedId, messages, owner)) {
          return { compressed: messages, metadata: { originalTokens: estimatedTokens, compressedTokens: estimatedTokens, saved: 0, algorithmUsed: 'failed' } };
        }
      }

      return {
        compressed,
        metadata: {
          originalTokens: totalOriginal,
          compressedTokens: totalCompressed,
          saved: totalSaved,
          algorithmUsed: engine,
          compressedId,
        },
      };
    } catch (err) {
      logger.warn({ err, engine }, 'Compression failed, returning original messages');
      return { compressed: messages, metadata: { originalTokens: estimatedTokens, compressedTokens: estimatedTokens, saved: 0, algorithmUsed: 'failed' } };
    }
  }

  private async compressWithHeadroom<T extends CompressionMessage>(
    messages: T[],
    config: CompressionConfig,
    estimatedTokens: number,
    owner?: { tenantId: string; apiKeyId?: string }
  ): Promise<{ compressed: T[]; metadata: CompressionMetadata }> {
    try {
      const eligible = messages.flatMap((message, index) =>
        canCompressMessage(message, index, messages.length) ? [{ index, message }] : []);
      if (eligible.length === 0) {
        return { compressed: messages, metadata: { originalTokens: estimatedTokens, compressedTokens: estimatedTokens, saved: 0, algorithmUsed: 'none' } };
      }
      const client = this.getClient();
      const result = await client.compress(eligible.map(({ message }) => ({ role: message.role, content: message.content })) as any);
      if (!Array.isArray(result.messages) || result.messages.length !== eligible.length ||
          result.messages.some((message: any, index: number) =>
            message?.role !== eligible[index].message.role || typeof message.content !== 'string' ||
            !message.content.trim() || message.content.length > (eligible[index].message.content as string).length)) {
        throw new Error('Headroom returned an invalid compression envelope');
      }
      const compressed = messages.slice();
      eligible.forEach(({ index, message }, position) => {
        compressed[index] = { ...message, content: result.messages[position].content } as T;
      });
      const compressedTokens = this.estimateTokens(compressed);

      let compressedId: string | undefined;
      if (config.reversible) {
        compressedId = crypto.randomUUID();
        if (!await this.storeOriginal(compressedId, messages, owner)) {
          return { compressed: messages, metadata: { originalTokens: estimatedTokens, compressedTokens: estimatedTokens, saved: 0, algorithmUsed: 'failed' } };
        }
      }

      return {
        compressed,
        metadata: {
          originalTokens: estimatedTokens,
          compressedTokens,
          saved: estimatedTokens - compressedTokens,
          algorithmUsed: 'headroom',
          compressedId,
        },
      };
    } catch (err) {
      logger.warn({ err }, 'Headroom compression failed, returning original messages');
      return { compressed: messages, metadata: { originalTokens: estimatedTokens, compressedTokens: estimatedTokens, saved: 0, algorithmUsed: 'failed' } };
    }
  }

  async retrieveOriginal(
    compressedId: string,
    owner?: { tenantId: string; apiKeyId?: string }
  ): Promise<CompressionMessage[] | null> {
    try {
      if (!owner?.tenantId) return null;
      const db = getDb();
      const row = db.prepare(
        `SELECT original_content FROM compression_cache
         WHERE id = ? AND tenant_id = ? AND api_key_id IS ?
           AND julianday(expires_at) > julianday('now')`
      ).get(compressedId, owner.tenantId, owner.apiKeyId ?? null) as any;
      if (!row) return null;
      const content = JSON.parse(row.original_content);
      if (!Array.isArray(content)) return null;
      return content;
    } catch (err) {
      logger.warn({ err, compressedId }, 'Failed to retrieve original content');
      return null;
    }
  }

  getGlobalConfig(): CompressionConfig {
    try {
      const row = getDb().prepare("SELECT value FROM settings WHERE key = 'compression_config'").get() as { value: string } | undefined;
      if (row) {
        const parsed = validateConfig(JSON.parse(row.value));
        return { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load global compression config');
    }
    return { ...DEFAULT_CONFIG, enabled: false };
  }

  async updateGlobalConfig(config: Partial<CompressionConfig>): Promise<void> {
    const update = validateConfig(config);
    const updated = definedMerge<CompressionConfig>(this.getGlobalConfig(), update);
    const validated = CompressionConfigSchema.parse(updated);
    getDb().prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('compression_config', ?, datetime('now'))").run(JSON.stringify(validated));
    this.client = null;
  }

  getTenantConfig(tenantId: string): Partial<CompressionConfig> | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT compression_enabled, compression_algorithm, compression_reversible FROM tenants WHERE id = ?').get(tenantId) as any;
      if (!row) return null;
      const savedRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(`compression:tenant:${tenantId}`) as { value: string } | undefined;
      let saved: Partial<CompressionConfig> = {};
      if (savedRow) {
        try { saved = validateConfig(JSON.parse(savedRow.value)); }
        catch (err) { logger.warn({ err, tenantId }, 'Invalid saved tenant compression config'); return { enabled: false }; }
      }
      const legacy: Partial<CompressionConfig> = {};
      if (row.compression_enabled !== null) legacy.enabled = row.compression_enabled === 1;
      if (row.compression_reversible === 0) legacy.reversible = false;
      else if (row.compression_reversible === 1 && row.compression_enabled !== null) legacy.reversible = true;
      if (typeof row.compression_algorithm === 'string' && ['headroom', 'rtk', 'caveman', 'comment-strip', 'auto'].includes(row.compression_algorithm)) legacy.engine = row.compression_algorithm;
      const combined = definedMerge<CompressionConfig>(legacy, saved);
      return Object.keys(combined).length ? combined : null;
    } catch (err) {
      logger.warn({ err, tenantId }, 'Failed to load tenant compression config');
      return null;
    }
  }

  async updateTenantConfig(tenantId: string, config: Partial<CompressionConfig>): Promise<void> {
    const update = validateConfig(config);
    if (update.proxyUrl !== undefined || update.apiKey !== undefined || update.minTokensToCompress !== undefined) throw new Error('Global-only compression settings cannot be scoped');
    const db = getDb();
    const key = `compression:tenant:${tenantId}`;
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    const previous = row ? validateConfig(JSON.parse(row.value)) : {};
    const merged = definedMerge<CompressionConfig>(previous, update);
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, JSON.stringify(merged));
    const fields: string[] = [];
    const values: unknown[] = [];
    const effective = definedMerge<CompressionConfig>(this.getTenantConfig(tenantId), merged);
    if (effective.enabled !== undefined) { fields.push('compression_enabled = ?'); values.push(effective.enabled ? 1 : 0); }
    if (effective.reversible !== undefined) { fields.push('compression_reversible = ?'); values.push(effective.reversible ? 1 : 0); }
    if (effective.engine !== undefined) { fields.push('compression_algorithm = ?'); values.push(effective.engine); }
    if (fields.length) { values.push(tenantId); db.prepare(`UPDATE tenants SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values); }
  }

  getApiKeyConfig(apiKeyId: string): Partial<CompressionConfig> | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT compression_enabled, compression_algorithm, compression_reversible FROM api_keys WHERE id = ?').get(apiKeyId) as any;
      if (!row) return null;
      const savedRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(`compression:apikey:${apiKeyId}`) as { value: string } | undefined;
      let saved: Partial<CompressionConfig> = {};
      if (savedRow) {
        try { saved = validateConfig(JSON.parse(savedRow.value)); }
        catch (err) { logger.warn({ err, apiKeyId }, 'Invalid saved API key compression config'); return { enabled: false }; }
      }
      const legacy: Partial<CompressionConfig> = {};
      if (row.compression_enabled !== null) legacy.enabled = row.compression_enabled === 1;
      if (row.compression_reversible === 0) legacy.reversible = false;
      else if (row.compression_reversible === 1 && row.compression_enabled !== null) legacy.reversible = true;
      if (typeof row.compression_algorithm === 'string' && ['headroom', 'rtk', 'caveman', 'comment-strip', 'auto'].includes(row.compression_algorithm)) legacy.engine = row.compression_algorithm;
      const combined = definedMerge<CompressionConfig>(legacy, saved);
      return Object.keys(combined).length ? combined : null;
    } catch (err) {
      logger.warn({ err, apiKeyId }, 'Failed to load API key compression config');
      return null;
    }
  }

  async updateApiKeyConfig(apiKeyId: string, config: Partial<CompressionConfig>): Promise<void> {
    const update = validateConfig(config);
    if (update.proxyUrl !== undefined || update.apiKey !== undefined || update.minTokensToCompress !== undefined) throw new Error('Global-only compression settings cannot be scoped');
    const db = getDb();
    const key = `compression:apikey:${apiKeyId}`;
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    const previous = row ? validateConfig(JSON.parse(row.value)) : {};
    const merged = definedMerge<CompressionConfig>(previous, update);
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, JSON.stringify(merged));
    const fields: string[] = [];
    const values: unknown[] = [];
    const effective = definedMerge<CompressionConfig>(this.getApiKeyConfig(apiKeyId), merged);
    if (effective.enabled !== undefined) { fields.push('compression_enabled = ?'); values.push(effective.enabled ? 1 : 0); }
    if (effective.reversible !== undefined) { fields.push('compression_reversible = ?'); values.push(effective.reversible ? 1 : 0); }
    if (effective.engine !== undefined) { fields.push('compression_algorithm = ?'); values.push(effective.engine); }
    if (fields.length) { values.push(apiKeyId); db.prepare(`UPDATE api_keys SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values); }
  }

  async getCompressionStats(tenantId?: string): Promise<{
    totalRequests: number;
    totalTokensSaved: number;
    avgCompressionRatio: number;
  }> {
    try {
      const db = getDb();
      let query = 'SELECT COUNT(*) as total, SUM(compression_tokens_saved) as saved FROM request_logs WHERE compression_tokens_saved IS NOT NULL';
      const params: any[] = [];
      
      if (tenantId) {
        query += ' AND tenant_id = ?';
        params.push(tenantId);
      }
      
      const row = db.prepare(query).get(...params) as any;
      return {
        totalRequests: row?.total || 0,
        totalTokensSaved: row?.saved || 0,
        avgCompressionRatio: row?.total ? (row?.saved || 0) / row?.total : 0,
      };
    } catch (err) {
      logger.warn({ err }, 'Failed to get compression stats');
      return { totalRequests: 0, totalTokensSaved: 0, avgCompressionRatio: 0 };
    }
  }

  private mergeConfig(
    tenant?: Partial<CompressionConfig> | null,
    apiKey?: Partial<CompressionConfig> | null
  ): CompressionConfig {
    const global = this.getGlobalConfig();
    return { ...DEFAULT_CONFIG, ...definedMerge<CompressionConfig>(global, tenant, apiKey) };
  }

  private estimateTokens(messages: CompressionMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
      total += Math.ceil(text.length / 4);
    }
    return total;
  }

  private async storeOriginal(
    id: string,
    content: CompressionMessage[],
    owner?: { tenantId: string; apiKeyId?: string }
  ): Promise<boolean> {
    if (!owner?.tenantId) return false;
    try {
      const db = getDb();
      db.prepare('INSERT OR REPLACE INTO compression_cache (id, original_content, created_at, expires_at, tenant_id, api_key_id) VALUES (?, ?, datetime(\'now\'), datetime(\'now\', \'+24 hours\'), ?, ?)').run(
        id, JSON.stringify(content), owner.tenantId, owner.apiKeyId ?? null
      );
      return true;
    } catch (err) {
      logger.warn({ err, id }, 'Failed to store original content');
      return false;
    }
  }

  async cleanupExpiredCache(): Promise<void> {
    try {
      const db = getDb();
      db.prepare("DELETE FROM compression_cache WHERE expires_at < datetime('now')").run();
    } catch (err) {
      logger.warn({ err }, 'Failed to cleanup compression cache');
    }
  }
}

export const compressionService = CompressionService.getInstance();