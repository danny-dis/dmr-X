import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mode = vi.hoisted(() => ({ local: false, managed: false }));
const db = new DatabaseSync(':memory:');
vi.mock('@dmr-x/db', () => ({ getDb: () => db }));
vi.mock('@dmr-x/utils', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../apps/gateway/src/middleware/auth.middleware.js', () => ({
  cachedAdminKey: 'fixture-global-admin',
  get LOCAL_MODE() { return mode.local; },
  get DEPLOYMENT_MODE() { return mode.managed ? 'managed' : 'selfhosted'; },
}));
import { compressionRoutes } from '../../apps/gateway/src/routes/compression.routes.js';
import { compressionService } from '../../apps/gateway/src/services/compression.js';

const apps: Array<ReturnType<typeof Fastify>> = [];
beforeEach(() => {
  mode.local = false; mode.managed = false;
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    INSERT INTO settings VALUES ('compression_config', '{"apiKey":"fixture-private-config-secret"}', datetime('now'));
    CREATE TABLE tenants (id TEXT PRIMARY KEY, compression_enabled INTEGER, compression_algorithm TEXT, compression_reversible INTEGER DEFAULT 1, updated_at TEXT);
    INSERT INTO tenants (id, compression_enabled) VALUES ('tenant-a',1), ('tenant-b',1);
    CREATE TABLE api_keys (id TEXT PRIMARY KEY, tenant_id TEXT, compression_enabled INTEGER, compression_algorithm TEXT, compression_reversible INTEGER DEFAULT 1, updated_at TEXT);
    INSERT INTO api_keys (id, tenant_id, compression_enabled) VALUES ('key-a','tenant-a',1), ('key-a-sibling','tenant-a',1), ('key-b','tenant-b',1);
  `);
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.restoreAllMocks();
  db.exec('DROP TABLE settings; DROP TABLE tenants; DROP TABLE api_keys;');
});
async function fixture(tenantId?: string, apiKeyId?: string, role = 'user') {
  const app = Fastify(); apps.push(app);
  app.addHook('onRequest', async request => { if (tenantId) (request as any).tenant = { id: tenantId, apiKeyId, role }; });
  await app.register(compressionRoutes);
  return app;
}

describe('compression route ownership matrix (fixture principals)', () => {
  it('does not promote a tenant admin into a global admin', async () => {
    const app = await fixture('tenant-a', 'key-a', 'admin');
    expect((await app.inject('/compression/config')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/compression/cleanup' })).statusCode).toBe(401);
  });
  it('does not expose or mutate another tenant or a nonexistent tenant', async () => {
    const app = await fixture('tenant-a', 'key-a');
    for (const id of ['tenant-b', 'does-not-exist']) {
      expect((await app.inject(`/compression/tenant/${id}`)).statusCode).toBe(404);
      expect((await app.inject({ method: 'PUT', url: `/compression/tenant/${id}`, payload: { enabled: false } })).statusCode).toBe(404);
    }
    expect(db.prepare('SELECT compression_enabled FROM tenants WHERE id = ?').get('tenant-b')).toMatchObject({ compression_enabled: 1 });
  });
  it('isolates sibling and cross-tenant API keys from a normal tenant key', async () => {
    const app = await fixture('tenant-a', 'key-a');
    expect((await app.inject('/compression/apikey/key-a')).statusCode).toBe(200);
    for (const id of ['key-a-sibling', 'key-b', 'missing-key']) {
      expect((await app.inject(`/compression/apikey/${id}`)).statusCode).toBe(404);
      expect((await app.inject({ method: 'PUT', url: `/compression/apikey/${id}`, payload: { enabled: false } })).statusCode).toBe(404);
    }
  });
  it('allows tenant-admin management only within that same tenant', async () => {
    const app = await fixture('tenant-a', 'key-a', 'admin');
    expect((await app.inject('/compression/apikey/key-a-sibling')).statusCode).toBe(200);
    expect((await app.inject('/compression/apikey/key-b')).statusCode).toBe(404);
  });
  it('defaults stats to the authenticated tenant and rejects a different tenant', async () => {
    const stats = vi.spyOn(compressionService, 'getCompressionStats').mockResolvedValue({ totalRequests: 0, totalTokensSaved: 0, avgCompressionRatio: 0 });
    const app = await fixture('tenant-a', 'key-a');
    expect((await app.inject('/compression/stats')).statusCode).toBe(200);
    expect(stats).toHaveBeenCalledWith('tenant-a');
    stats.mockClear();
    expect((await app.inject('/compression/stats?tenantId=tenant-b')).statusCode).toBe(403);
    expect(stats).not.toHaveBeenCalled();
  });
  it('redacts credentials for the global admin and rejects a padded credential', async () => {
    const app = await fixture();
    const admin = await app.inject({ url: '/compression/config', headers: { authorization: 'Bearer fixture-global-admin' } });
    expect(admin.statusCode).toBe(200);
    expect(admin.body).not.toContain('fixture-private-config-secret');
    const invalid = await app.inject({ url: '/compression/config', headers: { authorization: 'Bearer fixture-global-admin\u0000' } });
    expect(invalid.statusCode).toBe(401);
  });
  it('preserves intentional local mode access while managed mode forbids global access', async () => {
    const app = await fixture();
    mode.local = true;
    expect((await app.inject('/compression/config')).statusCode).toBe(200);
    mode.local = false; mode.managed = true;
    expect((await app.inject({ url: '/compression/config', headers: { authorization: 'Bearer fixture-global-admin' } })).statusCode).toBe(401);
  });
});
