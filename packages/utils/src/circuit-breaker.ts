export interface CircuitBreakerOptions {
  failureThreshold: number;
  recoveryThreshold: number;
  resetTimeoutMs: number;
}

type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private halfOpenProbeUsed = false;

  constructor(private readonly options: CircuitBreakerOptions) {}

  getState(): CircuitState {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.options.resetTimeoutMs) {
        this.state = 'half-open';
        this.successes = 0;
        this.halfOpenProbeUsed = false;
      }
    }
    return this.state;
  }

  canExecute(): boolean {
    const state = this.getState();
    if (state === 'closed') return true;
    if (state === 'half-open' && !this.halfOpenProbeUsed) {
      this.halfOpenProbeUsed = true;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.options.recoveryThreshold) {
        this.state = 'closed';
        this.failures = 0;
      }
    } else {
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.options.failureThreshold) {
      this.state = 'open';
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
  }
}
