import { describe, it, expect } from 'vitest';
import {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  PaymentRequiredError,
  ForbiddenError,
  NotFoundError,
  RequestTimeoutError,
  ConflictError,
  PayloadTooLargeError,
  UnprocessableEntityError,
  TooManyRequestsError,
  InternalServerError,
  BadGatewayError,
  ServiceUnavailableError,
  ProviderOverloadedError,
  EdgeNetworkTimeoutError,
  HttpClientError,
  UnexpectedClientError,
  InvalidRequestError,
  RequestAbortedError,
  ClientTimeoutError,
  ConnectionError,
  HttpErrorMap,
  createHttpError,
  type HttpMeta,
  type HttpErrorData,
} from '../../packages/utils/src/http-errors.js';

function makeHttpMeta(status = 500, body = '{}', contentType = 'application/json') {
  const headers = new Headers({ 'content-type': contentType });
  const response = new Response(body, { status, headers });
  const request = new Request('https://example.com/api');
  return { response, request, body };
}

describe('http-errors', () => {
  describe('HttpError base class', () => {
    it('should set all properties from httpMeta', () => {
      const meta = makeHttpMeta(400, '{"error":{"message":"bad"}}');
      const error = new HttpError('test', meta);
      expect(error.statusCode).toBe(400);
      expect(error.body).toBe('{"error":{"message":"bad"}}');
      expect(error.contentType).toBe('application/json');
      expect(error.name).toBe('HttpError');
    });

    it('should accept custom error data', () => {
      const meta = makeHttpMeta(500);
      const data = { error: { message: 'custom', code: 'E001' } };
      const error = new HttpError('test', meta, data);
      expect(error.data.error?.message).toBe('custom');
      expect(error.data.error?.code).toBe('E001');
    });
  });

  describe('Typed error subclasses', () => {
    // Subclass constructors take (httpMeta, data?) — different from HttpError(message, httpMeta, data?).
    // Use a permissive constructor type so the tuple type-checks.
    type HttpErrorSubclass = new (httpMeta: HttpMeta, data?: HttpErrorData) => HttpError;

    const testCases: [number, string, HttpErrorSubclass][] = [
      [400, 'BadRequestError', BadRequestError],
      [401, 'UnauthorizedError', UnauthorizedError],
      [402, 'PaymentRequiredError', PaymentRequiredError],
      [403, 'ForbiddenError', ForbiddenError],
      [404, 'NotFoundError', NotFoundError],
      [408, 'RequestTimeoutError', RequestTimeoutError],
      [409, 'ConflictError', ConflictError],
      [413, 'PayloadTooLargeError', PayloadTooLargeError],
      [422, 'UnprocessableEntityError', UnprocessableEntityError],
      [429, 'TooManyRequestsError', TooManyRequestsError],
      [500, 'InternalServerError', InternalServerError],
      [502, 'BadGatewayError', BadGatewayError],
      [503, 'ServiceUnavailableError', ServiceUnavailableError],
      [529, 'ProviderOverloadedError', ProviderOverloadedError],
      [530, 'EdgeNetworkTimeoutError', EdgeNetworkTimeoutError],
    ];

    for (const [status, name, ErrorClass] of testCases) {
      it(`${name} should have status ${status} and name "${name}"`, () => {
        const meta = makeHttpMeta(status);
        const error = new ErrorClass(meta);
        expect(error.statusCode).toBe(status);
        expect(error.name).toBe(name);
        expect(error).toBeInstanceOf(HttpError);
      });
    }
  });

  describe('Error messages from data', () => {
    it('should use error.message from data when available', () => {
      const meta = makeHttpMeta(400);
      const data = { error: { message: 'Custom bad request' } };
      const error = new BadRequestError(meta, data);
      expect(error.message).toBe('Custom bad request');
    });

    it('should fall back to default message when data has no message', () => {
      const meta = makeHttpMeta(401);
      const error = new UnauthorizedError(meta);
      expect(error.message).toContain('Unauthorized');
    });
  });

  describe('HttpErrorMap', () => {
    it('should map all standard status codes', () => {
      expect(HttpErrorMap[400]).toBe(BadRequestError);
      expect(HttpErrorMap[401]).toBe(UnauthorizedError);
      expect(HttpErrorMap[403]).toBe(ForbiddenError);
      expect(HttpErrorMap[404]).toBe(NotFoundError);
      expect(HttpErrorMap[429]).toBe(TooManyRequestsError);
      expect(HttpErrorMap[500]).toBe(InternalServerError);
      expect(HttpErrorMap[502]).toBe(BadGatewayError);
      expect(HttpErrorMap[503]).toBe(ServiceUnavailableError);
    });

    it('should have 15 entries', () => {
      expect(Object.keys(HttpErrorMap)).toHaveLength(15);
    });
  });

  describe('createHttpError', () => {
    it('should create typed error for known status codes', () => {
      const meta = makeHttpMeta(404, '{"error":{"message":"not found"}}');
      const error = createHttpError(404, meta);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.statusCode).toBe(404);
    });

    it('should fall back to HttpError for unknown status codes', () => {
      const meta = makeHttpMeta(418, '{}');
      const error = createHttpError(418, meta);
      expect(error).toBeInstanceOf(HttpError);
      expect(error.name).toBe('HttpError');
      expect(error.statusCode).toBe(418);
    });

    it('should parse JSON body for error data', () => {
      const meta = makeHttpMeta(400, '{"error":{"message":"parsed","code":"E1"}}');
      const error = createHttpError(400, meta);
      expect(error.data.error?.message).toBe('parsed');
      expect(error.data.error?.code).toBe('E1');
    });

    it('should handle non-JSON body gracefully', () => {
      const meta = makeHttpMeta(500, 'Internal Server Error');
      const error = createHttpError(500, meta);
      expect(error).toBeInstanceOf(InternalServerError);
    });
  });

  describe('HttpClientError (transport-level)', () => {
    it('should set cause when provided', () => {
      const cause = new Error('network down');
      const error = new HttpClientError('Connection failed', { cause });
      expect(error.cause).toBe(cause);
      expect(error.message).toContain('network down');
      expect(error.name).toBe('HttpClientError');
    });

    it('should work without cause', () => {
      const error = new HttpClientError('Something broke');
      expect(error.message).toBe('Something broke');
    });
  });

  describe('Client error subclasses', () => {
    it('UnexpectedClientError should extend HttpClientError', () => {
      const error = new UnexpectedClientError('unexpected');
      expect(error).toBeInstanceOf(HttpClientError);
      expect(error.name).toBe('UnexpectedClientError');
    });

    it('InvalidRequestError should extend HttpClientError', () => {
      const error = new InvalidRequestError('bad input');
      expect(error).toBeInstanceOf(HttpClientError);
      expect(error.name).toBe('InvalidRequestError');
    });

    it('RequestAbortedError should extend HttpClientError', () => {
      const error = new RequestAbortedError('aborted');
      expect(error).toBeInstanceOf(HttpClientError);
      expect(error.name).toBe('RequestAbortedError');
    });

    it('ClientTimeoutError should extend HttpClientError', () => {
      const error = new ClientTimeoutError('timed out');
      expect(error).toBeInstanceOf(HttpClientError);
      expect(error.name).toBe('ClientTimeoutError');
    });

    it('ConnectionError should extend HttpClientError', () => {
      const error = new ConnectionError('refused');
      expect(error).toBeInstanceOf(HttpClientError);
      expect(error.name).toBe('ConnectionError');
    });
  });
});
