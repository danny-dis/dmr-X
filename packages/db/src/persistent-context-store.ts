import { getDb } from './client.js';

/**
 * Persistent context store that uses SQLite for conversation context storage.
 * Replaces the in-memory Map to ensure contexts survive server restarts.
 */
export class PersistentContextStore {
  /**
   * Get a context by ID.
   * Returns null if not found or expired.
   */
  get(key: string): string | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT messages, expires_at 
      FROM conversation_contexts 
      WHERE id = ?
    `).get(key) as any;

    if (!row) return null;

    // Check expiration
    if (row.expires_at) {
      const expiresAt = new Date(row.expires_at);
      if (expiresAt < new Date()) {
        // Expired - delete it
        this.delete(key);
        return null;
      }
    }

    return row.messages;
  }

  /**
   * Store a context with optional TTL.
   * If ttl is 0 or negative, the context never expires (permanent).
   */
  set(key: string, value: string, ttl: number = 86400): void {
    const db = getDb();
    const isPermanent = ttl <= 0 ? 1 : 0;
    
    // Calculate expiration time
    let expiresAt: string | null = null;
    if (ttl > 0) {
      const expires = new Date(Date.now() + ttl * 1000);
      expiresAt = expires.toISOString();
    }

    // Extract user_id from the context JSON if available
    let userId = 'anonymous';
    try {
      const context = JSON.parse(value);
      if (context.user) userId = context.user;
    } catch {
      // Ignore parse errors
    }

    db.prepare(`
      INSERT OR REPLACE INTO conversation_contexts (id, user_id, messages, created_at, updated_at, expires_at, is_permanent)
      VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, ?)
    `).run(key, userId, value, expiresAt, isPermanent);
  }

  /**
   * Delete a context by key.
   */
  delete(key: string): void {
    const db = getDb();
    db.prepare('DELETE FROM conversation_contexts WHERE id = ?').run(key);
  }

  /**
   * Get all keys matching a prefix.
   */
  keys(prefix: string): string[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id FROM conversation_contexts 
      WHERE id LIKE ?
    `).all(`${prefix}%`) as any[];

    return rows.map((r: any) => r.id);
  }

  /**
   * List all contexts for a user.
   */
  listByUser(userId: string, limit: number = 100): Array<{ id: string; created_at: string; expires_at: string | null }> {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, created_at, expires_at 
      FROM conversation_contexts 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(userId, limit) as any[];

    return rows.map((r: any) => ({
      id: r.id,
      created_at: r.created_at,
      expires_at: r.expires_at,
    }));
  }

  /**
   * Make a context permanent (never expires).
   */
  makePermanent(key: string): boolean {
    const db = getDb();
    const result = db.prepare(`
      UPDATE conversation_contexts 
      SET is_permanent = 1, expires_at = NULL 
      WHERE id = ?
    `).run(key);

    return result.changes > 0;
  }

  /**
   * Clean up expired contexts.
   */
  cleanupExpired(): number {
    const db = getDb();
    const result = db.prepare(`
      DELETE FROM conversation_contexts 
      WHERE is_permanent = 0 
        AND expires_at IS NOT NULL 
        AND expires_at < datetime('now')
    `).run();

    return result.changes;
  }
}

// Singleton instance
export const persistentContextStore = new PersistentContextStore();
