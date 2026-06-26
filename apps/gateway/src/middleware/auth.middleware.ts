import { timingSafeEqual } from 'node:crypto';

import { AuthenticationError } from '@dmr-x/core';
import { getDb } from '@dmr-x/db';
import { hashApiKey, verifyApiKey, logger } from '@dmr-x/utils';
import type { FastifyInstance, FastifyRequest } from 'fastify';

// Debounced last_used_at: module-level cache keyed by api_key id.
// Avoids SQLite write contention on every authenticated request.
// Capped at 10 000 entries; oldest are evicted when the limit is hit.
const lastUsedAtCache = new Map<string, number>();
const LAST_USED_CACHE_MAX = 10_000;

// Routes that don't require auth.
const PUBLIC_ROUTES = new Set(['/health', '/healthz', '/livez', '/ready', '/v1/models']);
const PUBLIC_PREFIXES = ['/assets/'];
const PUBLIC_FILE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.ico',
  '.js',
  '.json',
  '.map',
  '.png',
  '.svg',
  '.txt',
  '.webmanifest',
  '.woff',
  '.woff2',
]);

// WARNING: Local mode disables all authentication. Never enable in production.
//
// CRIT-2: DMRX_LOCAL_MODE is read exactly ONCE, at module load, and frozen
// into a module-level constant. The previous implementation re-read
// process.env on every single request, which meant any code path that
// mutated process.env (or a child process that inherited the env) could
// flip the auth bypass live, without a restart, and without being
// observable in the startup log. To toggle local mode, restart the gateway.
export const LOCAL_MODE = process.env.DMRX_LOCAL_MODE === 'true';
logger.info({ localMode: LOCAL_MODE, adminKeySet: !!process.env.DMRX_ADMIN_API_KEY, envValue: process.env.DMRX_LOCAL_MODE }, 'Auth middleware status');

function extractApiKey(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    return bearerToken.length > 0 ? bearerToken : undefined;
  }

  const headerApiKey = request.headers['x-api-key'];
  if (Array.isArray(headerApiKey)) {
    const apiKey = headerApiKey.find(value => value.trim().length > 0)?.trim();
    return apiKey || undefined;
  }
  if (typeof headerApiKey === 'string') {
    const apiKey = headerApiKey.trim();
    return apiKey.length > 0 ? apiKey : undefined;
  }

  return undefined;
}

function isPublicPath(pathname: string, method: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))) return true;
  if (pathname === '/') return true;
  // Non-API GET requests are public (SPA assets, etc.)
  if (method === 'GET' && !pathname.startsWith('/v1/')) return true;
  // File-extension check only for non-API paths — API routes with dotted
  // segments (e.g. /v1/admin/config.json) must not bypass auth.
  if (pathname.startsWith('/v1/')) return false;
  const extension = pathname.includes('.') ? pathname.slice(pathname.lastIndexOf('.')).toLowerCase() : '';
  return PUBLIC_FILE_EXTENSIONS.has(extension);
}

