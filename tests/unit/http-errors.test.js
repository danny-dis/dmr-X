"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const http_errors_js_1 = require("../../packages/utils/src/http-errors.js");
function makeHttpMeta(status = 500, body = '{}', contentType = 'application/json') {
    const headers = new Headers({ 'content-type': contentType });
    const response = new Response(body, { status, headers });
    const request = new Request('https://example.com/api');
    return { response, request, body };
}
(0, vitest_1.describe)('http-errors', () => {
    (0, vitest_1.describe)('HttpError base class', () => {
        (0, vitest_1.it)('should set all properties from httpMeta', () => {
            const meta = makeHttpMeta(400, '{"error":{"message":"bad"}}');
            const error = new http_errors_js_1.HttpError('test', meta);
            (0, vitest_1.expect)(error.statusCode).toBe(400);
            (0, vitest_1.expect)(error.body).toBe('{"error":{"message":"bad"}}');
            (0, vitest_1.expect)(error.contentType).toBe('application/json');
            (0, vitest_1.expect)(error.name).toBe('HttpError');
        });
        (0, vitest_1.it)('should accept custom error data', () => {
            const meta = makeHttpMeta(500);
            const data = { error: { message: 'custom', code: 'E001' } };
            const error = new http_errors_js_1.HttpError('test', meta, data);
            (0, vitest_1.expect)(error.data.error?.message).toBe('custom');
            (0, vitest_1.expect)(error.data.error?.code).toBe('E001');
        });
    });
    (0, vitest_1.describe)('Typed error subclasses', () => {
        const testCases = [
            [400, 'BadRequestError', http_errors_js_1.BadRequestError],
            [401, 'UnauthorizedError', http_errors_js_1.UnauthorizedError],
            [402, 'PaymentRequiredError', http_errors_js_1.PaymentRequiredError],
            [403, 'ForbiddenError', http_errors_js_1.ForbiddenError],
            [404, 'NotFoundError', http_errors_js_1.NotFoundError],
            [408, 'RequestTimeoutError', http_errors_js_1.RequestTimeoutError],
            [409, 'ConflictError', http_errors_js_1.ConflictError],
            [413, 'PayloadTooLargeError', http_errors_js_1.PayloadTooLargeError],
            [422, 'UnprocessableEntityError', http_errors_js_1.UnprocessableEntityError],
            [429, 'TooManyRequestsError', http_errors_js_1.TooManyRequestsError],
            [500, 'InternalServerError', http_errors_js_1.InternalServerError],
            [502, 'BadGatewayError', http_errors_js_1.BadGatewayError],
            [503, 'ServiceUnavailableError', http_errors_js_1.ServiceUnavailableError],
            [529, 'ProviderOverloadedError', http_errors_js_1.ProviderOverloadedError],
            [530, 'EdgeNetworkTimeoutError', http_errors_js_1.EdgeNetworkTimeoutError],
        ];
        for (const [status, name, ErrorClass] of testCases) {
            (0, vitest_1.it)(`${name} should have status ${status} and name "${name}"`, () => {
                const meta = makeHttpMeta(status);
                const error = new ErrorClass(meta);
                (0, vitest_1.expect)(error.statusCode).toBe(status);
                (0, vitest_1.expect)(error.name).toBe(name);
                (0, vitest_1.expect)(error).toBeInstanceOf(http_errors_js_1.HttpError);
            });
        }
    });
    (0, vitest_1.describe)('Error messages from data', () => {
        (0, vitest_1.it)('should use error.message from data when available', () => {
            const meta = makeHttpMeta(400);
            const data = { error: { message: 'Custom bad request' } };
            const error = new http_errors_js_1.BadRequestError(meta, data);
            (0, vitest_1.expect)(error.message).toBe('Custom bad request');
        });
        (0, vitest_1.it)('should fall back to default message when data has no message', () => {
            const meta = makeHttpMeta(401);
            const error = new http_errors_js_1.UnauthorizedError(meta);
            (0, vitest_1.expect)(error.message).toContain('Unauthorized');
        });
    });
    (0, vitest_1.describe)('HttpErrorMap', () => {
        (0, vitest_1.it)('should map all standard status codes', () => {
            (0, vitest_1.expect)(http_errors_js_1.HttpErrorMap[400]).toBe(http_errors_js_1.BadRequestError);
            (0, vitest_1.expect)(http_errors_js_1.HttpErrorMap[401]).toBe(http_errors_js_1.UnauthorizedError);
            (0, vitest_1.expect)(http_errors_js_1.HttpErrorMap[403]).toBe(http_errors_js_1.ForbiddenError);
            (0, vitest_1.expect)(http_errors_js_1.HttpErrorMap[404]).toBe(http_errors_js_1.NotFoundError);
            (0, vitest_1.expect)(http_errors_js_1.HttpErrorMap[429]).toBe(http_errors_js_1.TooManyRequestsError);
            (0, vitest_1.expect)(http_errors_js_1.HttpErrorMap[500]).toBe(http_errors_js_1.InternalServerError);
            (0, vitest_1.expect)(http_errors_js_1.HttpErrorMap[502]).toBe(http_errors_js_1.BadGatewayError);
            (0, vitest_1.expect)(http_errors_js_1.HttpErrorMap[503]).toBe(http_errors_js_1.ServiceUnavailableError);
        });
        (0, vitest_1.it)('should have 15 entries', () => {
            (0, vitest_1.expect)(Object.keys(http_errors_js_1.HttpErrorMap)).toHaveLength(15);
        });
    });
    (0, vitest_1.describe)('createHttpError', () => {
        (0, vitest_1.it)('should create typed error for known status codes', () => {
            const meta = makeHttpMeta(404, '{"error":{"message":"not found"}}');
            const error = (0, http_errors_js_1.createHttpError)(404, meta);
            (0, vitest_1.expect)(error).toBeInstanceOf(http_errors_js_1.NotFoundError);
            (0, vitest_1.expect)(error.statusCode).toBe(404);
        });
        (0, vitest_1.it)('should fall back to HttpError for unknown status codes', () => {
            const meta = makeHttpMeta(418, '{}');
            const error = (0, http_errors_js_1.createHttpError)(418, meta);
            (0, vitest_1.expect)(error).toBeInstanceOf(http_errors_js_1.HttpError);
            (0, vitest_1.expect)(error.name).toBe('HttpError');
            (0, vitest_1.expect)(error.statusCode).toBe(418);
        });
        (0, vitest_1.it)('should parse JSON body for error data', () => {
            const meta = makeHttpMeta(400, '{"error":{"message":"parsed","code":"E1"}}');
            const error = (0, http_errors_js_1.createHttpError)(400, meta);
            (0, vitest_1.expect)(error.data.error?.message).toBe('parsed');
            (0, vitest_1.expect)(error.data.error?.code).toBe('E1');
        });
        (0, vitest_1.it)('should handle non-JSON body gracefully', () => {
            const meta = makeHttpMeta(500, 'Internal Server Error');
            const error = (0, http_errors_js_1.createHttpError)(500, meta);
            (0, vitest_1.expect)(error).toBeInstanceOf(http_errors_js_1.InternalServerError);
        });
    });
    (0, vitest_1.describe)('HttpClientError (transport-level)', () => {
        (0, vitest_1.it)('should set cause when provided', () => {
            const cause = new Error('network down');
            const error = new http_errors_js_1.HttpClientError('Connection failed', { cause });
            (0, vitest_1.expect)(error.cause).toBe(cause);
            (0, vitest_1.expect)(error.message).toContain('network down');
            (0, vitest_1.expect)(error.name).toBe('HttpClientError');
        });
        (0, vitest_1.it)('should work without cause', () => {
            const error = new http_errors_js_1.HttpClientError('Something broke');
            (0, vitest_1.expect)(error.message).toBe('Something broke');
        });
    });
    (0, vitest_1.describe)('Client error subclasses', () => {
        (0, vitest_1.it)('UnexpectedClientError should extend HttpClientError', () => {
            const error = new http_errors_js_1.UnexpectedClientError('unexpected');
            (0, vitest_1.expect)(error).toBeInstanceOf(http_errors_js_1.HttpClientError);
            (0, vitest_1.expect)(error.name).toBe('UnexpectedClientError');
        });
        (0, vitest_1.it)('InvalidRequestError should extend HttpClientError', () => {
            const error = new http_errors_js_1.InvalidRequestError('bad input');
            (0, vitest_1.expect)(error).toBeInstanceOf(http_errors_js_1.HttpClientError);
            (0, vitest_1.expect)(error.name).toBe('InvalidRequestError');
        });
        (0, vitest_1.it)('RequestAbortedError should extend HttpClientError', () => {
            const error = new http_errors_js_1.RequestAbortedError('aborted');
            (0, vitest_1.expect)(error).toBeInstanceOf(http_errors_js_1.HttpClientError);
            (0, vitest_1.expect)(error.name).toBe('RequestAbortedError');
        });
        (0, vitest_1.it)('ClientTimeoutError should extend HttpClientError', () => {
            const error = new http_errors_js_1.ClientTimeoutError('timed out');
            (0, vitest_1.expect)(error).toBeInstanceOf(http_errors_js_1.HttpClientError);
            (0, vitest_1.expect)(error.name).toBe('ClientTimeoutError');
        });
        (0, vitest_1.it)('ConnectionError should extend HttpClientError', () => {
            const error = new http_errors_js_1.ConnectionError('refused');
            (0, vitest_1.expect)(error).toBeInstanceOf(http_errors_js_1.HttpClientError);
            (0, vitest_1.expect)(error.name).toBe('ConnectionError');
        });
    });
});
//# sourceMappingURL=http-errors.test.js.map