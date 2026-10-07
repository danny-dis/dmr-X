import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = new DatabaseSync(':memory:');
vi.mock('@dmr-x/db', () => ({ getDb: () => db }));
vi.mock('@dmr-x/utils', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));
vi.mock('headroom-ai', () => ({ HeadroomClient: class {} }));

import { compressionService } from '../../apps/gateway/src/services/compression.js';

beforeEach(() => {
  db.exec('DROP TABLE IF EXISTS settings; DROP TABLE IF EXISTS tenants; DROP TABLE IF EXISTS api_keys;');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tenants (id TEXT PRIMARY KEY, compression_enabled INTEGER, compression_algorithm TEXT, compression_reversible INTEGER, updated_at TEXT);
    CREATE TABLE api_keys (id TEXT PRIMARY KEY, compression_enabled INTEGER, compression_algorithm TEXT, compression_reversible INTEGER, updated_at TEXT);
    INSERT INTO tenants VALUES ('tenant-a', NULL, NULL, NULL, datetime('now'));
    INSERT INTO api_keys VALUES ('key-a', NULL, NULL, NULL, datetime('now'));`);
});

describe('compression config persistence', () => {
  it('persists and reads scoped engine and options', async () => {
    await compressionService.updateTenantConfig('tenant-a', { enabled: true, reversible: false, engine: 'rtk', rtkOptions: { maxRepeated: 7 } });
    expect(compressionService.getTenantConfig('tenant-a')).toMatchObject({ enabled: true, reversible: false, engine: 'rtk', rtkOptions: { maxRepeated: 7 } });
  });

  it('preserves a reversible-only false update when enabled is unset', async () => {
    await compressionService.updateTenantConfig('tenant-a', { reversible: false });
    expect(compressionService.getTenantConfig('tenant-a')).toMatchObject({ reversible: false });
  });

  it('rejects unknown and out-of-bounds settings without persisting them', async () => {
    await expect(compressionService.updateTenantConfig('tenant-a', { engine: 'arbitrary' } as any)).rejects.toThrow();
    await expect(compressionService.updateTenantConfig('tenant-a', { rtkOptions: { maxRepeated: 1001 } } as any)).rejects.toThrow();
    expect(db.prepare("SELECT value FROM settings WHERE key = 'compression:tenant:tenant-a'").get()).toBeUndefined();
  });

  it('preserves global, tenant, then API-key precedence in compression', async () => {
    await compressionService.updateGlobalConfig({ enabled: true, reversible: false, engine: 'rtk', minTokensToCompress: 1 });
    await compressionService.updateTenantConfig('tenant-a', { engine: 'comment-strip' });
    await compressionService.updateApiKeyConfig('key-a', { engine: 'caveman' });
    const result = await compressionService.compressPrompt(
      [{ role: 'assistant', content: 'This historical sentence is sufficiently long to reach compression.' }, { role: 'user', content: 'question' }],
      compressionService.getTenantConfig('tenant-a'), compressionService.getApiKeyConfig('key-a')
    );
    expect(result.metadata.algorithmUsed).toBe('caveman');
  });
});
