/**
 * SQLite-backed audit event store for DMR-X MCP server.
 *
 * Replaces the in-memory AuditTrailEngine.events[] so audit events survive
 * process restarts. Uses the MCP server's own @dmr-x/db DatabaseWrapper
 * (isolated DMRX_DATA_DIR, no gateway contention).
 *
 * The tamper-evident hash chain from AuditTrailEngine is preserved: each
 * row stores the previous event's hash, and verifyIntegrity() replays
 * the chain from the DB.
 */

import crypto from 'node:crypto';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

export interface AuditEventRow {
  id: string;
  timestamp: string;
  event_type: string;
  severity: string;
  message: string;
  actor_type: string;
  actor_id: string;
  actor_ip: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata: string | null;
  request: string | null;
  response: string | null;
  previous_hash: string | null;
  hash: string;
}

export interface AuditLogQuery {
  type?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class AuditLogStore {
  private hashAlgorithm: 'sha256' | 'sha512';

  constructor(opts?: { hashAlgorithm?: 'sha256' | 'sha512' }) {
    this.hashAlgorithm = opts?.hashAlgorithm ?? 'sha256';
  }

  /**
   * Append an event to the persistent audit log.
   * Reads the last event's hash to maintain the chain.
   */
  insert(event: Omit<AuditEventRow, 'previous_hash' | 'hash'>): AuditEventRow {
    const db = getDb();

    // Get the last event's hash for chain continuity
    const lastRow = db
      .prepare('SELECT hash FROM mcp_audit_log ORDER BY timestamp DESC LIMIT 1')
      .get() as { hash: string } | undefined;

    const previousHash = lastRow?.hash ?? null;
    const hash = this.calculateHash(event, previousHash);

    db.prepare(
      `INSERT INTO mcp_audit_log
       (id, timestamp, event_type, severity, message, actor_type, actor_id,
        actor_ip, target_type, target_id, metadata, request, response,
        previous_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.id,
      event.timestamp,
      event.event_type,
      event.severity,
      event.message,
      event.actor_type,
      event.actor_id,
      event.actor_ip ?? null,
      event.target_type ?? null,
      event.target_id ?? null,
      event.metadata ?? null,
      event.request ?? null,
      event.response ?? null,
      previousHash,
      hash
    );

    return { ...event, previous_hash: previousHash, hash };
  }

  /**
   * Query audit events with optional filters.
   */
  query(params: AuditLogQuery = {}): AuditEventRow[] {
    const db = getDb();
    const conditions: string[] = [];
    const args: unknown[] = [];

    if (params.type) {
      conditions.push('event_type = ?');
      args.push(params.type);
    }
    if (params.actorId) {
      conditions.push('actor_id = ?');
      args.push(params.actorId);
    }
    if (params.targetType) {
      conditions.push('target_type = ?');
      args.push(params.targetType);
    }
    if (params.targetId) {
      conditions.push('target_id = ?');
      args.push(params.targetId);
    }
    if (params.startDate) {
      conditions.push('timestamp >= ?');
      args.push(params.startDate.toISOString());
    }
    if (params.endDate) {
      conditions.push('timestamp <= ?');
      args.push(params.endDate.toISOString());
    }

    let sql = 'SELECT * FROM mcp_audit_log';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY timestamp DESC';

    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;
    sql += ' LIMIT ? OFFSET ?';
    args.push(limit, offset);

    return db.prepare(sql).all(...args) as AuditEventRow[];
  }

  /**
   * Count total events matching optional filters.
   */
  count(params: AuditLogQuery = {}): number {
    const db = getDb();
    const conditions: string[] = [];
    const args: unknown[] = [];

    if (params.type) {
      conditions.push('event_type = ?');
      args.push(params.type);
    }
    if (params.actorId) {
      conditions.push('actor_id = ?');
      args.push(params.actorId);
    }

    let sql = 'SELECT COUNT(*) as cnt FROM mcp_audit_log';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const row = db.prepare(sql).get(...args) as { cnt: number };
    return row.cnt;
  }

  /**
   * Verify the full hash chain integrity.
   */
  verifyIntegrity(): { valid: boolean; brokenAt?: number; totalEvents: number } {
    const db = getDb();
    const rows = db
      .prepare('SELECT id, timestamp, event_type, severity, message, actor_type, actor_id, actor_ip, target_type, target_id, previous_hash, hash FROM mcp_audit_log ORDER BY timestamp ASC')
      .all() as AuditEventRow[];

    let previousHash: string | null = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Verify chain link
      if (row.previous_hash !== previousHash) {
        return { valid: false, brokenAt: i, totalEvents: rows.length };
      }

      // Verify hash
      const expectedHash = this.calculateHash(row, previousHash);
      if (row.hash !== expectedHash) {
        return { valid: false, brokenAt: i, totalEvents: rows.length };
      }

      previousHash = row.hash;
    }

    return { valid: true, totalEvents: rows.length };
  }

  /**
   * Delete events older than retentionDays.
   */
  prune(retentionDays: number): number {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const result = db
      .prepare('DELETE FROM mcp_audit_log WHERE timestamp < ?')
      .run(cutoff.toISOString());
    return result.changes ?? 0;
  }

  /**
   * Delete all events (for testing / reset).
   */
  clear(): void {
    const db = getDb();
    db.prepare('DELETE FROM mcp_audit_log').run();
  }

  /**
   * Get statistics about the audit log.
   */
  stats(): { totalEvents: number; eventsByType: Record<string, number> } {
    const db = getDb();
    const totalRow = db
      .prepare('SELECT COUNT(*) as cnt FROM mcp_audit_log')
      .get() as { cnt: number };

    const typeRows = db
      .prepare('SELECT event_type, COUNT(*) as cnt FROM mcp_audit_log GROUP BY event_type')
      .all() as Array<{ event_type: string; cnt: number }>;

    const eventsByType: Record<string, number> = {};
    for (const r of typeRows) {
      eventsByType[r.event_type] = r.cnt;
    }

    return { totalEvents: totalRow.cnt, eventsByType };
  }

  private calculateHash(
    event: Omit<AuditEventRow, 'previous_hash' | 'hash'>,
    previousHash: string | null
  ): string {
    const data = JSON.stringify({
      id: event.id,
      timestamp: event.timestamp,
      event_type: event.event_type,
      message: event.message,
      actor: { type: event.actor_type, id: event.actor_id, ip: event.actor_ip },
      target: event.target_type
        ? { type: event.target_type, id: event.target_id }
        : undefined,
      previousHash,
    });

    return crypto.createHash(this.hashAlgorithm).update(data).digest('hex');
  }
}

// Singleton
let storeInstance: AuditLogStore | null = null;

export function getAuditLogStore(opts?: { hashAlgorithm?: 'sha256' | 'sha512' }): AuditLogStore {
  if (!storeInstance) {
    storeInstance = new AuditLogStore(opts);
  }
  return storeInstance;
}

export function resetAuditLogStore(): void {
  storeInstance = null;
}
