// Ported from OpenRouter SDK's error classes with adaptations for DMR-X.
// Source: https://github.com/OpenRouterTeam/typescript-sdk/tree/main/src/models/errors

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** HTTP metadata captured from a request/response cycle. */
export interface HttpMeta {
  response: Response;
  request: Request;
  body: string;
}

/** Generic shape of error data returned by upstream APIs. */
export interface HttpErrorData {
  error?: {
    message?: string;
    code?: string;
    type?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

/** The base class for all HTTP error responses. */
export class HttpError extends Error {
  /** HTTP status code */
  public readonly statusCode: number;
  /** HTTP response body */
  public readonly body: string;
  /** HTTP response headers */
  public readonly headers: Headers;
  /** HTTP content-type header value */
  public readonly contentType: string;
  /** The raw Response object */
  public readonly rawResponse: Response;
  /** Parsed error data from the response body (if JSON) */
  public readonly data: HttpErrorData;

  constructor(
    message: string,
    httpMeta: HttpMeta,
    data: HttpErrorData = {},
  ) {
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
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
      "Bad Request: Invalid request parameters or malformed input";
    super(message, httpMeta, data);
    this.name = "BadRequestError";
  }
}

/** 401 Unauthorized - Authentication required or invalid credentials */
export class UnauthorizedError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
      "Unauthorized: Authentication required or invalid credentials";
    super(message, httpMeta, data);
    this.name = "UnauthorizedError";
  }
}

/** 402 Payment Required - Insufficient credits or quota to complete request */
export class PaymentRequiredError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
      "Payment Required: Insufficient credits or quota";
    super(message, httpMeta, data);
    this.name = "PaymentRequiredError";
  }
}

/** 403 Forbidden - Authentication successful but insufficient permissions */
export class ForbiddenError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
      "Forbidden: Insufficient permissions for this resource";
    super(message, httpMeta, data);
    this.name = "ForbiddenError";
  }
}

/** 404 Not Found - Resource does not exist */
export class NotFoundError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message || "Not Found: The requested resource does not exist";
    super(message, httpMeta, data);
    this.name = "NotFoundError";
  }
}

/** 408 Request Timeout - Operation exceeded time limit */
export class RequestTimeoutError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
      "Request Timeout: Operation exceeded the time limit";
    super(message, httpMeta, data);
    this.name = "RequestTimeoutError";
  }
}

/** 409 Conflict - Resource conflict or concurrent modification */
export class ConflictError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
      "Conflict: Resource conflict or concurrent modification";
    super(message, httpMeta, data);
    this.name = "ConflictError";
  }
}

/** 413 Payload Too Large - Request payload exceeds size limits */
export class PayloadTooLargeError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
      "Payload Too Large: Request body exceeds size limits";
    super(message, httpMeta, data);
    this.name = "PayloadTooLargeError";
  }
}

/** 422 Unprocessable Entity - Semantic validation failure */
export class UnprocessableEntityError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
      "Unprocessable Entity: Semantic validation failure";
    super(message, httpMeta, data);
    this.name = "UnprocessableEntityError";
  }
}

/** 429 Too Many Requests - Rate limit exceeded */
export class TooManyRequestsError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message || "Too Many Requests: Rate limit exceeded";
    super(message, httpMeta, data);
    this.name = "TooManyRequestsError";
  }
}

/** 500 Internal Server Error - Unexpected server error */
export class InternalServerError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message || "Internal Server Error: Unexpected server error";
    super(message, httpMeta, data);
    this.name = "InternalServerError";
  }
}

/** 502 Bad Gateway - Provider/upstream API failure */
export class BadGatewayError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message || "Bad Gateway: Provider or upstream API failure";
    super(message, httpMeta, data);
    this.name = "BadGatewayError";
  }
}

/** 503 Service Unavailable - Service temporarily unavailable */
export class ServiceUnavailableError extends HttpError {
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
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
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
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
  constructor(httpMeta: HttpMeta, data: HttpErrorData = {}) {
    const message =
      data.error?.message ||
      "Edge Network Timeout: Provider request timed out at edge network";
    super(message, httpMeta, data);
    this.name = "EdgeNetworkTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// HttpErrorMap - Maps HTTP status codes to their error classes
// ---------------------------------------------------------------------------

type HttpErrorClass = new (httpMeta: HttpMeta, data?: HttpErrorData) => HttpError;

/** Maps HTTP status codes to their corresponding error classes. */
export const HttpErrorMap: Record<number, HttpErrorClass> = {
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
export function createHttpError(
  statusCode: number,
  httpMeta: HttpMeta,
): HttpError {
  let data: HttpErrorData = {};
  try {
    data = JSON.parse(httpMeta.body);
  } catch {
    // Body is not JSON; use empty data object
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
  override readonly cause: unknown;
  override name = "HttpClientError";

  constructor(message: string, opts?: { cause?: unknown }) {
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
  override name = "UnexpectedClientError";
}

/** Inputs used to create a request are invalid. */
export class InvalidRequestError extends HttpClientError {
  override name = "InvalidRequestError";
}

/** A HTTP request was aborted by the client. */
export class RequestAbortedError extends HttpClientError {
  override readonly name = "RequestAbortedError";
}

/** A HTTP request timed out due to an AbortSignal timeout. */
export class ClientTimeoutError extends HttpClientError {
  override readonly name = "ClientTimeoutError";
}

/** Unable to establish a connection to the server. */
export class ConnectionError extends HttpClientError {
  override readonly name = "ConnectionError";
}
