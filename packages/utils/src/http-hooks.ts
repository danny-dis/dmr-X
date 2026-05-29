/**
 * HTTP client hook system for request/response lifecycle.
 * Inspired by OpenRouter SDK's HTTPClient hook pattern.
 *
 * Allows registering hooks for:
 * - beforeRequest: mutate requests before sending (add headers, tracing, etc.)
 * - afterSuccess: post-process successful responses (logging, metrics)
 * - afterError: handle errors (retry logic, error transformation)
 */

export type Awaitable<T> = T | Promise<T>;

export interface BeforeRequestContext {
  url: URL;
  method: string;
  providerId?: string;
}

export interface AfterSuccessContext {
  url: URL;
  method: string;
  status: number;
  providerId?: string;
}

export interface AfterErrorContext {
  url: URL;
  method: string;
  status?: number;
  providerId?: string;
  error: unknown;
}

export type BeforeRequestHook = (
  ctx: BeforeRequestContext,
  request: Request,
) => Awaitable<Request>;

export type AfterSuccessHook = (
  ctx: AfterSuccessContext,
  response: Response,
) => Awaitable<Response>;

export type AfterErrorHook = (
  ctx: AfterErrorContext,
  response: Response | null,
  error: unknown,
) => Awaitable<{ response: Response | null; error: unknown }>;

export interface HttpHooks {
  registerBeforeRequest(hook: BeforeRequestHook): void;
  registerAfterSuccess(hook: AfterSuccessHook): void;
  registerAfterError(hook: AfterErrorHook): void;
  removeBeforeRequest(hook: BeforeRequestHook): void;
  removeAfterSuccess(hook: AfterSuccessHook): void;
  removeAfterError(hook: AfterErrorHook): void;
}

/**
 * Default implementation of HttpHooks.
 * Hooks are executed in registration order.
 */
export class DefaultHttpHooks implements HttpHooks {
  private beforeRequestHooks: BeforeRequestHook[] = [];
  private afterSuccessHooks: AfterSuccessHook[] = [];
  private afterErrorHooks: AfterErrorHook[] = [];

  registerBeforeRequest(hook: BeforeRequestHook): void {
    this.beforeRequestHooks.push(hook);
  }

  registerAfterSuccess(hook: AfterSuccessHook): void {
    this.afterSuccessHooks.push(hook);
  }

  registerAfterError(hook: AfterErrorHook): void {
    this.afterErrorHooks.push(hook);
  }

  removeBeforeRequest(hook: BeforeRequestHook): void {
    const idx = this.beforeRequestHooks.indexOf(hook);
    if (idx >= 0) this.beforeRequestHooks.splice(idx, 1);
  }

  removeAfterSuccess(hook: AfterSuccessHook): void {
    const idx = this.afterSuccessHooks.indexOf(hook);
    if (idx >= 0) this.afterSuccessHooks.splice(idx, 1);
  }

  removeAfterError(hook: AfterErrorHook): void {
    const idx = this.afterErrorHooks.indexOf(hook);
    if (idx >= 0) this.afterErrorHooks.splice(idx, 1);
  }

  async executeBeforeRequest(ctx: BeforeRequestContext, request: Request): Promise<Request> {
    let req = request;
    for (const hook of this.beforeRequestHooks) {
      req = await hook(ctx, req);
    }
    return req;
  }

  async executeAfterSuccess(ctx: AfterSuccessContext, response: Response): Promise<Response> {
    let res = response;
    for (const hook of this.afterSuccessHooks) {
      res = await hook(ctx, res);
    }
    return res;
  }

  async executeAfterError(
    ctx: AfterErrorContext,
    response: Response | null,
    error: unknown,
  ): Promise<{ response: Response | null; error: unknown }> {
    let res = response;
    let err = error;
    for (const hook of this.afterErrorHooks) {
      const result = await hook(ctx, res, err);
      res = result.response;
      err = result.error;
    }
    return { response: res, error: err };
  }
}

/**
 * Check if a response content-type matches a pattern.
 * Supports wildcards like `* / *`, `application/* `, etc.
 */
export function matchContentType(response: Response, pattern: string): boolean {
  if (pattern === '*') return true;

  let contentType =
    response.headers.get('content-type')?.trim() || 'application/octet-stream';
  contentType = contentType.toLowerCase();

  const mediaParamSeparator = /\s*;\s*/g;
  const wantParts = pattern.toLowerCase().trim().split(mediaParamSeparator);
  const [wantType = ''] = wantParts;

  if (wantType.split('/').length !== 2) return false;

  const gotParts = contentType.split(mediaParamSeparator);
  const [gotType = ''] = gotParts;
  const [type = '', subtype = ''] = gotType.split('/');

  if (!type || !subtype) return false;
  if (
    wantType !== '*/*' &&
    gotType !== wantType &&
    `${type}/*` !== wantType &&
    `*/${subtype}` !== wantType
  ) {
    return false;
  }

  return true;
}

/**
 * Check if a response status code matches a predicate.
 * Supports exact codes (200), ranges (4xx, 5xx), and 'default'.
 */
export function matchStatusCode(
  response: Response | { status: number },
  codes: number | string | (number | string)[],
): boolean {
  const actual = `${response.status}`;
  const expectedCodes = Array.isArray(codes) ? codes : [codes];
  const codeRangeRE = /^[0-9]xx$/i;

  return expectedCodes.some((ec) => {
    const code = `${ec}`;
    if (code === 'default') return true;
    if (!codeRangeRE.test(code)) return code === actual;

    const expectFamily = code.charAt(0);
    const actualFamily = actual.charAt(0);
    return expectFamily === actualFamily;
  });
}
