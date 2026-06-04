const RAW_BASE = (import.meta.env?.VITE_API_BASE ?? '');
const BASE = RAW_BASE.replace(/\/+$/, '');
const RAW_ADMIN_KEY = (import.meta.env?.VITE_ADMIN_API_KEY ?? '');
export class ApiError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
    }
}
function buildUrl(path, query) {
    const base = BASE || '';
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const apiPath = base || normalizedPath.startsWith('/v1') || normalizedPath.startsWith('/health') ||
        normalizedPath.startsWith('/ready') || normalizedPath.startsWith('/livez')
        ? normalizedPath
        : `/v1${normalizedPath}`;
    const url = new URL((base ? base : '') + apiPath, base ? undefined : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'));
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v === undefined || v === null)
                continue;
            url.searchParams.set(k, String(v));
        }
    }
    return url.toString();
}
function getAuthToken() {
    try {
        return localStorage.getItem('dmrx_token') || RAW_ADMIN_KEY || null;
    }
    catch {
        return RAW_ADMIN_KEY || null;
    }
}
export async function api(path, opts = {}) {
    const { method = 'GET', body, query, headers = {}, signal, timeoutMs = 30_000 } = opts;
    const controller = signal ? null : new AbortController();
    const sig = signal ?? controller?.signal;
    let timeout;
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
        let parsed = undefined;
        if (text) {
            try {
                parsed = JSON.parse(text);
            }
            catch {
                parsed = text;
            }
        }
        if (!res.ok) {
            const message = (parsed && typeof parsed === 'object' && 'error' in parsed
                ? String(parsed.error)
                : null) ?? `Request failed: ${res.status}`;
            throw new ApiError(message, res.status, parsed);
        }
        return parsed;
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
export const apiGet = (path, query) => api(path, { method: 'GET', query });
export const apiPost = (path, body) => api(path, { method: 'POST', body });
export const apiPut = (path, body) => api(path, { method: 'PUT', body });
export const apiDelete = (path) => api(path, { method: 'DELETE' });
//# sourceMappingURL=api.js.map