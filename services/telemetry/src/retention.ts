import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

/**
 * Data retention service — prunes old records from hot-path tables that
 * would otherwise grow unbounded (O5).
 *
 * Tables affected:
 * - request_logs (telemetry-hooks.ts)
 * - usage_records (billing/usage-tracker.ts)
 * - messages (conversation.routes.ts)
 * - admin_audit_log (admin.routes.ts)
 *
 * The retention period is controlled by DMRX_DATA_RETENTION_DAYS (default: 30).
 * Set to 0 to disable pruning.
 */
export class RetentionService {
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Prune records older than the configured retention period.
   * Returns the number of rows deleted per table.
   */
  prune(): Record<string, number> {
    const retentionDays = parseInt(process.env.DMRX_DATA_RETENTION_DAYS || '30', 10);
    if (retentionDays <= 0) {
      return {};
    }

    const db = getDb();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);

    const results: Record<string, number> = {};

    const tables = [
      { name: 'request_logs', column: 'created_at' },
      { name: 'usage_records', column: 'created_at' },
      { name: 'messages', column: 'created_at' },
      { name: 'admin_audit_log', column: 'created_at' },
    ];

    for (const { name, column } of tables) {
      try {
        const result = db.prepare(`DELETE FROM ${name} WHERE ${column} < ?`).run(cutoff);
        results[name] = result.changes;
      } catch (err) {
        // Table may not exist in all deployments — skip silently
        logger.debug({ table: name, err }, `Retention prune skipped for ${name}`);
      }
    }

    const total = Object.values(results).reduce((a, b) => a + b, 0);
    if (total > 0) {
      logger.info({ results, total, cutoff }, 'Retention prune completed');
    }

    return results;
  }

  /**
   * Start the retention timer — prunes every hour.
   */
  start(): void {
    if (this.timer) return;
    // Run immediately on start, then every hour
    this.prune();
    this.timer = setInterval(() => {
      try {
        this.prune();
      } catch (err) {
        logger.warn({ err }, 'Retention prune failed');
      }
    }, 60 * 60 * 1000);
    logger.info('Retention service started');
  }

  /**
   * Stop the retention timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Retention service stopped');
    }
  }
}

export const retentionService = new RetentionService();
