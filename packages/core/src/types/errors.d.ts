export declare class DMRXError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly isRetryable: boolean;
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, code: string, statusCode?: number, isRetryable?: boolean, details?: Record<string, unknown> | undefined);
}
export declare class ValidationError extends DMRXError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class AuthenticationError extends DMRXError {
    constructor(message?: string);
}
export declare class RateLimitError extends DMRXError {
    constructor(retryAfterMs?: number);
}
export declare class QuotaExhaustedError extends DMRXError {
    constructor();
}
export declare class ProviderError extends DMRXError {
    readonly providerId: string;
    constructor(message: string, providerId: string, statusCode?: number);
}
export declare class AllProvidersFailedError extends DMRXError {
    readonly providersTried: string[];
    constructor(providersTried: string[]);
}
export declare class ProviderUnavailableError extends DMRXError {
    readonly providersTried: string[];
    readonly retryAfter: number;
    constructor(providersTried: string[], retryAfter?: number);
}
//# sourceMappingURL=errors.d.ts.map