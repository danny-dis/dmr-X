/**
 * Circuit breaker for upstream MCP server connections.
 *
 * States:
 * - CLOSED: Normal operation, calls pass through
 * - OPEN: After consecutive failures, reject calls immediately
 * - HALF-OPEN: After timeout, allow one probe call
 *
 * Configuration via env vars:
 *   DMRX_MCP_CIRCUIT_BREAKER_THRESHOLD — failures before opening (default: 5)
 *   DMRX_MCP_CIRCUIT_BREAKER_TIMEOUT_MS — time in open state (default: 60000)
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Time in milliseconds to stay in open state before half-open */
  recoveryTimeoutMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: parseInt(process.env.DMRX_MCP_CIRCUIT_BREAKER_THRESHOLD || '5', 10),
  recoveryTimeoutMs: parseInt(process.env.DMRX_MCP_CIRCUIT_BREAKER_TIMEOUT_MS || '60000', 10),
};

export interface CircuitBreakerStatus {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  nextAttemptTime: number | null;
}

/**
 * Per-server circuit breaker instance.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private nextAttemptTime: number | null = null;
  private readonly config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Checks if a call is allowed. Returns null if allowed, or an error message.
   */
  check(serverId: string): string | null {
    if (this.state === 'closed') return null;

    if (this.state === 'open') {
      // Check if recovery timeout has elapsed
      if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
        this.state = 'half-open';
        return null; // Allow probe call
      }
      return `Circuit breaker OPEN for ${serverId} — retry after ${Math.ceil(((this.nextAttemptTime ?? 0) - Date.now()) / 1000)}s`;
    }

    // half-open: allow exactly one call (handled by the caller)
    return null;
  }

  /**
   * Records a successful call. Resets the circuit if in half-open state.
   */
  recordSuccess(): void {
    this.failureCount = 0;
    this.lastSuccessTime = Date.now();
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.nextAttemptTime = null;
    }
  }

  /**
   * Records a failed call. Opens the circuit if threshold is reached.
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Probe failed — reopen the circuit
      this.state = 'open';
      this.nextAttemptTime = Date.now() + this.config.recoveryTimeoutMs;
      return;
    }

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
      this.nextAttemptTime = Date.now() + this.config.recoveryTimeoutMs;
    }
  }

  /**
   * Returns the current status of the circuit breaker.
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * Forces the circuit to closed state (manual reset).
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }
}

/**
 * Manages circuit breakers for multiple upstream MCP servers.
 */
export class CircuitBreakerManager {
  private breakers = new Map<string, CircuitBreaker>();

  getOrCreate(serverId: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    let breaker = this.breakers.get(serverId);
    if (!breaker) {
      breaker = new CircuitBreaker(config);
      this.breakers.set(serverId, breaker);
    }
    return breaker;
  }

  getStatus(): Record<string, CircuitBreakerStatus> {
    const status: Record<string, CircuitBreakerStatus> = {};
    for (const [id, breaker] of this.breakers) {
      status[id] = breaker.getStatus();
    }
    return status;
  }

  reset(serverId: string): void {
    this.breakers.get(serverId)?.reset();
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}
