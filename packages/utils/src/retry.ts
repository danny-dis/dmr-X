import { isConnectionError, isTimeoutError } from './error-classifiers.js';

export interface BackoffStrategy {
  initialInterval: number;
  maxInterval: number;
  exponent: number;
  maxElapsedTime: number;
}

const defaultBackoff: BackoffStrategy = {
  initialInterval: 500,
  maxInterval: 60000,
  exponent: 1.5,
  maxElapsedTime: 3600000,
};

export type RetryConfig =
  | { strategy: 'none' }
  | {
      strategy: 'backoff';
      backoff?: BackoffStrategy;
      retryConnectionErrors?: boolean;
    };

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: (error: unknown) => boolean;
  /** If set, use the structured config instead of the flat options. */
  config?: RetryConfig;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: () => true,
};

/**
 * Error that is not recoverable. Throwing this terminates the retry loop.
 */
export class PermanentError extends Error {
  override readonly cause: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    let msg = message;
    if (options?.cause) {
      msg += `: ${options.cause}`;
    }
    super(msg, options);
    this.name = 'PermanentError';
    if (typeof this.cause === 'undefined') {
      this.cause = options?.cause;
    }
    Object.setPrototypeOf(this, PermanentError.prototype);
  }
}

/**
 * Error that signals the request can be retried.
 */
export class TemporaryError extends Error {
  response: Response;

  constructor(message: string, response: Response) {
    super(message);
    this.response = response;
    this.name = 'TemporaryError';
    Object.setPrototypeOf(this, TemporaryError.prototype);
  }
}

/**
 * Parse the retry-after header value.
 * Supports both numeric seconds and HTTP-date format.
 */
export function parseRetryAfter(response: Response): number | null {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) return Math.max(seconds * 1000, 0);

  // HTTP-date format
  const date = new Date(retryAfter);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(date.getTime() - Date.now(), 0);
  }

  return null;
}

/**
 * Exponential backoff retry with jitter.
 *
 * Supports two modes:
 * 1. Simple mode: pass flat RetryOptions
 * 2. Config mode: pass config with BackoffStrategy
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  // If using structured config mode
  if (opts.config?.strategy === 'none') {
    return fn();
  }

  const backoff = opts.config?.strategy === 'backoff'
    ? (opts.config.backoff ?? defaultBackoff)
    : null;

  const maxAttempts = backoff
    ? Math.ceil(
        Math.log(backoff.maxInterval / backoff.initialInterval) /
          Math.log(backoff.exponent),
      ) + 1
    : opts.maxAttempts;

  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Permanent errors are never retried
      if (error instanceof PermanentError) {
        throw error;
      }

      // Check if error is retryable
      if (!opts.retryableErrors?.(error)) {
        throw error;
      }

      // Check connection error retry policy
      if (
        opts.config?.strategy === 'backoff' &&
        opts.config.retryConnectionErrors === false &&
        isConnectionError(error)
      ) {
        throw error;
      }

      // Check max elapsed time for backoff config
      if (backoff) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= backoff.maxElapsedTime) {
          throw error;
        }
      }

      // Calculate delay
      let delay: number;
      if (backoff) {
        delay = Math.min(
          backoff.initialInterval * Math.pow(backoff.exponent, attempt - 1),
          backoff.maxInterval,
        );
      } else {
        if (attempt === opts.maxAttempts) {
          throw error;
        }
        delay = Math.min(
          opts.baseDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1),
          opts.maxDelayMs,
        );
      }

      // Check for retry-after header on TemporaryError
      if (error instanceof TemporaryError) {
        const retryAfterMs = parseRetryAfter(error.response);
        if (retryAfterMs !== null) {
          delay = Math.max(delay, retryAfterMs);
        }
      }

      // Add jitter (0-25% of delay)
      const jitter = delay * 0.25 * Math.random();
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
  throw lastError;
}
