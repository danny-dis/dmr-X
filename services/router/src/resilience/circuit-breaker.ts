import { logger } from '@dmr-x/utils';
import { getDb } from '@dmr-x/db';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Time in ms before attempting recovery (default: 30000) */
  resetTimeoutMs: number;
  /** Number of successes in half-open state before closing (default: 3) */
  halfOpenSuccessThreshold: number;
  /** Slow request threshold in ms (default: 10000) */
  slowRequestThresholdMs: number;
  /** Percentage of slow requests to trigger circuit (default: 50) */
  slowRequestPercentage: number;
}

interface CircuitEntry {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
  lastStateChange: number;
  slowRequestCount: number;
  totalRequestCount: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenSuccessThreshold: 3,
  slowRequestThresholdMs: 10000,
  slowRequestPercentage: 50,
};

/**
 * Circuit breaker — stops hammering a provider that's failing upstream.
 * Three independent layers: provider, connection/key, model-level.
 */
export class CircuitBreaker {
  private circuits: Map<string, CircuitEntry> = new Map();
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a provider/key/model is available (circuit not open).
   */
  isAvailable(key: string): boolean {
    const entry = this.circuits.get(key);
    if (!entry) return true;

    switch (entry.state) {
      case 'closed':
        return true;

      case 'open':
        // Check if reset timeout has elapsed
        if (Date.now() - entry.lastFailureTime >= this.config.resetTimeoutMs) {
          entry.state = 'half-open';
          entry.successCount = 0;
          entry.lastStateChange = Date.now();
          logger.info({ key }, 'Circuit breaker: open → half-open');
          return true;
        }
        return false;

      case 'half-open':
        return true;

      default:
        return true;
    }
  }

  /**
   * Record a successful request.
   */
  recordSuccess(key: string): void {
    const entry = this.getOrCreate(key);
    entry.totalRequestCount++;

    if (entry.state === 'half-open') {
      entry.successCount++;
      if (entry.successCount >= this.config.halfOpenSuccessThreshold) {
        entry.state = 'closed';
        entry.failureCount = 0;
        entry.slowRequestCount = 0;
        entry.lastStateChange = Date.now();
        logger.info({ key }, 'Circuit breaker: half-open → closed');
      }
    } else if (entry.state === 'closed') {
      // Reset failure count on success
      entry.failureCount = Math.max(0, entry.failureCount - 1);
    }
  }

  /**
   * Record a failed request.
   */
  recordFailure(key: string): void {
    const entry = this.getOrCreate(key);
    entry.failureCount++;
    entry.lastFailureTime = Date.now();
    entry.totalRequestCount++;

    if (entry.state === 'half-open') {
      // Failure in half-open → back to open
      entry.state = 'open';
      entry.lastStateChange = Date.now();
      logger.warn({ key, failureCount: entry.failureCount }, 'Circuit breaker: half-open → open');
    } else if (entry.failureCount >= this.config.failureThreshold) {
      entry.state = 'open';
      entry.lastStateChange = Date.now();
      logger.warn({ key, failureCount: entry.failureCount }, 'Circuit breaker: closed → open');
    }
  }

  /**
   * Record a slow request.
   */
  recordSlowRequest(key: string, latencyMs: number): void {
    if (latencyMs < this.config.slowRequestThresholdMs) return;

    const entry = this.getOrCreate(key);
    entry.slowRequestCount++;
    entry.totalRequestCount++;

    // Check if slow request percentage exceeds threshold
    if (entry.totalRequestCount > 10) {
      const slowPercentage = (entry.slowRequestCount / entry.totalRequestCount) * 100;
      if (slowPercentage >= this.config.slowRequestPercentage) {
        entry.failureCount++;
        entry.lastFailureTime = Date.now();
        if (entry.failureCount >= this.config.failureThreshold) {
          entry.state = 'open';
          entry.lastStateChange = Date.now();
          logger.warn({ key, slowPercentage }, 'Circuit breaker: slow requests triggered open');
        }
      }
    }
  }

  /**
   * Get circuit state for display.
   */
  getState(key: string): { state: CircuitState; failureCount: number; lastStateChange: number } {
    const entry = this.circuits.get(key);
    if (!entry) {
      return { state: 'closed', failureCount: 0, lastStateChange: 0 };
    }
    return {
      state: entry.state,
      failureCount: entry.failureCount,
      lastStateChange: entry.lastStateChange,
    };
  }

  /**
   * Get all circuit states.
   */
  getAllStates(): Record<string, { state: CircuitState; failureCount: number }> {
    const result: Record<string, { state: CircuitState; failureCount: number }> = {};
    for (const [key, entry] of this.circuits) {
      result[key] = { state: entry.state, failureCount: entry.failureCount };
    }
    return result;
  }

  /**
   * Manually reset a circuit (e.g., after admin intervention).
   */
  reset(key: string): void {
    const entry = this.circuits.get(key);
    if (entry) {
      entry.state = 'closed';
      entry.failureCount = 0;
      entry.successCount = 0;
      entry.slowRequestCount = 0;
      entry.lastStateChange = Date.now();
      logger.info({ key }, 'Circuit breaker: manually reset');
    }
  }

  /**
   * Reset all circuits.
   */
  resetAll(): void {
    for (const [key] of this.circuits) {
      this.reset(key);
    }
  }

  private getOrCreate(key: string): CircuitEntry {
    let entry = this.circuits.get(key);
    if (!entry) {
      entry = {
        state: 'closed',
        failureCount: 0,
        successCount: 0,
        lastFailureTime: 0,
        lastStateChange: Date.now(),
        slowRequestCount: 0,
        totalRequestCount: 0,
      };
      this.circuits.set(key, entry);
    }
    return entry;
  }
}

// Provider-level circuit breaker
let providerBreaker: CircuitBreaker | null = null;

export function getProviderCircuitBreaker(): CircuitBreaker {
  if (!providerBreaker) {
    providerBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30000 });
  }
  return providerBreaker;
}

// Connection/key-level circuit breaker
let connectionBreaker: CircuitBreaker | null = null;

export function getConnectionCircuitBreaker(): CircuitBreaker {
  if (!connectionBreaker) {
    connectionBreaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000 });
  }
  return connectionBreaker;
}

// Model-level circuit breaker
let modelBreaker: CircuitBreaker | null = null;

export function getModelCircuitBreaker(): CircuitBreaker {
  if (!modelBreaker) {
    modelBreaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 120000 });
  }
  return modelBreaker;
}
