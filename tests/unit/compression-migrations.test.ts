import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../../packages/db/src/migrations-data.js';

function source(name: string): string {
  return readFileSync(new URL(`../../packages/db/src/migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim();
}

describe('compression migration registration and fresh SQLite compatibility', () => {
  it('registers the exact 025 and 089 migration SQL in the deployable bundle', () => {
    for (const version of [25, 89]) {
      const migration = MIGRATIONS[version];
      expect(migration).toBeDefined();
      expect(migration.sql.replace(/\r\n/g, '\n').trim()).toBe(source(migration.filename));
    }
  });

  it('applies 025 then 089 to the real initial schema and keeps legacy originals unowned', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(MIGRATIONS[1].sql);
      db.exec(MIGRATIONS[25].sql);
      db.prepare("INSERT INTO compression_cache (id, original_content, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))").run('legacy-original', '[{"role":"user","content":"fixture"}]');
      db.exec(MIGRATIONS[89].sql);
      const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(row => row.name);
      expect(columns('tenants')).toEqual(expect.arrayContaining(['compression_enabled', 'compression_algorithm', 'compression_reversible']));
      expect(columns('api_keys')).toEqual(expect.arrayContaining(['compression_enabled', 'compression_algorithm', 'compression_reversible']));
      expect(columns('compression_cache')).toEqual(expect.arrayContaining(['tenant_id', 'api_key_id', 'expires_at']));
      const legacy = db.prepare('SELECT tenant_id, api_key_id FROM compression_cache WHERE id = ?').get('legacy-original');
      expect(legacy).toEqual({ tenant_id: null, api_key_id: null });
      const original = JSON.stringify([{ role: 'user', content: 'migration fixture', name: 'fixture-owner' }]);
      db.prepare("INSERT INTO compression_cache (id, original_content, tenant_id, api_key_id, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+1 hour'))").run('owned-original', original, 'tenant-a', 'key-a');
      const scoped = db.prepare("SELECT original_content FROM compression_cache WHERE id = ? AND tenant_id = ? AND api_key_id = ? AND julianday(expires_at) > julianday('now')");
      expect(scoped.get('owned-original', 'tenant-a', 'key-a')?.original_content).toBe(original);
      expect(scoped.get('owned-original', 'tenant-b', 'key-b')).toBeUndefined();
      expect(scoped.get('legacy-original', 'tenant-a', 'key-a')).toBeUndefined();
      expect((db.prepare('PRAGMA index_list(compression_cache)').all() as { name: string }[]).map(row => row.name)).toContain('idx_compression_cache_owner');
    } finally { db.close(); }
  });
});
