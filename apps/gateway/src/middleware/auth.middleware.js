import { getPool } from '@dmr-x/db';
import { hashApiKey } from '@dmr-x/utils';
import { AuthenticationError } from '@dmr-x/core';
// Routes that don't require auth
const PUBLIC_ROUTES = new Set(['/health', '/v1/models']);
export async function authMiddleware(server) {
    server.addHook('onRequest', async (request, reply) => {
        // Skip auth for public routes
        if (PUBLIC_ROUTES.has(request.url)) {
            return;
        }
        // Skip auth for admin routes (should have their own auth in production)
        if (request.url.startsWith('/v1/admin')) {
            return;
        }
        let apiKey;
        const authHeader = request.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            apiKey = authHeader.slice(7);
        }
        else if (request.headers['x-api-key']) {
            apiKey = request.headers['x-api-key'];
        }
        if (!apiKey) {
            throw new AuthenticationError('Missing or invalid Authorization header');
        }
        const keyHash = hashApiKey(apiKey);
        const pool = getPool();
        const result = await pool.query(`SELECT ak.id, ak.tenant_id, t.name as tenant_name
       FROM api_keys ak
       JOIN tenants t ON t.id = ak.tenant_id
       WHERE ak.key_hash = $1 AND ak.is_active = true`, [keyHash]);
        if (result.rows.length === 0) {
            throw new AuthenticationError('Invalid API key');
        }
        // Attach tenant info to request
        request.tenant = {
            id: result.rows[0].tenant_id,
            name: result.rows[0].tenant_name,
            apiKeyId: result.rows[0].id,
        };
        // Update last_used_at
        await pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [result.rows[0].id]);
    });
}
//# sourceMappingURL=auth.middleware.js.map