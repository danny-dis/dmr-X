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
        ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
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
      const message =
        (parsed && typeof parsed === 'object' && 'error' in (parsed as Record<string, unknown>)
          ? String((parsed as Record<string, unknown>).error)
          : null) ?? `Request failed: ${res.status}`;
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
