import { logger } from '@dmr-x/utils';
import { getDb } from '@dmr-x/db';

export interface HealthCheckResult {
  providerId: string;
  isHealthy: boolean;
  latencyMs: number;
  lastChecked: Date;
  error?: string;
}

export interface HealthCheckConfig {
  /** Check interval in ms (default: 5 minutes) */
  intervalMs: number;
  /** Request timeout in ms (default: 10 seconds) */
  timeoutMs: number;
  /** Number of consecutive failures before marking unhealthy (default: 3) */
  failureThreshold: number;
  /** Number of consecutive successes before marking healthy again (default: 1) */
  recoveryThreshold: number;
}

const DEFAULT_CONFIG: HealthCheckConfig = {
  intervalMs: 5 * 60 * 1000,  // 5 minutes
  timeoutMs: 10 * 1000,  // 10 seconds
  failureThreshold: 3,
  recoveryThreshold: 1,
};

export class HealthChecker {
  private config: HealthCheckConfig;
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private failureCounts: Map<string, number> = new Map();
  private successCounts: Map<string, number> = new Map();

  constructor(config?: Partial<HealthCheckConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  startProviderCheck(providerId: string, checkFn: () => Promise<boolean>): void {
    if (this.timers.has(providerId)) {
      return;  // Already monitoring
    }

    const timer = setInterval(async () => {
      await this.checkProvider(providerId, checkFn);
    }, this.config.intervalMs);

    this.timers.set(providerId, timer);

    // Run initial check
    this.checkProvider(providerId, checkFn).catch(err => {
      logger.warn({ err, providerId }, 'Initial health check failed');
    });
  }

  stopProviderCheck(providerId: string): void {
    const timer = this.timers.get(providerId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(providerId);
    }
    this.failureCounts.delete(providerId);
    this.successCounts.delete(providerId);
  }

  stopAll(): void {
    for (const [providerId] of this.timers) {
      this.stopProviderCheck(providerId);
    }
  }

  getProviderHealth(providerId: string): { isHealthy: boolean; lastChecked: Date | null; failureCount: number } {
    const db = getDb();
    const row = db.prepare(`
      SELECT is_healthy, updated_at, consecutive_failures
      FROM providers
      WHERE id = ?
    `).get(providerId) as any;

    return {
      isHealthy: row?.is_healthy === 1,
      lastChecked: row?.updated_at ? new Date(row.updated_at) : null,
      failureCount: row?.consecutive_failures ?? 0,
    };
  }

  getAllProviderHealth(): HealthCheckResult[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id as providerId, is_healthy, updated_at, consecutive_failures
      FROM providers
    `).all() as any[];

    return rows.map(row => ({
      providerId: row.providerId,
      isHealthy: row.is_healthy === 1,
      latencyMs: 0,
      lastChecked: row.updated_at ? new Date(row.updated_at) : new Date(),
      error: row.consecutive_failures > 0 ? `Consecutive failures: ${row.consecutive_failures}` : undefined,
    }));
  }

  private async checkProvider(providerId: string, checkFn: () => Promise<boolean>): Promise<void> {
    const startTime = Date.now();

    try {
      const isHealthy = await Promise.race([
        checkFn(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), this.config.timeoutMs)
        ),
      ]);

      const latencyMs = Date.now() - startTime;

      if (isHealthy) {
        this.handleSuccess(providerId, latencyMs);
      } else {
        this.handleFailure(providerId, 'Health check returned false');
      }
    } catch (err) {
      // A thrown/rejected probe (timeout, TLS blip, DNS hiccup, transient
      // network error) is UNKNOWN — NOT proof the provider is dead. Treating
      // it as a failure lets a concurrent health-check sweep (dozens of
      // providers probed at once) poison otherwise-reachable providers via
      // the failureThreshold, collapsing the candidate pool down to one or
      // two survivors and forcing all `auto` traffic onto a single backend.
      // Only a *definitive* false (revoked key / 401-403 from the probe)
      // should mark a provider unhealthy. Genuinely-dead providers are still
      // caught at request time by the router's circuit breaker + fallback
      // chain, so skipping the poison here does not hide outages — it just
      // stops transient blips from starving the pool.
      const latencyMs = Date.now() - startTime;
      logger.debug(
        { providerId, latencyMs, err: err instanceof Error ? err.message : 'Unknown error' },
        'Health check probe errored (unknown — not marking unhealthy)',
      );
    }
  }

  private handleSuccess(providerId: string, latencyMs: number): void {
    this.failureCounts.set(providerId, 0);
    const successCount = (this.successCounts.get(providerId) ?? 0) + 1;
    this.successCounts.set(providerId, successCount);

    if (successCount >= this.config.recoveryThreshold) {
      this.updateProviderHealth(providerId, true);
    }

    logger.debug({ providerId, latencyMs }, 'Health check passed');
  }

  private handleFailure(providerId: string, error: string): void {
    this.successCounts.set(providerId, 0);
    const failureCount = (this.failureCounts.get(providerId) ?? 0) + 1;
    this.failureCounts.set(providerId, failureCount);

    if (failureCount >= this.config.failureThreshold) {
      this.updateProviderHealth(providerId, false);
      logger.warn({ providerId, failureCount, error }, 'Provider marked unhealthy');
    } else {
      logger.debug({ providerId, failureCount, error }, 'Health check failed (below threshold)');
    }
  }

  private updateProviderHealth(providerId: string, isHealthy: boolean): void {
    try {
      const db = getDb();
      if (isHealthy) {
        // Recovery: persist healthy state so the DB-backed candidate pool
        // (registry getCandidates() filters is_healthy=1) reflects reachability.
        db.prepare(`
          UPDATE providers
          SET is_healthy = 1,
              consecutive_failures = 0,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(providerId);
      } else {
        // Failure: persist unhealthy so the DB-backed candidate pool
        // (registry getCandidates() filters is_healthy=1) stops routing to
        // genuinely-broken providers. The in-memory circuit breaker + periodic
        // health re-checks self-heal transient failures (e.g. rate-limit 429s)
        // by flipping is_healthy back to 1 on recovery.
        db.prepare(`
          UPDATE providers
          SET is_healthy = 0,
              consecutive_failures = consecutive_failures + 1,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(providerId);
      }
    } catch (err) {
      logger.warn({ err, providerId }, 'Failed to update provider health');
    }
  }
}

// Singleton instance
let instance: HealthChecker | null = null;

export function getHealthChecker(): HealthChecker {
  if (!instance) {
    instance = new HealthChecker();
  }
  return instance;
}
