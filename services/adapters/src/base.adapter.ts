import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import {
  logger,
  DefaultHttpHooks,
  type BeforeRequestHook,
  type AfterSuccessHook,
  type AfterErrorHook,
  createHttpError,
  HttpError,
  withRetry,
  TemporaryError,
  PermanentError,
  isConnectionError,
  isTimeoutError,
  isAbortError,
  type RetryConfig,
  ConnectionError,
  ClientTimeoutError,
  match,
  type Result,
} from '@dmr-x/utils';
import { trace, SpanStatusCode, SpanKind, propagation, context } from '@opentelemetry/api';
import { getRateLimitTracker, supportsRateLimitHeaders } from '@dmr-x/quota';

import type {
  ProviderAdapter,
  ProviderConfig,
  HealthStatus,
  ModelInfo,
  ExecuteOptions,
} from './adapter.interface.js';

// All adapters share a single tracer instance (see services/telemetry/src/tracer.ts).
// `adapter.fetch` spans get the active gateway request as their parent
// because they are called from `router.execute`, which runs inside the
// `http.request` span started in apps/gateway/src/server.ts.
const tracer = trace.getTracer('dmr-x-gateway', '0.4.0');

/**
 * HTTP status codes that trigger automatic retry.
 * 429 = Too Many Requests (rate limiting)
 * 502 = Bad Gateway (upstream failure)
 * 503 = Service Unavailable (transient outage)
 * 504 = Gateway Timeout (upstream timeout)
 */
const RETRYABLE_STATUS_CODES = ['429', '502', '503', '504'];

export abstract class BaseAdapter implements ProviderAdapter {
  abstract readonly providerId: string;
  abstract readonly supportedModalities: Modality[];

  protected config: ProviderConfig = { baseUrl: '' };
  protected initialized = false;
  protected readonly hooks: DefaultHttpHooks = new DefaultHttpHooks();

