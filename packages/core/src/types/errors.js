export class DMRXError extends Error {
    code;
    statusCode;
    isRetryable;
    details;
    constructor(message, code, statusCode = 500, isRetryable = false, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.isRetryable = isRetryable;
        this.details = details;
        this.name = 'DMRXError';
    }
}
export class ValidationError extends DMRXError {
    constructor(message, details) {
        super(message, 'VALIDATION_ERROR', 400, false, details);
        this.name = 'ValidationError';
    }
}
export class AuthenticationError extends DMRXError {
    constructor(message = 'Invalid API key') {
        super(message, 'AUTHENTICATION_ERROR', 401, false);
        this.name = 'AuthenticationError';
    }
}
export class RateLimitError extends DMRXError {
    constructor(retryAfterMs = 1000) {
        super('Rate limit exceeded', 'RATE_LIMIT_ERROR', 429, true, { retryAfterMs });
        this.name = 'RateLimitError';
    }
}
export class QuotaExhaustedError extends DMRXError {
    constructor() {
        super('Quota exhausted', 'QUOTA_EXHAUSTED', 402, false);
        this.name = 'QuotaExhaustedError';
    }
}
export class ProviderError extends DMRXError {
    providerId;
    constructor(message, providerId, statusCode = 502) {
        super(message, 'PROVIDER_ERROR', statusCode, true, { providerId });
        this.providerId = providerId;
        this.name = 'ProviderError';
    }
}
export class AllProvidersFailedError extends DMRXError {
    providersTried;
    constructor(providersTried) {
        super('All providers failed', 'ALL_PROVIDERS_FAILED', 502, false, { providersTried });
        this.providersTried = providersTried;
        this.name = 'AllProvidersFailedError';
    }
}
export class ProviderUnavailableError extends DMRXError {
    providersTried;
    retryAfter;
    constructor(providersTried, retryAfter = 30) {
        super('All providers currently unavailable', 'PROVIDER_UNAVAILABLE', 503, true, { providersTried, retryAfter });
        this.providersTried = providersTried;
        this.retryAfter = retryAfter;
        this.name = 'ProviderUnavailableError';
    }
}
//# sourceMappingURL=errors.js.map