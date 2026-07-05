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

export class ProviderError extends DMRXError {
  constructor(
    message: string,
    public readonly providerId: string,
    statusCode: number = 502
  ) {
    super(message, 'PROVIDER_ERROR', statusCode, true, { providerId });
    this.name = 'ProviderError';
  }
}

export class AllProvidersFailedError extends DMRXError {
  constructor(public readonly providersTried: string[]) {
    super('All providers failed', 'ALL_PROVIDERS_FAILED', 502, false, { providersTried });
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
