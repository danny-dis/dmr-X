/**
 * Declarative response format matching with Zod-like schema validation.
 * Ported from OpenRouter SDK's matchers.ts with adaptations for DMR-X.
 *
 * Provides matchers like json(), sse(), text(), stream() that combine
 * status code predicates, content-type matching, and typed schema validation
 * into a single composable match() function.
 */
export function OK(value) {
    return { ok: true, value };
}
export function ERR(error) {
    return { ok: false, error };
}
export function unwrap(r) {
    if (!r.ok)
        throw r.error;
    return r.value;
}
export async function unwrapAsync(pr) {
    const r = await pr;
    if (!r.ok)
        throw r.error;
    return r.value;
}
// ---------------------------------------------------------------------------
// Minimal error classes (adapted from OpenRouter SDK's models/errors/)
// ---------------------------------------------------------------------------
/** Base class for all HTTP error responses */
export class ResponseError extends Error {
    statusCode;
    body;
    headers;
    contentType;
    rawResponse;
    constructor(message, httpMeta) {
        super(message);
        this.statusCode = httpMeta.response.status;
        this.body = httpMeta.body;
        this.headers = httpMeta.response.headers;
        this.contentType = httpMeta.response.headers.get('content-type') || '';
        this.rawResponse = httpMeta.response;
        this.name = 'ResponseError';
    }
}
/** Fallback error when no more-specific error class matches */
export class DefaultResponseError extends ResponseError {
    constructor(message, httpMeta) {
        if (message) {
            message += ': ';
        }
        message += `Status ${httpMeta.response.status}`;
        const contentType = httpMeta.response.headers.get('content-type') || '""';
        if (contentType !== 'application/json') {
            message += ` Content-Type ${contentType.includes(' ') ? `"${contentType}"` : contentType}`;
        }
        const body = httpMeta.body || '""';
        message += body.length > 100 ? '\n' : '. ';
        let bodyDisplay = body;
        if (body.length > 10000) {
            const truncated = body.substring(0, 10000);
            const remaining = body.length - 10000;
            bodyDisplay = `${truncated}...and ${remaining} more chars`;
        }
        message += `Body: ${bodyDisplay}`;
        message = message.trim();
        super(message, httpMeta);
        this.name = 'DefaultResponseError';
    }
}
/** Thrown when a response fails schema validation */
export class ResponseValidationError extends ResponseError {
    rawValue;
    rawMessage;
    constructor(message, extra) {
        super(message, extra);
        this.name = 'ResponseValidationError';
        this.cause = extra.cause;
        this.rawValue = extra.rawValue;
        this.rawMessage = extra.rawMessage;
    }
}
const mediaParamSeparator = /\s*;\s*/g;
/**
 * Check if a response content-type matches a pattern.
 * Supports wildcards like * / * , application/*, etc.
 * Also validates media-type parameters (e.g. charset=utf-8).
 */
export function matchContentType(response, pattern) {
    if (pattern === '*')
        return true;
    let contentType = response.headers.get('content-type')?.trim() || 'application/octet-stream';
    contentType = contentType.toLowerCase();
    const wantParts = pattern.toLowerCase().trim().split(mediaParamSeparator);
    const [wantType = '', ...wantParams] = wantParts;
    if (wantType.split('/').length !== 2)
        return false;
    const gotParts = contentType.split(mediaParamSeparator);
    const [gotType = '', ...gotParams] = gotParts;
    const [type = '', subtype = ''] = gotType.split('/');
    if (!type || !subtype)
        return false;
    if (wantType !== '*/*' &&
        gotType !== wantType &&
        `${type}/*` !== wantType &&
        `*/${subtype}` !== wantType) {
        return false;
    }
    if (gotParams.length < wantParams.length)
        return false;
    const params = new Set(gotParams);
    for (const wantParam of wantParams) {
        if (!params.has(wantParam))
            return false;
    }
    return true;
}
const codeRangeRE = /^[0-9]xx$/i;
/**
 * Check if a response status code matches a predicate.
 * Supports exact codes (200), ranges (4xx, 5xx), 'default', and arrays.
 */
export function matchStatusCode(response, codes) {
    const actual = `${response.status}`;
    const expectedCodes = Array.isArray(codes) ? codes : [codes];
    if (!expectedCodes.length)
        return false;
    return expectedCodes.some((ec) => {
        const code = `${ec}`;
        if (code === 'default')
            return true;
        if (!codeRangeRE.test(code))
            return code === actual;
        const expectFamily = code.charAt(0);
        if (!expectFamily)
            throw new Error('Invalid status code range');
        const actualFamily = actual.charAt(0);
        if (!actualFamily)
            throw new Error(`Invalid response status code: ${actual}`);
        return actualFamily === expectFamily;
    });
}
/**
 * Combined check: status code AND content-type both match.
 */
