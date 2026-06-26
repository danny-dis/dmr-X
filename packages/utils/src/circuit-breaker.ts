/**
 * Circuit breaker for resilient upstream calls.
 *
 * States:
 * - CLOSED: Normal operation, calls pass through
 * - OPEN: After consecutive failures, reject calls immediately
 * - HALF-OPEN: After timeout, allow one probe call to test recovery
 */

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Time in milliseconds to stay in open state before half-open */
  resetTimeoutMs: number;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private nextAttemptTime: number | null = null;

  constructor(private readonly options: CircuitBreakerOptions) {}

  /**
   * Checks if a call is allowed. Returns null if allowed, or an error message.
   */
  canExecute(): boolean {
    if (this.state === 'closed') return true;

    if (this.state === 'open') {
      // Check if recovery timeout has elapsed
      if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
        this.state = 'half-open';
        return true; // Allow probe call
      }
      return false;
    }

    // half-open: allow exactly one call (handled by the caller)
    return true;
  }

  /**
   * Returns the current state of the circuit breaker.
   */
  getState(): CircuitState {
    // Auto-transition from open to half-open if timeout elapsed
    if (this.state === 'open' && this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
      this.state = 'half-open';
    }
    return this.state;
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
      this.nextAttemptTime = Date.now() + this.options.resetTimeoutMs;
      return;
    }

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'open';
      this.nextAttemptTime = Date.now() + this.options.resetTimeoutMs;
    }
  }

  /**
   * Returns the current status of the circuit breaker.
   */
  getStatus(): {
    state: CircuitState;
    failureCount: number;
    lastFailureTime: number | null;
    lastSuccessTime: number | null;
    nextAttemptTime: number | null;
  } {
    // Auto-transition check
    this.getState();
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
