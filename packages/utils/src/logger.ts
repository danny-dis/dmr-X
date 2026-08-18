import pino from 'pino';

declare const Bun: unknown | undefined;
const isBun = typeof Bun !== 'undefined';

/**
 * Headers whose values may contain secrets and must never be written to logs.
 * Applied via pino's redact + the req serializer, so both structured fields
 * and the serialized request object are scrubbed.
 */
const SENSITIVE_HEADERS = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];

/** Build a sanitized headers object with sensitive values replaced by '[REDACTED]'. */
function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.includes(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

/** Serialize a Fastify/Node request into a log-safe shape (no raw headers, no secrets). */
function serializeReq(req: any): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    method: req.method,
    url: req.url,
    requestId: req.id,
  };
  if (req.headers) {
    serialized.headers = sanitizeHeaders(req.headers as Record<string, unknown>);
  }
  if (req.params && Object.keys(req.params).length > 0) {
    serialized.params = req.params;
  }
  if (req.query && Object.keys(req.query).length > 0) {
    serialized.query = req.query;
  }
  return serialized;
}

export function createLogger(name: string): pino.Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    transport:
      !isBun && process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    // H1 — redact sensitive header values even when callers pass the raw req
    // object (e.g. `logger.error({ err, req: request })`). Without this, pino
    // serializes `IncomingMessage.rawHeaders`, leaking API keys on every error.
    redact: {
      // Bracket notation — fast-redact rejects hyphens in bare path segments
      // (e.g. `req.headers.x-api-key`), so express each header as a quoted key.
      paths: SENSITIVE_HEADERS.map((h) => `req.headers['${h}']`),
      censor: '[REDACTED]',
    },
    serializers: {
      // Strip the raw request down to a log-safe shape: method, url, requestId,
      // and sanitized headers. Never serialize the full IncomingMessage.
      req: serializeReq,
    },
  });
}

export const logger = createLogger('dmr-x');
