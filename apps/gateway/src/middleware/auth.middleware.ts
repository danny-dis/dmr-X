import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getDb } from '@dmr-x/db';
import { hashApiKey, logger } from '@dmr-x/utils';
import { AuthenticationError } from '@dmr-x/core';

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
const LOCAL_MODE = process.env.DMRX_LOCAL_MODE === 'true';
logger.info({ localMode: LOCAL_MODE, adminKeySet: !!process.env.DMRX_ADMIN_API_KEY }, 'Auth middleware status');

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
  if (method === 'GET' && !pathname.startsWith('/v1/')) return true;

  const extension = pathname.includes('.') ? pathname.slice(pathname.lastIndexOf('.')).toLowerCase() : '';
  return PUBLIC_FILE_EXTENSIONS.has(extension);
}

export async function authMiddleware(server: FastifyInstance): Promise<void> {
  const adminApiKey = process.env.DMRX_ADMIN_API_KEY;

  server.addHook('onRequest', async (request) => {
    // Skip auth for public routes (strip query string so /v1/models?limit=10 still matches)
    const pathname = request.url.split('?')[0];
    if (isPublicPath(pathname, request.method)) {
      return;
    }

    // Admin routes: skip auth in local mode for UI access
    if (pathname.startsWith('/v1/admin')) {
      if (LOCAL_MODE) return;
      if (!adminApiKey || adminApiKey === 'replace-with-admin-key') {
        logger.error('Admin API accessed but DMRX_ADMIN_API_KEY is not set or default. Blocking for safety.');
        throw new AuthenticationError('Admin API is disabled (no secure key configured)');
      }
      const apiKey = extractApiKey(request);
      if (!apiKey) {
        throw new AuthenticationError('Invalid admin API key');
      }
      const keyBuf = Buffer.from(apiKey);
      const adminBuf = Buffer.from(adminApiKey);
      if (keyBuf.length !== adminBuf.length || !timingSafeEqual(keyBuf, adminBuf)) {
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
      throw new AuthenticationError('Missing or invalid Authorization header');
    }
    const keyHash = hashApiKey(apiKey);

    const db = getDb();
    const row = db.prepare(
      `SELECT ak.id, ak.tenant_id, t.name as tenant_name
       FROM api_keys ak
       JOIN tenants t ON t.id = ak.tenant_id
       WHERE ak.key_hash = ? AND ak.is_active = 1`
    ).get(keyHash) as { id: string; tenant_id: string; tenant_name: string } | undefined;

    if (!row) {
      throw new AuthenticationError('Invalid API key');
    }

    // Attach tenant info to request
    (request as any).tenant = {
      id: row.tenant_id,
      name: row.tenant_name,
      apiKeyId: row.id,
    };

    // Update last_used_at
    db.prepare(
      "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?"
    ).run(row.id);
  });
}

// Ensure middleware is not encapsulated so hooks apply to all routes
(authMiddleware as any)[Symbol.for('skip-override')] = true;
