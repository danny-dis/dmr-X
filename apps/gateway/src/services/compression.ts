import { HeadroomClient, type CompressResult } from 'headroom-ai';
import { logger } from '@dmr-x/utils';
import { getDb } from '@dmr-x/db';

export interface CompressionConfig {
  enabled: boolean;
  proxyUrl: string;
  apiKey?: string;
  reversible: boolean;
  minTokensToCompress: number;
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
};

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

  async compressPrompt(
    messages: Array<{ role: string; content: string }>,
    tenantConfig?: Partial<CompressionConfig> | null,
    apiKeyConfig?: Partial<CompressionConfig> | null
  ): Promise<{ compressed: Array<{ role: string; content: string }>; metadata: CompressionMetadata }> {
    const config = this.mergeConfig(tenantConfig, apiKeyConfig);
    
    if (!config.enabled) {
      return { compressed: messages, metadata: { originalTokens: 0, compressedTokens: 0, saved: 0, algorithmUsed: 'none' } };
    }

    const estimatedTokens = this.estimateTokens(messages);
    if (estimatedTokens < config.minTokensToCompress) {
      return { compressed: messages, metadata: { originalTokens: estimatedTokens, compressedTokens: estimatedTokens, saved: 0, algorithmUsed: 'none' } };
    }

    try {
      const client = this.getClient();
      const result = await client.compress(messages as any);

      const compressedTokens = this.estimateTokens(result.messages as any);
      
      let compressedId: string | undefined;
      if (config.reversible) {
        compressedId = crypto.randomUUID();
        this.storeOriginal(compressedId, messages);
      }

      return {
        compressed: result.messages as Array<{ role: string; content: string }>,
        metadata: {
          originalTokens: result.tokensBefore || estimatedTokens,
          compressedTokens: result.tokensAfter || compressedTokens,
          saved: result.tokensSaved || (estimatedTokens - compressedTokens),
          algorithmUsed: 'headroom',
          compressedId,
        },
      };
    } catch (err) {
      logger.warn({ err }, 'Compression failed, returning original messages');
      return { compressed: messages, metadata: { originalTokens: estimatedTokens, compressedTokens: estimatedTokens, saved: 0, algorithmUsed: 'failed' } };
    }
  }

  async retrieveOriginal(compressedId: string): Promise<Array<{ role: string; content: string }> | null> {
    try {
      const db = getDb();
      const row = db.prepare('SELECT original_content FROM compression_cache WHERE id = ?').get(compressedId) as any;
      if (!row) return null;
      return JSON.parse(row.original_content);
    } catch (err) {
      logger.warn({ err, compressedId }, 'Failed to retrieve original content');
      return null;
    }
  }

  getGlobalConfig(): CompressionConfig {
    try {
      const db = getDb();
      const row = db.prepare("SELECT value FROM settings WHERE key = 'compression_config'").get() as any;
      if (row) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load global compression config');
    }
    return DEFAULT_CONFIG;
  }

  async updateGlobalConfig(config: Partial<CompressionConfig>): Promise<void> {
    const db = getDb();
    const current = this.getGlobalConfig();
    const updated = { ...current, ...config };
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('compression_config', ?, datetime('now'))").run(JSON.stringify(updated));
    
    // Reset client to pick up new config
    this.client = null;
  }

  getTenantConfig(tenantId: string): Partial<CompressionConfig> | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT compression_enabled, compression_algorithm, compression_reversible FROM tenants WHERE id = ?').get(tenantId) as any;
      if (!row || row.compression_enabled === null) return null;
      return {
        enabled: row.compression_enabled === 1,
        reversible: row.compression_reversible === 1,
      };
    } catch (err) {
      logger.warn({ err, tenantId }, 'Failed to load tenant compression config');
      return null;
    }
  }

  async updateTenantConfig(tenantId: string, config: Partial<CompressionConfig>): Promise<void> {
    const db = getDb();
    const fields: string[] = [];
    const values: any[] = [];
    
    if (config.enabled !== undefined) {
      fields.push('compression_enabled = ?');
      values.push(config.enabled ? 1 : 0);
    }
    if (config.reversible !== undefined) {
      fields.push('compression_reversible = ?');
      values.push(config.reversible ? 1 : 0);
    }
    
    if (fields.length > 0) {
      values.push(tenantId);
      db.prepare(`UPDATE tenants SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values);
    }
  }

  getApiKeyConfig(apiKeyId: string): Partial<CompressionConfig> | null {
    try {
      const db = getDb();
      const row = db.prepare('SELECT compression_enabled, compression_reversible FROM api_keys WHERE id = ?').get(apiKeyId) as any;
      if (!row || row.compression_enabled === null) return null;
      return {
        enabled: row.compression_enabled === 1,
        reversible: row.compression_reversible === 1,
      };
    } catch (err) {
      logger.warn({ err, apiKeyId }, 'Failed to load API key compression config');
      return null;
    }
  }

  async updateApiKeyConfig(apiKeyId: string, config: Partial<CompressionConfig>): Promise<void> {
    const db = getDb();
    const fields: string[] = [];
    const values: any[] = [];
    
    if (config.enabled !== undefined) {
      fields.push('compression_enabled = ?');
      values.push(config.enabled ? 1 : 0);
    }
    if (config.reversible !== undefined) {
      fields.push('compression_reversible = ?');
      values.push(config.reversible ? 1 : 0);
    }
    
    if (fields.length > 0) {
      values.push(apiKeyId);
      db.prepare(`UPDATE api_keys SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values);
    }
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
    return { ...global, ...tenant, ...apiKey };
  }

  private estimateTokens(messages: Array<{ role: string; content: string }>): number {
    let total = 0;
    for (const msg of messages) {
      total += Math.ceil(msg.content.length / 4);
    }
    return total;
  }

  private async storeOriginal(id: string, content: Array<{ role: string; content: string }>): Promise<void> {
    try {
      const db = getDb();
      db.prepare('INSERT OR REPLACE INTO compression_cache (id, original_content, created_at, expires_at) VALUES (?, ?, datetime(\'now\'), datetime(\'now\', \'+24 hours\'))').run(id, JSON.stringify(content));
    } catch (err) {
      logger.warn({ err, id }, 'Failed to store original content');
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