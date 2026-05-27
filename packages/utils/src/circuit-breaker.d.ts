export interface CircuitBreakerOptions {
    failureThreshold: number;
    recoveryThreshold: number;
    resetTimeoutMs: number;
}
type CircuitState = 'closed' | 'open' | 'half-open';
export declare class CircuitBreaker {
    private readonly options;
    private state;
    private failures;
    private successes;
    private lastFailureTime;
    constructor(options: CircuitBreakerOptions);
    getState(): CircuitState;
    canExecute(): boolean;
    recordSuccess(): void;
    recordFailure(): void;
    reset(): void;
}
export {};
//# sourceMappingURL=circuit-breaker.d.ts.map