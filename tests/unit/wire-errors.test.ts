import { describe, it, expect } from 'vitest';

import {
  anthropicErrorType,
  anthropicWireError,
  geminiErrorStatus,
  geminiWireError,
} from '../../apps/gateway/src/lib/wire-errors.js';
import {
  AuthenticationError,
  ProviderUnavailableError,
  RateLimitError,
  ValidationError,
} from '../../packages/core/src/types/errors.js';

/**
 * Per-format wire error serializers (apps/gateway/src/lib/wire-errors.ts).
 *
 * The gateway-wide error handler emits `{ error: { message, type, code } }`,
 * which the official Anthropic and Gemini SDKs do NOT parse. These helpers
 * produce the exact envelopes those SDKs expect for non-streaming failures.
 */

describe('anthropicWireError', () => {
  it('maps DMR-X ValidationError to the Anthropic 400 envelope', () => {
    const { statusCode, body } = anthropicWireError(new ValidationError('Bad messages array'));
    expect(statusCode).toBe(400);
    expect(body).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Bad messages array' },
    });
  });

  it('maps AuthenticationError to 401 authentication_error', () => {
    const { statusCode, body } = anthropicWireError(new AuthenticationError());
    expect(statusCode).toBe(401);
    expect((body.error as { type: string }).type).toBe('authentication_error');
  });

  it('maps RateLimitError to 429 rate_limit_error', () => {
    const { statusCode, body } = anthropicWireError(new RateLimitError(5000));
    expect(statusCode).toBe(429);
    expect((body.error as { type: string }).type).toBe('rate_limit_error');
  });

  it('maps ProviderUnavailableError to 503 overloaded_error', () => {
    const { statusCode, body } = anthropicWireError(new ProviderUnavailableError([]));
    expect(statusCode).toBe(503);
    expect((body.error as { type: string }).type).toBe('overloaded_error');
  });

  it('maps an unknown error to 500 api_error', () => {
    const { statusCode, body } = anthropicWireError(new Error('boom'));
    expect(statusCode).toBe(500);
    expect((body.error as { type: string }).type).toBe('api_error');
  });

  it('hides internal 5xx messages when exposeMessage is false', () => {
    const { body } = anthropicWireError(new Error('secret internals'), { exposeMessage: false });
    expect((body.error as { message: string }).message).toBe('Internal server error');
  });

  it('keeps the real message for 5xx when exposeMessage is true (dev/local)', () => {
    const { body } = anthropicWireError(new Error('real message'), { exposeMessage: true });
    expect((body.error as { message: string }).message).toBe('real message');
  });

  it('attaches request_id on 5xx', () => {
    const { body } = anthropicWireError(new Error('boom'), { requestId: 'req-123' });
    expect((body.error as { request_id?: string }).request_id).toBe('req-123');
  });

  it('does not attach request_id on 4xx', () => {
    const { body } = anthropicWireError(new ValidationError('nope'), { requestId: 'req-123' });
    expect((body.error as { request_id?: string }).request_id).toBeUndefined();
  });
});

describe('anthropicErrorType', () => {
  it.each([
    [400, 'invalid_request_error'],
    [401, 'authentication_error'],
    [403, 'permission_error'],
    [404, 'not_found_error'],
    [413, 'request_too_large'],
    [429, 'rate_limit_error'],
    [500, 'api_error'],
    [529, 'overloaded_error'],
    [503, 'overloaded_error'],
    [302, 'invalid_request_error'],
  ])('maps %i -> %s', (status, expected) => {
    expect(anthropicErrorType(status)).toBe(expected);
  });
});

describe('geminiWireError', () => {
  it('maps DMR-X ValidationError to the Gemini 400 envelope', () => {
    const { statusCode, body } = geminiWireError(new ValidationError('Bad contents array'));
    expect(statusCode).toBe(400);
    expect(body).toEqual({
      error: {
        code: 400,
        message: 'Bad contents array',
        status: 'INVALID_ARGUMENT',
      },
    });
  });

  it('maps AuthenticationError to 401 UNAUTHENTICATED', () => {
    const { statusCode, body } = geminiWireError(new AuthenticationError());
    expect(statusCode).toBe(401);
    expect((body.error as { status: string }).status).toBe('UNAUTHENTICATED');
  });

  it('maps RateLimitError to 429 RESOURCE_EXHAUSTED', () => {
    const { statusCode, body } = geminiWireError(new RateLimitError(1000));
    expect(statusCode).toBe(429);
    expect((body.error as { status: string }).status).toBe('RESOURCE_EXHAUSTED');
  });

  it('maps ProviderUnavailableError to 503 UNAVAILABLE', () => {
    const { statusCode, body } = geminiWireError(new ProviderUnavailableError([]));
    expect(statusCode).toBe(503);
    expect((body.error as { status: string }).status).toBe('UNAVAILABLE');
  });

  it('maps an unknown error to 500 INTERNAL', () => {
    const { statusCode, body } = geminiWireError(new Error('boom'));
    expect(statusCode).toBe(500);
    expect((body.error as { status: string }).status).toBe('INTERNAL');
  });

  it('hides internal 5xx messages when exposeMessage is false', () => {
    const { body } = geminiWireError(new Error('secret internals'), { exposeMessage: false });
    expect((body.error as { message: string }).message).toBe('Internal server error');
  });

  it('attaches request_id on 5xx only', () => {
    const five = geminiWireError(new Error('boom'), { requestId: 'req-9' });
    expect((five.body.error as { request_id?: string }).request_id).toBe('req-9');
    const four = geminiWireError(new ValidationError('nope'), { requestId: 'req-9' });
    expect((four.body.error as { request_id?: string }).request_id).toBeUndefined();
  });
});

describe('geminiErrorStatus', () => {
  it.each([
    [400, 'INVALID_ARGUMENT'],
    [401, 'UNAUTHENTICATED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [429, 'RESOURCE_EXHAUSTED'],
    [500, 'INTERNAL'],
    [503, 'UNAVAILABLE'],
    [504, 'DEADLINE_EXCEEDED'],
    [501, 'UNIMPLEMENTED'],
    [418, 'INVALID_ARGUMENT'],
  ])('maps %i -> %s', (status, expected) => {
    expect(geminiErrorStatus(status)).toBe(expected);
  });
});
