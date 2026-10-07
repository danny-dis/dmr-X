import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

// Real loopback HTTP and real SQLite; authentication principals below are
// deliberate test fixtures, not a test of production credential issuance.
const db = new DatabaseSync(':memory:');
vi.mock('@dmr-x/db', () => ({ getDb: () => db }));
vi.mock('@dmr-x/utils', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../apps/gateway/src/middleware/auth.middleware.js', () => ({
  cachedAdminKey: 'isolated-canary-admin-key', LOCAL_MODE: false, DEPLOYMENT_MODE: 'self-hosted',
}));
import { compressionRoutes } from '../../apps/gateway/src/routes/compression.routes.js';
import { compressionService } from '../../apps/gateway/src/services/compression.js';

afterAll(() => { vi.restoreAllMocks(); db.close(); });
afterEach(() => {
  vi.restoreAllMocks();
  db.exec('DROP TABLE IF EXISTS compression_cache; DROP TABLE IF EXISTS settings; DROP TABLE IF EXISTS tenants; DROP TABLE IF EXISTS api_keys;');
});

describe('isolated compression HTTP canary', () => {
  it('enforces admin privacy and owner-bound original round trips over HTTP', async () => {
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
      INSERT INTO settings VALUES ('compression_config', '{"enabled":true,"proxyUrl":"https://proxy.example","apiKey":"canary-only-test-secret","reversible":true,"minTokensToCompress":1,"engine":"rtk"}', datetime('now'));
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE api_keys (id TEXT PRIMARY KEY, tenant_id TEXT);
      INSERT INTO tenants VALUES ('tenant-a'), ('tenant-b');
      INSERT INTO api_keys VALUES ('key-a', 'tenant-a'), ('key-b', 'tenant-b');
      CREATE TABLE compression_cache (
        id TEXT PRIMARY KEY, original_content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL, tenant_id TEXT, api_key_id TEXT
      );
    `);
    vi.spyOn(compressionService, 'getGlobalConfig').mockReturnValue({
      enabled: true, engine: 'rtk', reversible: true, minTokensToCompress: 1,
      proxyUrl: 'https://proxy.example', apiKey: 'canary-only-test-secret',
    });
    const app = Fastify();
    app.addHook('onRequest', async request => {
      const tenantId = request.headers['x-canary-tenant'];
      const apiKeyId = request.headers['x-canary-key'];
      if (typeof tenantId === 'string' && typeof apiKeyId === 'string') {
        (request as any).tenant = { id: tenantId, apiKeyId, role: 'user' };
      }
    });
    await app.register(compressionRoutes, { prefix: '/v1' });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const anonymous = await fetch(`${address}/v1/compression/config`);
      expect(anonymous.status).toBe(401);
      expect(await anonymous.text()).not.toContain('canary-only-test-secret');
      const admin = await fetch(`${address}/v1/compression/config`, { headers: { authorization: 'Bearer isolated-canary-admin-key' } });
      expect(admin.status).toBe(200);
      expect(await admin.text()).not.toContain('canary-only-test-secret');
      const original = [
        { role: 'system', content: 'Preserve all instructions.' },
        { role: 'assistant', content: 'Historical answer. '.repeat(100), name: 'history' },
        { role: 'user', content: 'Return CASE-42 exactly.', name: 'current' },
      ];
      const compressed = await compressionService.compressPrompt(original, null, null, { tenantId: 'tenant-a', apiKeyId: 'key-a' });
      expect(compressed.metadata.compressedId).toBeTruthy();
      const retrieve = (tenantId: string, apiKeyId: string) => fetch(`${address}/v1/compression/retrieve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-canary-tenant': tenantId, 'x-canary-key': apiKeyId },
        body: JSON.stringify({ compressedId: compressed.metadata.compressedId }),
      });
      const owner = await retrieve('tenant-a', 'key-a');
      expect(owner.status).toBe(200);
      expect((await owner.json() as { original: unknown }).original).toEqual(original);
      const stranger = await retrieve('tenant-b', 'key-b');
      expect(stranger.status).toBe(404);
      db.prepare("UPDATE compression_cache SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(compressed.metadata.compressedId!);
      const expired = await retrieve('tenant-a', 'key-a');
      expect(expired.status).toBe(404);
    } finally { await app.close(); }
  });
});