  /**
   * Retry configuration for all HTTP requests made by this adapter.
   *
   * Defaults to exponential backoff: 1 s initial delay, 2x exponent, 10 s max
   * interval, 30 s total budget. Retries on HTTP 429/502/503/504, connection
   * errors (ECONNRESET, "fetch failed"), and timeout errors.  Respects
   * Retry-After headers when present.
   *
   * Subclasses can override this to customise retry behaviour.
   * Set to `{ strategy: 'none' }` to disable retries entirely.
   */
  protected retryConfig: RetryConfig = {
    strategy: 'backoff',
    backoff: {
      initialInterval: 1000,
      maxInterval: 10000,
      exponent: 2,
      maxElapsedTime: 30000,
    },
    retryConnectionErrors: true,
  };

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
    // Auto-enable rate limit tracking for adapters with API keys
    if (config.apiKey) {
      this.enableRateLimitTracking();
    }
    logger.info({ providerId: this.providerId }, 'Adapter initialized');
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.initialized) {
      return { healthy: false, latencyMs: 0, error: 'Adapter not initialized' };
    }
    const start = Date.now();
    try {
      await this.checkHealth();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  protected abstract checkHealth(): Promise<void>;

  abstract execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse>;
  abstract executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk>;
  abstract listModels(): Promise<ModelInfo[]>;

  async dispose(): Promise<void> {
    this.initialized = false;
    logger.info({ providerId: this.providerId }, 'Adapter disposed');
  }

  protected assertInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Adapter ${this.providerId} not initialized`);
    }
  }

  /**
   * Standardized error handler for adapter execute methods.
   * Converts transport-level errors (connection, timeout, HTTP) into
   * ProviderError instances with appropriate status codes.
   *
   * Usage in subclass execute() methods:
   *   try { ... } catch (err) { throw this.handleAdapterError(err); }
   *
   * @param error - The caught error
   * @param context - Optional context string (e.g., "stream", "embedding") for error messages
   * @returns ProviderError for transport errors, or re-throws the original error
   */
  protected handleAdapterError(error: unknown, context?: string): ProviderError | never {
    if (error instanceof ProviderError) throw error;

    const prefix = context ? `${this.providerId} ${context}` : this.providerId;

    if (error instanceof HttpError) {
      const providerError = new ProviderError(
        `${prefix}: ${error.message}`,
        this.providerId,
        error.statusCode,
      );
      (providerError as Error).cause = error;
      throw providerError;
    }

    if (error instanceof ConnectionError || isConnectionError(error)) {
      throw new ProviderError(
        `${prefix}: Connection failed - ${error instanceof Error ? error.message : String(error)}`,
        this.providerId,
        502,
      );
    }

    if (error instanceof ClientTimeoutError || isTimeoutError(error) || isAbortError(error)) {
      throw new ProviderError(`${prefix}: Request timed out`, this.providerId, 504);
    }

    throw error;
  }

  /**
   * Register a hook to run before each HTTP request.
   * Use for adding headers, tracing, request IDs, etc.
   */
  onBeforeRequest(hook: BeforeRequestHook): void {
    this.hooks.registerBeforeRequest(hook);
  }

  /**
   * Register a hook to run after a successful HTTP response.
   * Use for logging, metrics, response transformation.
   */
  onAfterSuccess(hook: AfterSuccessHook): void {
    this.hooks.registerAfterSuccess(hook);
  }

  /**
   * Register a hook to run after an HTTP error.
   * Use for error logging, retry decisions, error transformation.
   */
  onAfterError(hook: AfterErrorHook): void {
    this.hooks.registerAfterError(hook);
  }

  /**
   * Enable automatic rate limit tracking for this adapter.
   * Extracts X-RateLimit-* headers from successful responses and stores
   * them for smart key rotation and quota-aware routing.
   */
  enableRateLimitTracking(): void {
    if (!supportsRateLimitHeaders(this.providerId)) {
      logger.debug({ providerId: this.providerId }, 'Provider does not support rate limit headers');
      return;
    }

    this.hooks.registerAfterSuccess(async (ctx, response) => {
      // Only track for API key requests (not OAuth tokens)
      if (this.config.apiKey) {
        try {
          const tracker = getRateLimitTracker();
          tracker.trackResponse({
            keyId: this.config.apiKey,
            providerId: this.providerId,
            response,
          });
        } catch (error) {
          // Non-critical, just log
          logger.debug({ error, providerId: this.providerId }, 'Failed to track rate limits');
        }
      }
      return response;
    });

    logger.info({ providerId: this.providerId }, 'Rate limit tracking enabled');
  }

  /**
   * Get the underlying hooks instance for external registration.
   * Used by the gateway to inject telemetry hooks into adapters.
   */
  getHooks(): DefaultHttpHooks {
    return this.hooks;
  }

  /**
   * Declarative response matching with typed success/error extraction.
   * Use in adapter execute() methods for validated response parsing.
   */
  protected async matchResponse<T = unknown, E = unknown>(
    response: Response,
    request: Request,
    ...matchers: Parameters<typeof match>
  ): Promise<[Result<T, E>, Response]> {
    return match(...matchers)(response, request) as Promise<[Result<T, E>, Response]>;
  }

  /**
   * Raw HTTP fetch with timeout, hooks, and typed error handling.
   * Single attempt -- no retry logic. Used internally by fetchWithTimeout.
   *
   * Wraps the outgoing HTTP request in an `adapter.fetch` OTel span so
   * the parent gateway trace shows every upstream provider call as a
   * child span with timing, status code, and host attributes.
   *
   * Throws:
   * - HttpError subclasses (TooManyRequestsError, BadGatewayError, etc.) for HTTP errors
   * - ClientTimeoutError for request timeouts (AbortController)
   * - ConnectionError for network-level failures (TypeError from fetch)
   */
  private async rawFetch(
    url: string,
    options: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Response> {
    const { timeoutMs = 30000, signal: externalSignal, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // If the caller supplied an AbortSignal (e.g. from a client-disconnect
    // AbortController in the streaming routes), wire it to our internal
    // controller so the upstream fetch is cancelled when the caller aborts.
    // The internal timeout controller remains the source of the signal
    // attached to the Request — both aborts propagate to the same fetch
    // via the single internal controller.
    let externalAbortHandler: (() => void) | undefined;
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalAbortHandler = () => controller.abort();
        externalSignal.addEventListener('abort', externalAbortHandler);
      }
    }

    // OTel span: one per upstream HTTP call. The propagator injects the
    // W3C `traceparent` header into the request so the provider can keep
    // the trace going (and so the trace UI shows provider-side spans
    // nested under our gateway span).
    const parsedUrl = (() => { try { return new URL(url); } catch { return null; } })();
    return tracer.startActiveSpan(
      'adapter.fetch',
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'http.method': (fetchOptions.method || 'GET').toUpperCase(),
          'http.url': url,
          'url.full': url,
          'url.scheme': parsedUrl?.protocol.replace(':', '') ?? 'unknown',
          'url.host': parsedUrl?.host ?? 'unknown',
          'server.address': parsedUrl?.host ?? 'unknown',
          'adapter.provider': this.providerId,
        },
      },
      async (span) => {
        try {
          // Build the Request object. We start from `fetchOptions.headers`
          // (a plain object) so we can inject the W3C `traceparent` header
          // in-place — Request.headers is read-only.
          const headers = new Headers(fetchOptions.headers ?? {});
          // Inject W3C `traceparent` (and any other configured propagators
          // — e.g. baggage) into the request headers. No-op if the global
          // propagator isn't set yet, which is fine.
          propagation.inject(context.active(), headers);
          // Persist the (possibly augmented) headers into fetchOptions so
          // the Request below picks them up.
          fetchOptions.headers = headers;

          let request = new Request(url, {
            ...fetchOptions,
            signal: controller.signal,
          });

          // Execute beforeRequest hooks
          const hookCtx = {
            url: new URL(url),
            method: fetchOptions.method || 'GET',
            providerId: this.providerId,
          };
          request = await this.hooks.executeBeforeRequest(hookCtx, request);

          let response = await fetch(request);

          span.setAttribute('http.status_code', response.status);

          // Execute afterSuccess hooks for successful responses
          if (response.ok) {
            span.setStatus({ code: SpanStatusCode.OK });
            response = await this.hooks.executeAfterSuccess(
              { ...hookCtx, status: response.status },
              response,
            );
          } else {
            // Read error body for typed error creation (clone to keep original readable)
            const errorBody = await response.clone().text();

            // Create a typed HTTP error with full context instead of a plain Error.
            // This produces status-specific classes (TooManyRequestsError, BadGatewayError, etc.)
            // with statusCode, headers, body, and parsed data attached.
            const httpError = createHttpError(response.status, {
              response,
              request,
              body: errorBody,
            });

            // Execute afterError hooks with the typed error
            const result = await this.hooks.executeAfterError(
              { ...hookCtx, status: response.status, error: httpError },
              response,
              httpError,
            );

            if (result.response) {
              response = result.response;
            }

            // If hooks didn't recover the response (still not OK), throw the typed error
            if (!response.ok) {
              span.recordException(httpError);
              span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
              throw httpError;
            }
            span.setStatus({ code: SpanStatusCode.OK });
          }

          return response;
        } catch (error) {
          if (!(error instanceof HttpError)) {
            // HttpError is already recorded + status set above. Record + status
            // transport errors so the trace shows them distinctly.
            span.recordException(error as Error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
          }
          // Re-throw typed HTTP errors as-is (already an HttpError subclass)
          if (error instanceof HttpError) {
            throw error;
          }
          // Wrap transport-level errors in typed client errors
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw new ClientTimeoutError(
              `Request to ${url} timed out after ${timeoutMs}ms`,
              { cause: error },
            );
          }
          if (error instanceof TypeError) {
            throw new ConnectionError(
              `Failed to connect to ${url}: ${error.message}`,
              { cause: error },
            );
          }
          throw error;
        } finally {
          clearTimeout(timeout);
          if (externalAbortHandler && externalSignal) {
            externalSignal.removeEventListener('abort', externalAbortHandler);
          }
          span.end();
        }
      },
    );
  }

  /**
   * HTTP fetch with automatic retry on transient failures.
   *
   * This is the primary HTTP method used by all adapters. It wraps the raw
   * fetch with exponential backoff retry logic so every adapter gets
   * resilience for free.
   *
   * Retryable (temporary) errors -- retried with backoff:
   * - HTTP 429 (Too Many Requests / rate limiting)
   * - HTTP 502 (Bad Gateway)
   * - HTTP 503 (Service Unavailable)
   * - HTTP 504 (Gateway Timeout)
   * - Connection errors (ECONNRESET, "fetch failed", etc.)
   * - Timeout errors
   *
   * Permanent errors -- thrown immediately, no retry:
   * - HTTP 4xx client errors other than 429 (400, 401, 403, 404, etc.)
   * - HTTP 500/501/5xx not listed above
   * - Any other unexpected error
   *
   * Uses exponential backoff with jitter. Respects Retry-After headers on
   * 429 responses. Subclasses can override `retryConfig` to customise.
   */
  protected async fetchWithTimeout(
    url: string,
    options: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Response> {
    // Allow adapters to opt out of retry entirely
    if (this.retryConfig.strategy === 'none') {
      return this.rawFetch(url, options);
    }

    let attempt = 0;
    // Track the original typed HttpError so we can restore it when retries
    // are exhausted (instead of surfacing a generic TemporaryError).
    let lastRetryableHttpError: HttpError | undefined;

    try {
      return await withRetry(
        async () => {
          attempt++;

          if (attempt > 1) {
            logger.info(
              { providerId: this.providerId, attempt, url },
              'Retrying HTTP request after transient failure',
            );
          }

          try {
            return await this.rawFetch(url, options);
          } catch (error) {
            // --- Error classification for the retry loop ---

            // Retryable HTTP status codes: throw TemporaryError so withRetry
            // can parse the Retry-After header and schedule the next attempt.
            if (
              error instanceof HttpError &&
              RETRYABLE_STATUS_CODES.includes(String(error.statusCode))
            ) {
              lastRetryableHttpError = error;
              throw new TemporaryError(
                `Retryable HTTP ${error.statusCode}: ${error.message}`,
                error.rawResponse,
              );
            }

            // Non-retryable HTTP errors (other 4xx/5xx): wrap in
            // PermanentError so withRetry stops immediately.  The original
            // HttpError is attached as `cause`.
            if (error instanceof HttpError) {
              throw new PermanentError(
                `Permanent HTTP ${error.statusCode}: ${error.message}`,
                { cause: error },
              );
            }

            // Connection and timeout errors (already wrapped by rawFetch as
            // ConnectionError / ClientTimeoutError): re-throw as-is so the
            // retryableErrors predicate can classify them.
            throw error;
          }
        },
        {
          config: this.retryConfig,
          retryableErrors: (err) => {
            // TemporaryError (retryable HTTP status code) -- retry.
            // withRetry will use parseRetryAfter for the delay.
            if (err instanceof TemporaryError) return true;

            // PermanentError (non-retryable HTTP client error) -- stop.
            if (err instanceof PermanentError) return false;

            // Wrapped connection errors from rawFetch
            if (err instanceof ConnectionError) return true;

            // Wrapped timeout errors from rawFetch
            if (err instanceof ClientTimeoutError) return true;

            // Raw connection errors (fallback for any that slipped through)
            if (isConnectionError(err)) return true;

            // Raw timeout errors (fallback)
            if (isTimeoutError(err)) return true;

            // Unknown errors -- do not retry
            return false;
          },
        },
      );
    } catch (error) {
      // --- Error restoration for backward compatibility ---
      //
      // When retries are exhausted for a retryable HTTP error (e.g. 429),
      // withRetry throws the last TemporaryError.  We convert it back to
      // the original typed HttpError (TooManyRequestsError, etc.) so that
      // callers see the same error type they would without retry.
      if (error instanceof TemporaryError && lastRetryableHttpError) {
        throw lastRetryableHttpError;
      }

      // When withRetry throws a PermanentError, unwrap it so callers get
      // the original typed HttpError (BadRequestError, UnauthorizedError, etc.)
      if (error instanceof PermanentError && error.cause instanceof HttpError) {
        throw error.cause;
      }

      throw error;
    }
  }

  /**
   * Fetch with explicit retry semantics.
   * Functionally identical to fetchWithTimeout -- provided for call-site
   * clarity when an adapter wants to signal that retry behaviour is
   * intentional rather than inherited.
   */
  protected async fetchWithRetry(
    url: string,
    options: RequestInit & { timeoutMs?: number } = {},
  ): Promise<Response> {
    return this.fetchWithTimeout(url, options);
  }
}
