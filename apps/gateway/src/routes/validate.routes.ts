import { getDb } from '@dmr-x/db';
import { verifyApiKey, hashApiKey } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';

import { LOCAL_MODE } from '../middleware/auth.middleware.js';

export async function validateRoutes(server: FastifyInstance): Promise<void> {
  server.get('/validate', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const xApiKey = request.headers['x-api-key'];

    let token: string | undefined;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim() || undefined;
    }
    if (!token && typeof xApiKey === 'string') {
      token = xApiKey.trim() || undefined;
    }

    if (!token) {
      reply.status(401);
      return { valid: false, error: 'Missing API key' };
    }

    // Admin key check
    const adminKey = process.env.DMRX_ADMIN_API_KEY;
    if (adminKey && token === adminKey) {
      return { valid: true, type: 'admin' };
    }

    // Local mode: any key is valid
    if (LOCAL_MODE) {
      return { valid: true, type: 'local' };
    }

    // Tenant API key check — O(1) indexed lookup on key_lookup_hash
    // (migration 064) instead of scanning every active key. Falls back to a
    // bounded scan over rows missing the lookup hash (legacy salted keys
    // created before 064 that can't be backfilled without plaintext).
    const db = getDb();
    const lookupHash = hashApiKey(token);

    const found = db.prepare(
      `SELECT ak.id, ak.key_hash, t.name as tenant_name
       FROM api_keys ak
       JOIN tenants t ON t.id = ak.tenant_id
       WHERE ak.key_lookup_hash = ?
         AND ak.is_active = 1
         AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))`
    ).get(lookupHash) as { id: string; key_hash: string; tenant_name: string } | undefined;

    if (found && verifyApiKey(token, found.key_hash)) {
      return { valid: true, type: 'tenant', tenant: found.tenant_name };
    }

    const legacyRows = db.prepare(
      `SELECT ak.id, ak.key_hash, t.name as tenant_name
       FROM api_keys ak
       JOIN tenants t ON t.id = ak.tenant_id
       WHERE ak.key_lookup_hash IS NULL
         AND ak.is_active = 1
         AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))`
    ).all() as Array<{ id: string; key_hash: string; tenant_name: string }>;

    for (const key of legacyRows) {
      if (verifyApiKey(token, key.key_hash)) {
        return {
          valid: true,
          type: 'tenant',
          tenant: key.tenant_name,
        };
      }
    }

    reply.status(401);
    return { valid: false, error: 'Invalid or expired API key' };
  });
}
