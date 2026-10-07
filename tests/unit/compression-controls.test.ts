import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const db = new DatabaseSync(':memory:');
vi.mock('@dmr-x/db', () => ({ getDb: () => db, MemoryCache: class { get() { return undefined; } set() {} } }));
vi.mock('@dmr-x/utils', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }, verifyApiKey: vi.fn(), hashApiKey: vi.fn() }));
vi.mock('headroom-ai', () => ({ HeadroomClient: class {} }));

import { compressionRoutes } from '../../apps/gateway/src/routes/compression.routes.js';

afterEach(() => { db.exec('DROP TABLE IF EXISTS settings; DROP TABLE IF EXISTS tenants; DROP TABLE IF EXISTS api_keys; DROP TABLE IF EXISTS request_logs; DROP TABLE IF EXISTS compression_cache;'); });

describe('compression route authorization', () => {
  it('does not allow an unauthenticated request to read global settings or leak its secret', async () => {
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT); INSERT INTO settings VALUES ('compression_config', '{\"enabled\":true,\"proxyUrl\":\"https://proxy.example\",\"apiKey\":\"sensitive\",\"reversible\":true,\"minTokensToCompress\":1}', datetime('now'));");
    const app = Fastify();
    await app.register(compressionRoutes);
    const response = await app.inject({ method: 'GET', url: '/compression/config' });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('sensitive');
    await app.close();
  });
});