export function matchResponse(response, code, contentTypePattern) {
    return (matchStatusCode(response, code) && matchContentType(response, contentTypePattern));
}
// ---------------------------------------------------------------------------
// isPlainObject (ported from sindresorhus/is-plain-obj, MIT license)
// ---------------------------------------------------------------------------
export function isPlainObject(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const prototype = Object.getPrototypeOf(value);
    return ((prototype === null ||
        prototype === Object.prototype ||
        Object.getPrototypeOf(prototype) === null) &&
        !(Symbol.toStringTag in value) &&
        !(Symbol.iterator in value));
}
const DEFAULT_CONTENT_TYPES = {
    jsonl: 'application/jsonl',
    json: 'application/json',
    text: 'text/plain',
    bytes: 'application/octet-stream',
    stream: 'application/octet-stream',
    sse: 'text/event-stream',
    nil: '*',
    fail: '*',
};
// -- Matcher factory functions -----------------------------------------------
export function jsonErr(codes, schema, options) {
    return { ...options, err: true, enc: 'json', codes, schema };
}
export function json(codes, schema, options) {
    return { ...options, enc: 'json', codes, schema };
}
export function jsonl(codes, schema, options) {
    return { ...options, enc: 'jsonl', codes, schema };
}
export function jsonlErr(codes, schema, options) {
    return { ...options, err: true, enc: 'jsonl', codes, schema };
}
export function textErr(codes, schema, options) {
    return { ...options, err: true, enc: 'text', codes, schema };
}
export function text(codes, schema, options) {
    return { ...options, enc: 'text', codes, schema };
}
export function bytesErr(codes, schema, options) {
    return { ...options, err: true, enc: 'bytes', codes, schema };
}
export function bytes(codes, schema, options) {
    return { ...options, enc: 'bytes', codes, schema };
}
export function streamErr(codes, schema, options) {
    return { ...options, err: true, enc: 'stream', codes, schema };
}
export function stream(codes, schema, options) {
    return { ...options, enc: 'stream', codes, schema };
}
export function sseErr(codes, schema, options) {
    return { ...options, err: true, enc: 'sse', codes, schema };
}
export function sse(codes, schema, options) {
    return { ...options, enc: 'sse', codes, schema };
}
export function nilErr(codes, schema, options) {
    return { ...options, err: true, enc: 'nil', codes, schema };
}
export function nil(codes, schema, options) {
    return { ...options, enc: 'nil', codes, schema };
}
export function fail(codes) {
    return { enc: 'fail', codes };
}
// -- Core match() function ---------------------------------------------------
export function match(...matchers) {
    return async function matchFunc(response, request, options) {
        let raw;
        let matcher;
        for (const m of matchers) {
            const { codes } = m;
            const ctpattern = 'ctype' in m ? m.ctype : DEFAULT_CONTENT_TYPES[m.enc];
            if (ctpattern && matchResponse(response, codes, ctpattern)) {
                matcher = m;
                break;
            }
            else if (!ctpattern && matchStatusCode(response, codes)) {
                matcher = m;
                break;
            }
        }
        if (!matcher) {
            return [
                {
                    ok: false,
                    error: new DefaultResponseError('Unexpected Status or Content-Type', {
                        response,
                        request,
                        body: await response.text().catch(() => ''),
                    }),
                },
                raw,
            ];
        }
        const encoding = matcher.enc;
        let body = '';
        switch (encoding) {
            case 'json':
                body = await response.text();
                raw = JSON.parse(body);
                break;
            case 'jsonl':
                raw = response.body;
                break;
            case 'bytes':
                raw = new Uint8Array(await response.arrayBuffer());
                break;
            case 'stream':
                raw = response.body;
                break;
            case 'text':
                body = await response.text();
                raw = body;
                break;
            case 'sse':
                raw = response.body;
                break;
            case 'nil':
                body = await response.text();
                raw = undefined;
                break;
            case 'fail':
                body = await response.text();
                raw = body;
                break;
            default:
                throw new Error(`Unsupported response type: ${encoding}`);
        }
        if (matcher.enc === 'fail') {
            return [
                {
                    ok: false,
                    error: new DefaultResponseError('API error occurred', {
                        request,
                        response,
                        body,
                    }),
                },
                raw,
            ];
        }
        const resultKey = matcher.key || options?.resultKey;
        let data;
        if ('err' in matcher) {
            data = {
                ...options?.extraFields,
                ...(matcher.hdrs
                    ? { Headers: unpackHeaders(response.headers) }
                    : null),
                ...(isPlainObject(raw) ? raw : null),
                request$: request,
                response$: response,
                body$: body,
            };
        }
        else if (resultKey) {
            data = {
                ...options?.extraFields,
                ...(matcher.hdrs
                    ? { Headers: unpackHeaders(response.headers) }
                    : null),
                [resultKey]: raw,
            };
        }
        else if (matcher.hdrs) {
            data = {
                ...options?.extraFields,
                ...(matcher.hdrs
                    ? { Headers: unpackHeaders(response.headers) }
                    : null),
                ...(isPlainObject(raw) ? raw : null),
            };
        }
        else {
            data = raw;
        }
        if ('err' in matcher) {
            const result = safeParseResponse(data, (v) => matcher.schema.parse(v), 'Response validation failed', { request, response, body });
            return [result.ok ? { ok: false, error: result.value } : result, raw];
        }
        else {
            return [
                safeParseResponse(data, (v) => matcher.schema.parse(v), 'Response validation failed', { request, response, body }),
                raw,
            ];
        }
    };
}
// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const headerValRE = /, */;
/**
 * Iterates over a Headers object and returns an object with all the header
 * entries. Values are represented as an array to account for repeated headers.
 */
export function unpackHeaders(headers) {
    const out = {};
    for (const [k, v] of headers.entries()) {
        out[k] = v.split(headerValRE);
    }
    return out;
}
function safeParseResponse(rawValue, fn, errorMessage, httpMeta) {
    try {
        return OK(fn(rawValue));
    }
    catch (err) {
        return ERR(new ResponseValidationError(errorMessage, {
            cause: err,
            rawValue,
            rawMessage: errorMessage,
            ...httpMeta,
        }));
    }
}
// Re-export HTTP matchers with aliases to avoid name conflicts with http-hooks.ts
export { matchContentType as matchContentTypeStrict };
export { matchStatusCode as matchStatusCodeStrict };
//# sourceMappingURL=response-matcher.js.map