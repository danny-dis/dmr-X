// Ported from OpenRouter SDK's error classes with adaptations for DMR-X.
// Source: https://github.com/OpenRouterTeam/typescript-sdk/tree/main/src/models/errors
// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------
/** The base class for all HTTP error responses. */
export class HttpError extends Error {
    /** HTTP status code */
    statusCode;
    /** HTTP response body */
    body;
    /** HTTP response headers */
    headers;
    /** HTTP content-type header value */
    contentType;
    /** The raw Response object */
    rawResponse;
    /** Parsed error data from the response body (if JSON) */
    data;
    constructor(message, httpMeta, data = {}) {
        super(message);
        this.statusCode = httpMeta.response.status;
        this.body = httpMeta.body;
        this.headers = httpMeta.response.headers;
        this.contentType = httpMeta.response.headers.get("content-type") || "";
        this.rawResponse = httpMeta.response;
        this.data = data;
        this.name = "HttpError";
    }
}
// ---------------------------------------------------------------------------
// Typed subclasses (status-code-specific)
// ---------------------------------------------------------------------------
/** 400 Bad Request - Invalid request parameters or malformed input */
export class BadRequestError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Bad Request: Invalid request parameters or malformed input";
        super(message, httpMeta, data);
        this.name = "BadRequestError";
    }
}
/** 401 Unauthorized - Authentication required or invalid credentials */
export class UnauthorizedError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Unauthorized: Authentication required or invalid credentials";
        super(message, httpMeta, data);
        this.name = "UnauthorizedError";
    }
}
/** 402 Payment Required - Insufficient credits or quota to complete request */
export class PaymentRequiredError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Payment Required: Insufficient credits or quota";
        super(message, httpMeta, data);
        this.name = "PaymentRequiredError";
    }
}
/** 403 Forbidden - Authentication successful but insufficient permissions */
export class ForbiddenError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Forbidden: Insufficient permissions for this resource";
        super(message, httpMeta, data);
        this.name = "ForbiddenError";
    }
}
/** 404 Not Found - Resource does not exist */
export class NotFoundError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message || "Not Found: The requested resource does not exist";
        super(message, httpMeta, data);
        this.name = "NotFoundError";
    }
}
/** 408 Request Timeout - Operation exceeded time limit */
export class RequestTimeoutError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Request Timeout: Operation exceeded the time limit";
        super(message, httpMeta, data);
        this.name = "RequestTimeoutError";
    }
}
/** 409 Conflict - Resource conflict or concurrent modification */
export class ConflictError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Conflict: Resource conflict or concurrent modification";
        super(message, httpMeta, data);
        this.name = "ConflictError";
    }
}
/** 413 Payload Too Large - Request payload exceeds size limits */
export class PayloadTooLargeError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Payload Too Large: Request body exceeds size limits";
        super(message, httpMeta, data);
        this.name = "PayloadTooLargeError";
    }
}
/** 422 Unprocessable Entity - Semantic validation failure */
export class UnprocessableEntityError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Unprocessable Entity: Semantic validation failure";
        super(message, httpMeta, data);
        this.name = "UnprocessableEntityError";
    }
}
/** 429 Too Many Requests - Rate limit exceeded */
export class TooManyRequestsError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message || "Too Many Requests: Rate limit exceeded";
        super(message, httpMeta, data);
        this.name = "TooManyRequestsError";
    }
}
/** 500 Internal Server Error - Unexpected server error */
export class InternalServerError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message || "Internal Server Error: Unexpected server error";
        super(message, httpMeta, data);
        this.name = "InternalServerError";
    }
}
/** 502 Bad Gateway - Provider/upstream API failure */
export class BadGatewayError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message || "Bad Gateway: Provider or upstream API failure";
        super(message, httpMeta, data);
        this.name = "BadGatewayError";
    }
}
/** 503 Service Unavailable - Service temporarily unavailable */
export class ServiceUnavailableError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Service Unavailable: Service temporarily unavailable";
        super(message, httpMeta, data);
        this.name = "ServiceUnavailableError";
    }
}
/**
 * 529 Provider Overloaded - Provider is temporarily overloaded.
 * Note: This is a custom status code used by some API aggregators.
 */
export class ProviderOverloadedError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Provider Overloaded: The provider is temporarily overloaded";
        super(message, httpMeta, data);
        this.name = "ProviderOverloadedError";
    }
}
/**
 * 530 Edge Network Timeout - Provider request timed out at edge network.
 * Note: This is a custom status code used by some API aggregators.
 */
export class EdgeNetworkTimeoutError extends HttpError {
    constructor(httpMeta, data = {}) {
        const message = data.error?.message ||
            "Edge Network Timeout: Provider request timed out at edge network";
        super(message, httpMeta, data);
        this.name = "EdgeNetworkTimeoutError";
    }
}
/** Maps HTTP status codes to their corresponding error classes. */
export const HttpErrorMap = {
    400: BadRequestError,
    401: UnauthorizedError,
    402: PaymentRequiredError,
    403: ForbiddenError,
    404: NotFoundError,
    408: RequestTimeoutError,
    409: ConflictError,
    413: PayloadTooLargeError,
    422: UnprocessableEntityError,
    429: TooManyRequestsError,
    500: InternalServerError,
    502: BadGatewayError,
    503: ServiceUnavailableError,
    529: ProviderOverloadedError,
    530: EdgeNetworkTimeoutError,
};
// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------
/**
 * Creates a typed HttpError for the given status code.
 *
 * Attempts to parse the response body as JSON to extract error data.
 * Falls back to the base HttpError class for unrecognized status codes.
 */
export function createHttpError(statusCode, httpMeta) {
    let data = {};
    try {
        data = JSON.parse(httpMeta.body);
    }
    catch {
        // Body is not JSON; use empty data object (non-error for HTTP responses with text bodies)
    }
    const ErrorClass = HttpErrorMap[statusCode];
    if (ErrorClass) {
        return new ErrorClass(httpMeta, data);
    }
    // Fallback for unrecognized status codes
    const message = data.error?.message || `HTTP Error ${statusCode}`;
    return new HttpError(message, httpMeta, data);
}
// ---------------------------------------------------------------------------
// Client-side HTTP errors (transport-level, not response-status-based)
// ---------------------------------------------------------------------------
/**
 * Base class for client-side HTTP errors (connection failures, timeouts, etc.).
 * These are distinct from HttpError which represents HTTP response status errors.
 */
export class HttpClientError extends Error {
    cause;
    name = "HttpClientError";
    constructor(message, opts) {
        let msg = message;
        if (opts?.cause) {
            msg += `: ${opts.cause}`;
        }
        super(msg, opts);
        // In older runtimes, cause may not be assigned through super()
        if (typeof this.cause === "undefined") {
            this.cause = opts?.cause;
        }
    }
}
/** An unrecognised or unexpected error when making HTTP calls. */
export class UnexpectedClientError extends HttpClientError {
    name = "UnexpectedClientError";
}
/** Inputs used to create a request are invalid. */
export class InvalidRequestError extends HttpClientError {
    name = "InvalidRequestError";
}
/** A HTTP request was aborted by the client. */
export class RequestAbortedError extends HttpClientError {
    name = "RequestAbortedError";
}
/** A HTTP request timed out due to an AbortSignal timeout. */
export class ClientTimeoutError extends HttpClientError {
    name = "ClientTimeoutError";
}
/** Unable to establish a connection to the server. */
export class ConnectionError extends HttpClientError {
    name = "ConnectionError";
}
//# sourceMappingURL=http-errors.js.map