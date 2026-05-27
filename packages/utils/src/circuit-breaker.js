export class CircuitBreaker {
    options;
    state = 'closed';
    failures = 0;
    successes = 0;
    lastFailureTime = 0;
    constructor(options) {
        this.options = options;
    }
    getState() {
        if (this.state === 'open') {
            const elapsed = Date.now() - this.lastFailureTime;
            if (elapsed >= this.options.resetTimeoutMs) {
                this.state = 'half-open';
                this.successes = 0;
            }
        }
        return this.state;
    }
    canExecute() {
        const state = this.getState();
        return state === 'closed' || state === 'half-open';
    }
    recordSuccess() {
        if (this.state === 'half-open') {
            this.successes++;
            if (this.successes >= this.options.recoveryThreshold) {
                this.state = 'closed';
                this.failures = 0;
            }
        }
        else {
            this.failures = Math.max(0, this.failures - 1);
        }
    }
    recordFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.options.failureThreshold) {
            this.state = 'open';
        }
    }
    reset() {
        this.state = 'closed';
        this.failures = 0;
        this.successes = 0;
    }
}
//# sourceMappingURL=circuit-breaker.js.map