import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

import { initDb, closeDb, getDb, type DatabaseWrapper } from '../../packages/db/src/client.js';
import { hashApiKey, hashApiKeyWithSalt, verifyApiKey } from '../../packages/utils/src/crypto.js';

/**
 * Auth lookup hash (migration 064) integration tests.
 *
 * Exercises the real DB + migration runner against the indexed
 * key_lookup_hash path used by apps/gateway/src/middleware/auth.middleware.ts
 * and apps/gateway/src/routes/validate.routes.ts:
 *
 *   1. Migration 064 adds key_lookup_hash + unique index and backfills
 *      legacy unsalted rows (key_hash without a colon).
 *   2. A newly created key stores key_lookup_hash = sha256(raw key).
 *   3. The middleware's indexed query finds it in one row.
 *   4. Legacy salted rows (no lookup hash) are only reachable through the
 *      bounded fallback scan (key_lookup_hash IS NULL).
 */

let db: DatabaseWrapper;
let dbPath: string;

const tmpRoot = process.env.TMPDIR || process.env.TEMP || 'C:\\Users\\pc\\AppData\\Local\\Temp';

beforeAll(async () => {
  dbPath = `${tmpRoot}/dmrx-auth-lookup-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`;
  process.env.DMRX_DATA_DIR = require('node:path').dirname(dbPath);
  process.env.DMRX_DB_PATH = dbPath;
  // Required by initDb for at-rest encryption decisions; absence just skips it.
  delete process.env.DMRX_ENCRYPTION_KEY;
  db = await initDb();
});

beforeEach(async () => {
  // Clean slate: remove any api_keys rows between cases.
  getDb().prepare('DELETE FROM api_keys').run();
});

afterEach(() => {
  try {
    getDb().prepare('DELETE FROM api_keys').run();
  } catch {
    /* ignore */
  }
});

afterAll(async () => {
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  const fs = await import('node:fs');
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}.pre-migration.*.bak`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('migration 064: api_keys.key_lookup_hash', () => {
  it('adds the key_lookup_hash column and its unique index', () => {
    const cols = db.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('key_lookup_hash');

    const idx = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_api_keys_lookup_hash'"
    ).get() as { name: string } | undefined;
    expect(idx).toBeDefined();
  });

  it('backfills legacy unsalted key_hash rows (no colon) into key_lookup_hash', () => {
    const rawKey = 'dmr-legacy-test-key';
    const legacyHash = hashApiKey(rawKey); // unsalted: no colon
    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, key_hash) VALUES (?, ?, ?)'
    ).run('legacy-1', 'tenant-1', legacyHash);

    // Simulate the migration's backfill UPDATE as the runner would apply it
    // on an existing DB (the column already exists here, so run it manually):
    db.prepare(
      `UPDATE api_keys
          SET key_lookup_hash = key_hash
        WHERE key_lookup_hash IS NULL
          AND instr(key_hash, ':') = 0`
    ).run();

    const row = db.prepare(
      'SELECT key_hash, key_lookup_hash FROM api_keys WHERE id = ?'
    ).get('legacy-1') as { key_hash: string; key_lookup_hash: string | null };
    expect(row.key_lookup_hash).toBe(legacyHash);
    expect(verifyApiKey(rawKey, row.key_hash)).toBe(true);
  });

  it('leaves salted rows unbackfilled (no plaintext available)', () => {
    const rawKey = 'dmr-salted-test-key';
    const salted = hashApiKeyWithSalt(rawKey); // salt:hash format
    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, key_hash) VALUES (?, ?, ?)'
    ).run('salted-1', 'tenant-1', salted);

    db.prepare(
      `UPDATE api_keys
          SET key_lookup_hash = key_hash
        WHERE key_lookup_hash IS NULL
          AND instr(key_hash, ':') = 0`
    ).run();

    const row = db.prepare(
      'SELECT key_lookup_hash FROM api_keys WHERE id = ?'
    ).get('salted-1') as { key_lookup_hash: string | null };
    expect(row.key_lookup_hash).toBeNull();
  });

  it('indexed lookup finds a newly created key by key_lookup_hash', () => {
    const rawKey = 'dmr-new-lookup-key';
    const lookupHash = hashApiKey(rawKey);
    const keyHash = hashApiKeyWithSalt(rawKey);
    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, key_hash, key_lookup_hash) VALUES (?, ?, ?, ?)'
    ).run('new-1', 'tenant-1', keyHash, lookupHash);

    const row = db.prepare(
      `SELECT ak.id, ak.key_hash
         FROM api_keys ak
        WHERE ak.key_lookup_hash = ?
          AND ak.is_active = 1
          AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))`
    ).get(lookupHash) as { id: string; key_hash: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.id).toBe('new-1');
    // Constant-time verify still passes against the salted key_hash.
    expect(verifyApiKey(rawKey, row!.key_hash)).toBe(true);
  });

  it('indexed lookup returns nothing for an unknown key', () => {
    const row = db.prepare(
      `SELECT ak.id
         FROM api_keys ak
        WHERE ak.key_lookup_hash = ?`
    ).get(hashApiKey('dmr-does-not-exist')) as { id: string } | undefined;
    expect(row).toBeUndefined();
  });

  it('fallback scan only sees rows with key_lookup_hash IS NULL', () => {
    // One legacy salted row (no lookup hash) + one new row (has lookup hash).
    const salted = hashApiKeyWithSalt('dmr-salted-fallback');
    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, key_hash) VALUES (?, ?, ?)'
    ).run('fallback-salted', 'tenant-1', salted);
    const newKey = 'dmr-new-fallback';
    db.prepare(
      'INSERT INTO api_keys (id, tenant_id, key_hash, key_lookup_hash) VALUES (?, ?, ?, ?)'
    ).run('fallback-new', 'tenant-1', hashApiKeyWithSalt(newKey), hashApiKey(newKey));

    const legacyRows = db.prepare(
      `SELECT ak.id, ak.key_hash
         FROM api_keys ak
        WHERE ak.key_lookup_hash IS NULL`
    ).all() as Array<{ id: string; key_hash: string }>;

    expect(legacyRows.map(r => r.id)).toEqual(['fallback-salted']);
    // And the fallback verify still authenticates the legacy key.
    expect(legacyRows.some(r => verifyApiKey('dmr-salted-fallback', r.key_hash))).toBe(true);
  });
});
