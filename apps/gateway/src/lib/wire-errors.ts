/**
 * Per-format wire error serializers for non-streaming routes.
 *
 * The gateway's default error shape (`{ error: { message, type, code } }`,
 * see apps/gateway/src/security-headers.ts) is understood by the DMR-X UI,
 * but NOT by the official Anthropic and Gemini SDK error parsers. Those
 * clients only recognise their own envelope, so a non-streaming
 * `/v1/messages` or `generateContent` failure currently surfaces as a
 * generic, unparseable body.
 *
 * These helpers emit the exact envelopes the official SDKs expect. They are
 * wired via Fastify's encapsulated setErrorHandler() inside the
 * anthropic/gemini route plugins, so the admin API and the UI keep the
 * default shape.
 */

import {
  AuthenticationError,
  DMRXError,
  ProviderUnavailableError,
  RateLimitError,
  ValidationError,
} from '@dmr-x/core';
import { LOCAL_MODE } from '../middleware/auth.middleware.js';

/**
 * HTTP status -> Anthropic error type, per
 * https://docs.anthropic.com/en/api/errors
 */
export function anthropicErrorType(statusCode: number): string {
  switch (statusCode) {
    case 400: return 'invalid_request_error';
    case 401: return 'authentication_error';
    case 403: return 'permission_error';
    case 404: return 'not_found_error';
    case 413: return 'request_too_large';
    case 429: return 'rate_limit_error';
    case 500: return 'api_error';
    case 503: return 'overloaded_error'; // ProviderUnavailableError; matches the SSE path's overloaded_error
    case 529: return 'overloaded_error';
    default: return statusCode >= 500 ? 'api_error' : 'invalid_request_error';
  }
}

/**
 * Format a DMR-X error as the Anthropic /v1/messages error envelope:
 *   { type: 'error', error: { type, message } }
 * with the correct status code. Streaming errors are handled inline by the
 * route (event-typed SSE), so this is only for non-streaming responses.
 */
export function anthropicWireError(
  error: unknown,
  opts?: { exposeMessage?: boolean; requestId?: string }
): { statusCode: number; body: Record<string, unknown> } {
  const statusCode = error instanceof DMRXError
    ? error.statusCode
    : (error as { statusCode?: number })?.statusCode ?? 500;
  const message = error instanceof Error ? error.message : 'Unknown error';
  const expose = opts?.exposeMessage ?? (statusCode < 500);
  const safeMessage = expose ? message : 'Internal server error';

  const body: Record<string, unknown> = {
    type: 'error',
    error: {
      type: anthropicErrorType(statusCode),
      message: safeMessage,
    },
  };
  if (opts?.requestId && statusCode >= 500) {
    (body.error as Record<string, unknown>).request_id = opts.requestId;
  }
  return { statusCode, body };
}

/** HTTP status -> Gemini `status` string (google.rpc.Code names). */
export function geminiErrorStatus(statusCode: number): string {
  switch (statusCode) {
    case 400: return 'INVALID_ARGUMENT';
    case 401: return 'UNAUTHENTICATED';
    case 403: return 'PERMISSION_DENIED';
    case 404: return 'NOT_FOUND';
    case 409: return 'ABORTED';
    case 429: return 'RESOURCE_EXHAUSTED';
    case 499: return 'CANCELLED';
    case 501: return 'UNIMPLEMENTED';
    case 503: return 'UNAVAILABLE';
    case 504: return 'DEADLINE_EXCEEDED';
    default: return statusCode >= 500 ? 'INTERNAL' : 'INVALID_ARGUMENT';
  }
}

/**
 * Format a DMR-X error as the Gemini generateContent error envelope:
 *   { error: { code, message, status } }
 * Google SDK clients read `error.code` and `error.status`.
 */
export function geminiWireError(
  error: unknown,
  opts?: { exposeMessage?: boolean; requestId?: string }
): { statusCode: number; body: Record<string, unknown> } {
  const statusCode = error instanceof DMRXError
    ? error.statusCode
    : (error as { statusCode?: number })?.statusCode ?? 500;
  const message = error instanceof Error ? error.message : 'Unknown error';
  const expose = opts?.exposeMessage ?? (statusCode < 500);
  const safeMessage = expose ? message : 'Internal server error';

  const body: Record<string, unknown> = {
    error: {
      code: statusCode,
      message: safeMessage,
      status: geminiErrorStatus(statusCode),
    },
  };
  if (opts?.requestId && statusCode >= 500) {
    (body.error as Record<string, unknown>).request_id = opts.requestId;
  }
  return { statusCode, body };
}

/**
 * Shared guard used by the scoped error handlers: 5xx internal details are
 * hidden from the wire unless running in dev/local mode, matching the
 * gateway-wide handler in security-headers.ts. Uses the frozen LOCAL_MODE
 * constant (not a live process.env read) for the same CRIT-2 reason.
 */
export function shouldExposeInternalError(): boolean {
  return LOCAL_MODE || process.env.NODE_ENV !== 'production';
}

// Re-exported for convenience so route files can build error objects without
// importing @dmr-x/core directly for the common cases.
export { AuthenticationError, DMRXError, ProviderUnavailableError, RateLimitError, ValidationError };
