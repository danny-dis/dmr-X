import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '@dmr-x/db';
import { hashApiKey } from '@dmr-x/utils';
import { AuthenticationError } from '@dmr-x/core';

// Routes that don't require auth
const PUBLIC_ROUTES = new Set(['/health', '/healthz', '/livez', '/ready', '/v1/models']);

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

  server.addHook('onRequest', async (request, reply) => {
    // Skip auth for public routes
    if (PUBLIC_ROUTES.has(request.url)) {
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

    const pool = getPool();
    const result = await pool.query(
      `SELECT ak.id, ak.tenant_id, t.name as tenant_name
       FROM api_keys ak
       JOIN tenants t ON t.id = ak.tenant_id
       WHERE ak.key_hash = $1 AND ak.is_active = true`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      throw new AuthenticationError('Invalid API key');
    }

    // Attach tenant info to request
    (request as any).tenant = {
      id: result.rows[0].tenant_id,
      name: result.rows[0].tenant_name,
      apiKeyId: result.rows[0].id,
    };

    // Update last_used_at
    await pool.query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
      [result.rows[0].id]
    );
  });
}
