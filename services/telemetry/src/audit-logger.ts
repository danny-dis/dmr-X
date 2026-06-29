import crypto from 'node:crypto';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

/**
 * Audit Logger — immutable audit trail for admin actions.
 *
 * Mirrors LiteLLM's audit logging:
 * - Logs all admin actions (key creation/deletion, policy changes, etc.)
 * - Immutable records in SQLite
 * - Exportable audit logs
 * - Correlated with request IDs
 *
 * Table: audit_logs
 *   id, timestamp, action, actor_id, actor_ip, tenant_id,
 *   target_type, target_id, details, request_id
 */

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  actorId?: string;
  actorIp?: string;
  tenantId?: string;
  targetType: string;
  targetId?: string;
  details: Record<string, unknown>;
  requestId?: string;
}

export interface AuditLogQuery {
  tenantId?: string;
  action?: string;
  actorId?: string;
  targetType?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export class AuditLogger {
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          action TEXT NOT NULL,
          actor_id TEXT,
          actor_ip TEXT,
          tenant_id TEXT,
          target_type TEXT NOT NULL,
          target_id TEXT,
          details TEXT DEFAULT '{}',
          request_id TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
        CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
        CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id);
      `);
      this.initialized = true;
    } catch (error) {
      logger.warn({ err: error }, 'Failed to initialize audit_logs table');
    }
  }

  /**
   * Log an audit event.
   */
  log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    this.init();
    const db = getDb();
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    db.prepare(`
      INSERT INTO audit_logs (id, timestamp, action, actor_id, actor_ip, tenant_id, target_type, target_id, details, request_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      timestamp,
      entry.action,
      entry.actorId || null,
      entry.actorIp || null,
      entry.tenantId || null,
      entry.targetType,
      entry.targetId || null,
      JSON.stringify(entry.details || {}),
      entry.requestId || null,
    );

    const fullEntry: AuditLogEntry = { ...entry, id, timestamp };

    // Also log to structured logger for real-time monitoring
    logger.info({
      audit: {
        id,
        action: entry.action,
        actor: entry.actorId,
        target: `${entry.targetType}:${entry.targetId || '*'}`,
        tenant: entry.tenantId,
      },
    }, 'audit_action');

    return fullEntry;
  }

  /**
   * Query audit logs.
   */
  query(query: AuditLogQuery): AuditLogEntry[] {
    this.init();
    const db = getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.tenantId) {
      conditions.push('tenant_id = ?');
      params.push(query.tenantId);
    }
    if (query.action) {
      conditions.push('action = ?');
      params.push(query.action);
    }
    if (query.actorId) {
      conditions.push('actor_id = ?');
      params.push(query.actorId);
    }
    if (query.targetType) {
      conditions.push('target_type = ?');
      params.push(query.targetType);
    }
    if (query.from) {
      conditions.push('timestamp >= ?');
      params.push(query.from.toISOString());
    }
    if (query.to) {
      conditions.push('timestamp <= ?');
      params.push(query.to.toISOString());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const rows = db.prepare(`
      SELECT id, timestamp, action, actor_id, actor_ip, tenant_id, target_type, target_id, details, request_id
      FROM audit_logs
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      action: row.action,
      actorId: row.actor_id,
      actorIp: row.actor_ip,
      tenantId: row.tenant_id,
      targetType: row.target_type,
      targetId: row.target_id,
      details: JSON.parse(row.details || '{}'),
      requestId: row.request_id,
    }));
  }

  /**
   * Get audit log count for a tenant.
   */
  count(tenantId?: string): number {
    this.init();
    const db = getDb();
    if (tenantId) {
      const row = db.prepare('SELECT COUNT(*) as count FROM audit_logs WHERE tenant_id = ?').get(tenantId) as any;
      return row?.count || 0;
    }
    const row = db.prepare('SELECT COUNT(*) as count FROM audit_logs').get() as any;
    return row?.count || 0;
  }

  /**
   * Export audit logs as JSON (for compliance/backup).
   */
  export(tenantId?: string, from?: Date, to?: Date): AuditLogEntry[] {
    return this.query({ tenantId, from, to, limit: 10000 });
  }

  /**
   * Clean up old audit logs (retention policy).
   */
  cleanup(retentionDays: number = 90): number {
    this.init();
    const db = getDb();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare('DELETE FROM audit_logs WHERE timestamp < ?').run(cutoff);
    if (result.changes > 0) {
      logger.info({ deleted: result.changes, retentionDays }, 'Audit logs cleaned up');
    }
    return result.changes;
  }
}

export const auditLogger = new AuditLogger();
