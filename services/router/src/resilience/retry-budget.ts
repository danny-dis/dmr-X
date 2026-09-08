export interface RetryBudgetConfig {
  maxRetries: number;
  windowMs: number;
}

export class RetryBudget {
  private retries = new Map<string, number[]>();

  constructor(private config: RetryBudgetConfig) {}

  canRetry(requestId: string): boolean {
    const now = Date.now();
    const attempts = this.retries.get(requestId) ?? [];
    const recent = attempts.filter(t => now - t < this.config.windowMs);
    this.retries.set(requestId, recent);
    return recent.length < this.config.maxRetries;
  }

  recordRetry(requestId: string): void {
    const attempts = this.retries.get(requestId) ?? [];
    attempts.push(Date.now());
    this.retries.set(requestId, attempts);
  }

  getRemaining(requestId: string): number {
    const now = Date.now();
    const attempts = this.retries.get(requestId) ?? [];
    const recent = attempts.filter(t => now - t < this.config.windowMs);
    return Math.max(0, this.config.maxRetries - recent.length);
  }
}