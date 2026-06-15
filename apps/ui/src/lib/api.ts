const RAW_BASE = ((import.meta as ImportMeta & { env: Record<string, string | undefined> }).env?.VITE_API_BASE ?? '') as string;
const BASE = RAW_BASE.replace(/\/+$/, '');
const RAW_ADMIN_KEY = ((import.meta as ImportMeta & { env: Record<string, string | undefined> }).env?.VITE_ADMIN_API_KEY ?? '') as string;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = BASE || '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const apiPath =
    base || normalizedPath.startsWith('/v1') || normalizedPath.startsWith('/health') ||
    normalizedPath.startsWith('/ready') || normalizedPath.startsWith('/livez')
      ? normalizedPath
      : `/v1${normalizedPath}`;
  const url = new URL(
    (base ? base : '') + apiPath,
    base ? undefined : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'),
  );
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function getAuthToken(): string | null {
  try {
    return localStorage.getItem('dmrx_token') || RAW_ADMIN_KEY || null;
  } catch {
    return RAW_ADMIN_KEY || null;
  }
}

function getTenantToken(): string | null {
  try {
    return localStorage.getItem('dmrx_tenant_token') || null;
  } catch {
    return null;
  }
}

function isAdminPath(path: string): boolean {
  return path.startsWith('/v1/admin') || path.startsWith('/admin');
}

function getTokenForPath(path: string): string | null {
  if (isAdminPath(path)) return getAuthToken();
  // Tenant routes prefer the tenant token, fall back to admin only for
  // dev convenience (LOCAL_MODE-bypass). In production the admin key is
  // not a valid tenant key, so callers must set dmrx_tenant_token.
  return getTenantToken() ?? getAuthToken();
}

export function setTenantToken(token: string | null): void {
  try {
    if (token) localStorage.setItem('dmrx_tenant_token', token);
    else localStorage.removeItem('dmrx_tenant_token');
  } catch {
    // ignore
  }
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, headers = {}, signal, timeoutMs = 30_000 } = opts;
  const controller = signal ? null : new AbortController();
  const sig = signal ?? controller?.signal;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (controller) {
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const res = await fetch(buildUrl(path, query), {
      method,
      signal: sig,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(getTokenForPath(path) ? { Authorization: `Bearer ${getTokenForPath(path)}` } : {}),
        ...headers,
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      // Build a useful message from the body so "Request failed: 500"
      // never reaches the user without context. The backend can return
      // several shapes — try them in this order, preferring the one that
      // is most likely to carry the user-actionable detail:
      //
      //   1. { message: "<detail>" }           (Fastify default error envelope)
      //   2. { error: { message: "<detail>" }} (custom error handler envelope)
      //   3. { error: "<detail>" }             (custom notFoundHandler / string)
      //   4. fall back to a generic status line
      //
      // Picking `error` (a string) before `message` was a bug: the
      // gateway's Fastify default envelope puts the HTTP status text
      // ("Bad Request", "Unauthorized", …) in `error` and the helpful
      // detail in `message`, so the old order surfaced "Bad Request"
      // for any 400.
      let bodyMessage: string | null = null;
      if (parsed && typeof parsed === 'object') {
        const p = parsed as Record<string, unknown>;
        if (typeof p.message === 'string' && p.message.length > 0) {
          bodyMessage = p.message;
        } else {
          const e = p.error;
          if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).message === 'string') {
            bodyMessage = String((e as Record<string, unknown>).message);
          } else if (typeof e === 'string' && e.length > 0) {
            bodyMessage = e;
          }
        }
      }
      const message = bodyMessage ?? `Request failed: ${res.status}`;
      throw new ApiError(message, res.status, parsed);
    }
    return parsed as T;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const apiGet = <T,>(path: string, query?: RequestOptions['query']) =>
  api<T>(path, { method: 'GET', query });

export const apiPost = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body });

export const apiPut = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body });

export const apiDelete = <T,>(path: string) =>
  api<T>(path, { method: 'DELETE' });
