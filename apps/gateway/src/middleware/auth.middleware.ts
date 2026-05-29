import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getDb } from '@dmr-x/db';
import { hashApiKey } from '@dmr-x/utils';
import { AuthenticationError } from '@dmr-x/core';

// Routes that don't require auth
const PUBLIC_ROUTES = new Set(['/health', '/healthz', '/livez', '/ready', '/v1/models']);

const LOCAL_MODE = process.env.DMRX_LOCAL_MODE === 'true';

function extractApiKey(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (request.headers['x-api-key']) {
    return request.headers['x-api-key'] as string;
  }
  return undefined;
}

export async function authMiddleware(server: FastifyInstance): Promise<void> {
  const adminApiKey = process.env.DMRX_ADMIN_API_KEY;

  server.addHook('onRequest', async (request) => {
    // Skip auth for public routes
    if (PUBLIC_ROUTES.has(request.url)) {
      return;
    }

    // Local mode: skip auth entirely, set default tenant
    if (LOCAL_MODE) {
      const db = getDb();
      const tenant = db.prepare('SELECT id, name FROM tenants LIMIT 1').get() as { id: string; name: string } | undefined;
      (request as any).tenant = {
        id: tenant?.id ?? 'local',
        name: tenant?.name ?? 'local',
        apiKeyId: 'local',
      };
      return;
    }

    // Admin routes require admin API key
    if (request.url.startsWith('/v1/admin')) {
      if (!adminApiKey) {
        throw new AuthenticationError('Admin API not configured');
      }
      const apiKey = extractApiKey(request);
      if (!apiKey || apiKey !== adminApiKey) {
        throw new AuthenticationError('Invalid admin API key');
      }
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