export async function authMiddleware(server: FastifyInstance): Promise<void> {
  server.addHook('onRequest', async (request) => {
    // Skip auth for public routes (strip query string so /v1/models?limit=10 still matches)
    const pathname = request.url.split('?')[0];
    if (isPublicPath(pathname, request.method)) {
      return;
    }

    // Re-read the admin key on every request so a runtime rotation
    // (see POST /v1/admin/security/rotate-admin-key) takes effect immediately
    // instead of requiring a gateway restart.
    const adminApiKey = process.env.DMRX_ADMIN_API_KEY;
    // LOCAL_MODE is intentionally frozen at module load (see top of file)
    // so a runtime mutation of process.env cannot flip the auth bypass.
    // Toggling local mode requires a gateway restart.

    // Admin routes: skip auth in local mode for UI access
    if (pathname.startsWith('/v1/admin')) {
      if (LOCAL_MODE) return;
      if (!adminApiKey || adminApiKey === 'replace-with-admin-key') {
        logger.error('Admin API accessed but DMRX_ADMIN_API_KEY is not set or default. Blocking for safety.');
        (server as any).recordTelemetryEvent?.({
          level: 'warning',
          service: 'gateway',
          message: 'Admin API accessed but admin key is not configured',
          metadata: { path: pathname, reason: 'admin_key_unset' },
        });
        throw new AuthenticationError('Admin API is disabled (no secure key configured)');
      }
      const apiKey = extractApiKey(request);
      if (!apiKey) {
        (server as any).recordTelemetryEvent?.({
          level: 'warning',
          service: 'gateway',
          message: 'Admin API request missing API key',
          metadata: { path: pathname, reason: 'admin_key_missing' },
        });
        throw new AuthenticationError('Invalid admin API key');
      }
      const keyBuf = Buffer.from(apiKey);
      const adminBuf = Buffer.from(adminApiKey);
      // Compare lengths first (leaks length timing, but admin key length is
      // fixed per deployment and not secret), then use timing-safe comparison
      // on the actual values. The previous zero-padding scheme allowed
      // null-byte appended keys to match.
      if (keyBuf.length !== adminBuf.length || !timingSafeEqual(keyBuf, adminBuf)) {
        (server as any).recordTelemetryEvent?.({
          level: 'warning',
          service: 'gateway',
          message: 'Admin API key mismatch',
          metadata: { path: pathname, reason: 'admin_key_invalid' },
        });
        throw new AuthenticationError('Invalid admin API key');
      }
      return;
    }

    // Local mode: skip tenant API key check for public API routes only
    if (LOCAL_MODE) {
      logger.warn('LOCAL MODE ACTIVE — tenant API key check is disabled. Do not use in production.');
      const db = getDb();
      const tenant = db.prepare('SELECT id, name FROM tenants LIMIT 1').get() as { id: string; name: string } | undefined;
      (request as any).tenant = {
        id: tenant?.id ?? 'local',
        name: tenant?.name ?? 'local',
        apiKeyId: 'local',
      };
      return;
    }

    // All other routes require tenant API key
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      (server as any).recordTelemetryEvent?.({
        level: 'warning',
        service: 'gateway',
        message: 'Tenant API request missing Authorization header',
        metadata: { path: pathname, reason: 'tenant_key_missing' },
      });
      throw new AuthenticationError('Missing or invalid Authorization header');
    }

    const db = getDb();

    // Fetch all active API key hashes for verification
    // This supports both legacy unsalted hashes and new salted hashes
    // Also check expires_at to reject expired keys
    const activeKeys = db.prepare(
      `SELECT ak.id, ak.key_hash, ak.tenant_id, t.name as tenant_name
       FROM api_keys ak
       JOIN tenants t ON t.id = ak.tenant_id
       WHERE ak.is_active = 1
         AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))`
    ).all() as Array<{ id: string; key_hash: string; tenant_id: string; tenant_name: string }>;

    // Find matching key using constant-time comparison
    let matchedKey: typeof activeKeys[0] | undefined;
    for (const key of activeKeys) {
      if (verifyApiKey(apiKey, key.key_hash)) {
        matchedKey = key;
        break;
      }
    }

    if (!matchedKey) {
      (server as any).recordTelemetryEvent?.({
        level: 'warning',
        service: 'gateway',
        message: 'Tenant API key not found or inactive',
        metadata: { path: pathname, reason: 'tenant_key_invalid' },
      });
      throw new AuthenticationError('Invalid API key');
    }

    // Attach tenant info to request
    (request as any).tenant = {
      id: matchedKey.tenant_id,
      name: matchedKey.tenant_name,
      apiKeyId: matchedKey.id,
    };

    // Debounced last_used_at update: only update if >5 minutes since last update
    // to avoid SQLite write contention on the hot path. Uses a module-level cache
    // instead of request-scoped state so the debounce persists across requests.
    const now = Date.now();
    const lastUsed = lastUsedAtCache.get(matchedKey.id);
    if (!lastUsed || now - lastUsed > 5 * 60 * 1000) {
      db.prepare(
        "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?"
      ).run(matchedKey.id);
      if (lastUsedAtCache.size >= LAST_USED_CACHE_MAX) {
        lastUsedAtCache.clear();
      }
      lastUsedAtCache.set(matchedKey.id, now);
    }
  });
}

// Ensure middleware is not encapsulated so hooks apply to all routes
(authMiddleware as any)[Symbol.for('skip-override')] = true;
