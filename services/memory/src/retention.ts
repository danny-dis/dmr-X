import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

export class RetentionManager {
  cleanup(): { deleted: number; errors: number } {
    const db = getDb();
    let deleted = 0;
    let errors = 0;

    try {
      const result = db.prepare(`
        DELETE FROM memory_items
        WHERE retention_days > 0
          AND datetime(created_at, '+' || retention_days || ' days') < datetime('now')
      `).run();
      deleted = result.changes;
    } catch (err) {
      logger.error({ error: String(err) }, 'Retention cleanup failed');
      errors++;
    }

    try {
      const orphaned = db.prepare(`
        DELETE FROM memory_items
        WHERE tenant_id NOT IN (SELECT id FROM tenants)
      `).run();
      deleted += orphaned.changes;
    } catch (err) {
      logger.error({ error: String(err) }, 'Orphan cleanup failed');
      errors++;
    }

    if (deleted > 0) {
      logger.info(`Memory retention: cleaned ${deleted} items`);
    }

    return { deleted, errors };
  }

  getStats(): { total: number; byNamespace: Record<string, number>; expired: number } {
    const db = getDb();

    const total = (db.prepare('SELECT COUNT(*) as count FROM memory_items').get() as any).count;

    const namespaceRows = db.prepare(`
      SELECT namespace, COUNT(*) as count FROM memory_items GROUP BY namespace
    `).all() as any[];
    const byNamespace: Record<string, number> = {};
    for (const row of namespaceRows) {
      byNamespace[row.namespace] = row.count;
    }

    const expired = (db.prepare(`
      SELECT COUNT(*) as count FROM memory_items
      WHERE retention_days > 0
        AND datetime(created_at, '+' || retention_days || ' days') < datetime('now')
    `).get() as any).count;

    return { total, byNamespace, expired };
  }
}

export const retentionManager = new RetentionManager();
