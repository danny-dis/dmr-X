export class DMRXError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly isRetryable: boolean = false,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DMRXError';
  }
}

export class ValidationError extends DMRXError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, false, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends DMRXError {
  constructor(message: string = 'Invalid API key') {
    super(message, 'AUTHENTICATION_ERROR', 401, false);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends DMRXError {
  constructor(retryAfterMs: number = 1000) {
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

/**
 * Transport/upstream statuses worth another attempt. Mirrors
 * RETRYABLE_STATUS_CODES in services/adapters/src/base.adapter.ts, which is
 * what actually drives the retry loop; this keeps the flag on the error
 * object truthful for anything that reads or serialises it.
 */
const RETRYABLE_PROVIDER_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class ProviderError extends DMRXError {
  constructor(
    message: string,
    public readonly providerId: string,
    statusCode: number = 502,
    isRetryable: boolean = RETRYABLE_PROVIDER_STATUSES.has(statusCode)
  ) {
    super(message, 'PROVIDER_ERROR', statusCode, isRetryable, { providerId });
    this.name = 'ProviderError';
  }
}

export interface TriedProviderError {
  provider: string;
  status?: number;
  message: string;
}

export class AllProvidersFailedError extends DMRXError {
  public readonly triedErrors: TriedProviderError[];

  constructor(
    providersTried: string[],
    triedErrors?: TriedProviderError[]
  ) {
    const errors = triedErrors && triedErrors.length > 0 ? triedErrors : undefined;
    // Surface the most informative underlying error in dev_message so
    // local/dev callers can see WHY routing failed (e.g. HTTP 401 from
    // cohere) instead of just "All providers failed".
    const devMessage = errors
      ? errors
          .map((e) => `${e.provider}${e.status ? ` (HTTP ${e.status})` : ''}: ${e.message}`)
          .join('; ')
      : undefined;
    super('All providers failed', 'ALL_PROVIDERS_FAILED', 502, false, {
      providersTried,
      triedErrors: errors,
      dev_message: devMessage,
    });
    this.triedErrors = errors ?? providersTried.map((p) => ({ provider: p, message: 'no error captured' }));
    this.name = 'AllProvidersFailedError';
  }
}

export class ProviderUnavailableError extends DMRXError {
  constructor(
    public readonly providersTried: string[],
    public readonly retryAfter: number = 30
  ) {
    super(
      'All providers currently unavailable',
      'PROVIDER_UNAVAILABLE',
      503,
      true,
      { providersTried, retryAfter }
    );
    this.name = 'ProviderUnavailableError';
  }
}
