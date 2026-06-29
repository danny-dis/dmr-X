import type { AdapterRegistry } from '@dmr-x/adapters';
import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

import { registryService } from './registry.service.js';

const CONSECUTIVE_FAILURES_TO_DISABLE = 3;

// Track consecutive failures per provider
const failureCount = new Map<string, number>();

// Distinguish transport errors from auth errors
function isAuthError(error: string | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('invalid api key') || lower.includes('authentication');
}

function isTransportError(error: string | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes('timeout') || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('dns') || lower.includes('network') || lower.includes('fetch') || lower.includes('tls') || lower.includes('ssl');
}

export class HealthChecker {
  private interval: ReturnType<typeof setInterval> | null = null;
  private providerIdMap = new Map<string, string>(); // adapter ID -> DB UUID

  constructor(
    private adapterRegistry: AdapterRegistry,
    private checkIntervalMs: number = 30000
  ) {}

  start(): void {
    logger.info({ intervalMs: this.checkIntervalMs }, 'Health checker started');

    // Run immediately
    this.checkAll();

    // Then run on interval
    this.interval = setInterval(() => {
      this.checkAll();
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info('Health checker stopped');
  }

  private loadProviderIdMap(): void {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT id, name FROM providers').all();
      for (const row of rows as any[]) {
        this.providerIdMap.set(row.name.toLowerCase(), row.id);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load provider ID map');
    }
  }

  private getProviderUuid(adapterId: string): string | null {
    // Try to find by name (case-insensitive)
    const uuid = this.providerIdMap.get(adapterId.toLowerCase());
    if (uuid) return uuid;

    // If not found, reload the map and try again
    this.loadProviderIdMap();
    return this.providerIdMap.get(adapterId.toLowerCase()) || null;
  }

  private async checkAll(): Promise<void> {
    // Ensure we have the provider ID mapping
    if (this.providerIdMap.size === 0) {
      this.loadProviderIdMap();
    }

    const adapters = this.adapterRegistry.list();

    for (const adapterId of adapters) {
      try {
        // Bypass the circuit-breaker guard: health checks must run on
        // providers whose breakers have tripped so we can observe
        // recovery. Gating them through `get()` would mean a tripped
        // breaker can never heal, and a single transient failure could
        // turn into a permanent outage.
        const adapter = this.adapterRegistry.peek(adapterId);
        if (!adapter) continue;

        const providerUuid = this.getProviderUuid(adapterId);
        if (!providerUuid) {
          logger.warn({ adapterId }, 'Provider not found in database, skipping health check');
          continue;
        }

        const status = await adapter.healthCheck();

        // "Adapter not initialized" is an expected, non-failure state — the
        // user simply hasn't set an API key for this provider yet. Don't
        // poison the circuit breaker (it would block every request once
        // failureThreshold is hit) and don't bump `consecutive_failures`
        // in the DB (it would flip `is_healthy` to 0 and remove the
        // provider from the candidate set the moment the user *does* add
        // a key). Just record the timestamp so the admin UI can show
        // when it was last seen.
        if (status.error === 'Adapter not initialized') {
          registryService.touchHealthCheck(providerUuid);
          continue;
        }

        registryService.updateHealth(providerUuid, status.healthy, status.latencyMs);

        // Sync circuit breaker state with health check result
        if (status.healthy) {
          this.adapterRegistry.recordSuccess(adapterId);
          // Clear failure count on success
          failureCount.delete(adapterId);
        } else {
          this.adapterRegistry.recordFailure(adapterId);

          // Distinguish transport errors from auth errors
          if (isTransportError(status.error)) {
            // Transport errors (DNS/timeout/TLS) — don't increment failure count
            // These are transient and shouldn't disable the key
            logger.warn(
              { adapterId, providerUuid, error: status.error },
              'Provider transport error (not incrementing failure count)'
            );
          } else if (isAuthError(status.error)) {
            // Auth errors (401/403) — increment failure count
            const count = (failureCount.get(adapterId) ?? 0) + 1;
            failureCount.set(adapterId, count);
            logger.warn(
              { adapterId, providerUuid, error: status.error, failureCount: count },
              'Provider auth error'
            );

            // Auto-disable after consecutive failures
            if (count >= CONSECUTIVE_FAILURES_TO_DISABLE) {
              logger.warn(
                { adapterId, providerUuid, failureCount: count },
                'Auto-disabling provider after consecutive auth failures'
              );
              this.disableProvider(providerUuid);
            }
          } else {
            // Unknown error type — increment failure count as precaution
            const count = (failureCount.get(adapterId) ?? 0) + 1;
            failureCount.set(adapterId, count);
            logger.warn(
              { adapterId, providerUuid, error: status.error, failureCount: count },
              'Provider unhealthy'
            );

            if (count >= CONSECUTIVE_FAILURES_TO_DISABLE) {
              logger.warn(
                { adapterId, providerUuid, failureCount: count },
                'Auto-disabling provider after consecutive failures'
              );
              this.disableProvider(providerUuid);
            }
          }
        }
      } catch (error) {
        logger.error({ err: error, adapterId }, 'Health check failed');
        // Record circuit breaker failure on exception
        this.adapterRegistry.recordFailure(adapterId);
        const providerUuid = this.getProviderUuid(adapterId);
        if (providerUuid) {
          registryService.updateHealth(providerUuid, false);
          // Increment failure count on exception
          const count = (failureCount.get(adapterId) ?? 0) + 1;
          failureCount.set(adapterId, count);
          if (count >= CONSECUTIVE_FAILURES_TO_DISABLE) {
            this.disableProvider(providerUuid);
          }
        }
      }
    }
  }

  /**
   * Disable a provider in the database.
   */
  private disableProvider(providerUuid: string): void {
    try {
      const db = getDb();
      db.prepare('UPDATE providers SET enabled = 0 WHERE id = ?').run(providerUuid);
      logger.warn({ providerUuid }, 'Provider auto-disabled due to consecutive failures');
    } catch (error) {
      logger.error({ err: error, providerUuid }, 'Failed to auto-disable provider');
    }
  }

  /**
   * Re-enable a provider (called when a successful request comes through).
   */
  static reEnableProvider(adapterId: string): void {
    failureCount.delete(adapterId);
  }
}
