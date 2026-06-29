import crypto from 'node:crypto';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

/**
 * Virtual Keys service — per-key rate limits, budgets, and model restrictions.
 *
 * Mirrors LiteLLM's virtual key system:
 * - Each key is scoped to a user/team
 * - Per-key RPM/TPM limits
 * - Per-key budget caps
 * - Per-key model restrictions
 * - Key expiry
 */

export interface VirtualKey {
  id: string;
  keyHash: string;
  keyPrefix: string;
  userId: string | null;
  teamId: string | null;
  tenantId: string;
  models: string[] | null;  // null = all models
  rpmLimit: number | null;
  tpmLimit: number | null;
  maxBudget: number | null;  // in cents
  budgetDuration: string | null;  // 'daily', 'weekly', 'monthly'
  budgetSpent: number;
  expiresAt: string | null;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVirtualKeyInput {
  userId?: string;
  teamId?: string;
  tenantId: string;
  models?: string[];
  rpmLimit?: number;
  tpmLimit?: number;
  maxBudget?: number;
  budgetDuration?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export class VirtualKeysService {
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS virtual_keys (
          id TEXT PRIMARY KEY,
          key_hash TEXT NOT NULL UNIQUE,
          key_prefix TEXT NOT NULL,
          user_id TEXT,
          team_id TEXT,
          tenant_id TEXT NOT NULL,
          models TEXT,  -- JSON array, null = all models
          rpm_limit INTEGER,
          tpm_limit INTEGER,
          max_budget INTEGER,  -- cents
          budget_duration TEXT,
          budget_spent INTEGER DEFAULT 0,
          expires_at TEXT,
          is_active INTEGER DEFAULT 1,
          metadata TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_vk_key_prefix ON virtual_keys(key_prefix);
        CREATE INDEX IF NOT EXISTS idx_vk_tenant_id ON virtual_keys(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_vk_user_id ON virtual_keys(user_id);
        CREATE INDEX IF NOT EXISTS idx_vk_team_id ON virtual_keys(team_id);
      `);
      this.initialized = true;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to initialize virtual_keys table');
    }
  }

  /**
   * Create a new virtual key. Returns the plain-text key (shown once).
   */
  create(input: CreateVirtualKeyInput): { key: string; keyPrefix: string; id: string } {
    this.init();
    const db = getDb();
    const id = crypto.randomUUID();
    const plainKey = `sk-dmrx-${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex');
    const keyPrefix = plainKey.slice(0, 12);

    db.prepare(`
      INSERT INTO virtual_keys (id, key_hash, key_prefix, user_id, team_id, tenant_id, models, rpm_limit, tpm_limit, max_budget, budget_duration, expires_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      keyHash,
      keyPrefix,
      input.userId || null,
      input.teamId || null,
      input.tenantId,
      input.models ? JSON.stringify(input.models) : null,
      input.rpmLimit || null,
      input.tpmLimit || null,
      input.maxBudget || null,
      input.budgetDuration || null,
      input.expiresAt || null,
      JSON.stringify(input.metadata || {}),
    );

    logger.info({ id, keyPrefix, tenantId: input.tenantId }, 'Virtual key created');
    return { key: plainKey, keyPrefix, id };
  }

  /**
   * Validate a virtual key. Returns the key record if valid.
   */
  validate(plainKey: string): VirtualKey | null {
    this.init();
    const db = getDb();
    const keyHash = crypto.createHash('sha256').update(plainKey).digest('hex');

    const row = db.prepare('SELECT * FROM virtual_keys WHERE key_hash = ? AND is_active = 1').get(keyHash) as any;
    if (!row) return null;

    // Check expiry
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return null;
    }

    return this.rowToKey(row);
  }

  /**
   * List all virtual keys for a tenant.
   */
  list(tenantId: string): VirtualKey[] {
    this.init();
    const db = getDb();
    const rows = db.prepare('SELECT * FROM virtual_keys WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId) as any[];
    return rows.map(r => this.rowToKey(r));
  }

  /**
   * Get a virtual key by ID.
   */
  getById(id: string): VirtualKey | null {
    this.init();
    const db = getDb();
    const row = db.prepare('SELECT * FROM virtual_keys WHERE id = ?').get(id) as any;
    return row ? this.rowToKey(row) : null;
  }

  /**
   * Deactivate a virtual key.
   */
  deactivate(id: string): void {
    this.init();
    const db = getDb();
    db.prepare('UPDATE virtual_keys SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(id);
    logger.info({ id }, 'Virtual key deactivated');
  }

  /**
   * Delete a virtual key.
   */
  delete(id: string): void {
    this.init();
    const db = getDb();
    db.prepare('DELETE FROM virtual_keys WHERE id = ?').run(id);
    logger.info({ id }, 'Virtual key deleted');
  }

  /**
   * Record spend against a key.
   */
  recordSpend(id: string, costCents: number): void {
    this.init();
    const db = getDb();
    db.prepare('UPDATE virtual_keys SET budget_spent = budget_spent + ?, updated_at = datetime(\'now\') WHERE id = ?').run(costCents, id);
  }

  /**
   * Reset spend for a key (called on budget duration rollover).
   */
  resetSpend(id: string): void {
    this.init();
    const db = getDb();
    db.prepare('UPDATE virtual_keys SET budget_spent = 0, updated_at = datetime(\'now\') WHERE id = ?').run(id);
  }

  /**
   * Update a virtual key.
   */
  update(id: string, updates: Partial<Pick<VirtualKey, 'models' | 'rpmLimit' | 'tpmLimit' | 'maxBudget' | 'budgetDuration' | 'expiresAt' | 'metadata'>>): void {
    this.init();
    const db = getDb();
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.models !== undefined) {
      fields.push('models = ?');
      values.push(updates.models ? JSON.stringify(updates.models) : null);
    }
    if (updates.rpmLimit !== undefined) {
      fields.push('rpm_limit = ?');
      values.push(updates.rpmLimit);
    }
    if (updates.tpmLimit !== undefined) {
      fields.push('tpm_limit = ?');
      values.push(updates.tpmLimit);
    }
    if (updates.maxBudget !== undefined) {
      fields.push('max_budget = ?');
      values.push(updates.maxBudget);
    }
    if (updates.budgetDuration !== undefined) {
      fields.push('budget_duration = ?');
      values.push(updates.budgetDuration);
    }
    if (updates.expiresAt !== undefined) {
      fields.push('expires_at = ?');
      values.push(updates.expiresAt);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length > 0) {
      fields.push('updated_at = datetime(\'now\')');
      values.push(id);
      db.prepare(`UPDATE virtual_keys SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  /**
   * Check if a virtual key's rate limit would be exceeded.
   * Returns { allowed: true } or { allowed: false, reason: string, retryAfterMs: number }.
   */
  checkKeyRateLimit(key: VirtualKey, estimatedTokens: number = 0): { allowed: boolean; reason?: string; retryAfterMs?: number } {
    // Check RPM limit
    if (key.rpmLimit) {
      const db = getDb();
      const row = db.prepare(
        `SELECT COUNT(*) as count FROM usage_records
         WHERE request_id LIKE ? AND created_at >= datetime('now', '-1 minute')`
      ).get(`${key.id}:*`) as any;
      if (row && row.count >= key.rpmLimit) {
        return { allowed: false, reason: `Key RPM limit (${key.rpmLimit}) exceeded`, retryAfterMs: 60_000 };
      }
    }

    // Check budget limit
    if (key.maxBudget && key.budgetDuration) {
      const budgetRemaining = key.maxBudget - key.budgetSpent;
      if (budgetRemaining <= 0) {
        return { allowed: false, reason: `Key budget limit ($${(key.maxBudget / 100).toFixed(2)}) exhausted`, retryAfterMs: 3_600_000 };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if a virtual key's model restriction allows the requested model.
   */
  checkKeyModelAccess(key: VirtualKey, modelId: string): boolean {
    if (!key.models || key.models.length === 0) return true; // null/empty = all models
    return key.models.includes(modelId) || key.models.includes('*');
  }

  /**
   * Get virtual key statistics for a tenant.
   */
  getKeyStats(tenantId: string): { totalKeys: number; activeKeys: number; totalBudgetSpent: number } {
    this.init();
    const db = getDb();
    const row = db.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active, COALESCE(SUM(budget_spent), 0) as spent
       FROM virtual_keys WHERE tenant_id = ?`
    ).get(tenantId) as any;
    return {
      totalKeys: row?.total || 0,
      activeKeys: row?.active || 0,
      totalBudgetSpent: row?.spent || 0,
    };
  }

  private rowToKey(row: any): VirtualKey {
    return {
      id: row.id,
      keyHash: row.key_hash,
      keyPrefix: row.key_prefix,
      userId: row.user_id,
      teamId: row.team_id,
      tenantId: row.tenant_id,
      models: row.models ? JSON.parse(row.models) : null,
      rpmLimit: row.rpm_limit,
      tpmLimit: row.tpm_limit,
      maxBudget: row.max_budget,
      budgetDuration: row.budget_duration,
      budgetSpent: row.budget_spent,
      expiresAt: row.expires_at,
      isActive: row.is_active === 1,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const virtualKeysService = new VirtualKeysService();
