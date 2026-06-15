import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initSqlJs, runMigrations, type SqlJsDatabase } from '../../packages/db/src/client.js';

type MigrationEntry = { version: number; filename: string; sql: string };

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let db: SqlJsDatabase;

const fixtureMigrations = new Map<number, MigrationEntry>([
  [
    1,
    {
      version: 1,
      filename: '001_test_users.sql',
      sql: 'CREATE TABLE IF NOT EXISTS test_users (id TEXT PRIMARY KEY, name TEXT NOT NULL);',
    },
  ],
  [
    2,
    {
      version: 2,
      filename: '002_test_posts.sql',
      sql: 'CREATE TABLE IF NOT EXISTS test_posts (id TEXT PRIMARY KEY, body TEXT);',
    },
  ],
  [
    17,
    {
      version: 17,
      filename: '017_schema_version_checksum.sql',
      sql: 'ALTER TABLE schema_version ADD COLUMN checksum TEXT;',
    },
  ],
]);

beforeAll(async () => {
  // Load the real sql.js WASM (no vi.mock — this test exercises the
  // real migration runner against a real in-memory SQLite).
  SQL = await initSqlJs();
});

beforeEach(() => {
  db = new SQL.Database();
});

afterEach(() => {
  db.close();
});

describe('migration checksum verification', () => {
  it('records a SHA-256 hex checksum for every applied migration', () => {
    const result = runMigrations(db, fixtureMigrations, { strict: false });
    expect(result.applied).toEqual([1, 2, 17]);
    expect(result.mismatches).toEqual([]);
    expect(result.backfilled).toBe(0);

    const rows = db.exec('SELECT version, filename, checksum FROM schema_version ORDER BY version');
    expect(rows.length).toBe(1);
    const values = rows[0].values;
    expect(values).toHaveLength(3);

    // Every row must have a 64-char SHA-256 hex digest.
    for (const row of values) {
      const version = row[0] as number;
      const filename = row[1] as string;
      const checksum = row[2] as string;
      expect(typeof checksum).toBe('string');
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
      // Spot-check the (version, filename) pairing.
      expect([1, 2, 17]).toContain(version);
      expect(filename).toMatch(/^(001|002|017)_/);
    }

    // Different SQL -> different hash. The three migrations all have
    // different SQL, so all three checksums must be distinct.
    const checksums = values.map((v) => v[2] as string);
    expect(new Set(checksums).size).toBe(3);
  });

  it('is idempotent on re-run (does not re-apply already-applied migrations)', () => {
    runMigrations(db, fixtureMigrations, { strict: false });
    const secondRun = runMigrations(db, fixtureMigrations, { strict: false });
    expect(secondRun.applied).toEqual([]);
    expect(secondRun.mismatches).toEqual([]);
    expect(secondRun.backfilled).toBe(0);
  });

  it('refuses to start in strict mode when a migration has been edited after apply', () => {
    runMigrations(db, fixtureMigrations, { strict: false });

    // Simulate someone editing migration 1's SQL after it was applied.
    const tampered = new Map(fixtureMigrations);
    tampered.set(1, {
      version: 1,
      filename: '001_test_users.sql',
      sql: 'CREATE TABLE IF NOT EXISTS test_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER);',
    });

    expect(() => runMigrations(db, tampered, { strict: true })).toThrow(
      /Migration checksum verification failed/,
    );
  });

  it('logs mismatches but does not throw in non-strict mode (dev / local)', () => {
    runMigrations(db, fixtureMigrations, { strict: false });

    const tampered = new Map(fixtureMigrations);
    tampered.set(1, {
      version: 1,
      filename: '001_test_users.sql',
      sql: 'CREATE TABLE IF NOT EXISTS test_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER);',
    });

    const result = runMigrations(db, tampered, { strict: false });
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].version).toBe(1);
    expect(result.mismatches[0].filename).toBe('001_test_users.sql');
    expect(result.mismatches[0].stored).not.toBe(result.mismatches[0].expected);
    expect(result.mismatches[0].stored).toMatch(/^[a-f0-9]{64}$/);
    expect(result.mismatches[0].expected).toMatch(/^[a-f0-9]{64}$/);
  });

  it('backfills the checksum column for rows that pre-date migration 017', () => {
    // Simulate a DB created before migration 017 added the checksum
    // column. The schema_version table has version + filename rows
    // but no checksum values yet.
    db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        filename TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const stmt = db.prepare('INSERT INTO schema_version (version, filename) VALUES (?, ?)');
    stmt.bind([1, '001_test_users.sql']);
    stmt.step();
    stmt.free();

    const result = runMigrations(db, fixtureMigrations, { strict: false });
    // Migration 1 is already "applied" (per schema_version), so only
    // migrations 2 and 17 should have been executed in this run.
    expect(result.applied).toEqual([2, 17]);
    // Migration 1's row had a NULL checksum and gets backfilled in
    // place; migrations 2 and 17 were inserted with a checksum.
    expect(result.backfilled).toBe(1);
    expect(result.mismatches).toEqual([]);

    const rows = db.exec('SELECT version, filename, checksum FROM schema_version ORDER BY version');
    const values = rows[0].values;
    expect(values).toHaveLength(3);
    for (const row of values) {
      const checksum = row[2] as string;
      expect(typeof checksum).toBe('string');
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('refuses to start in strict mode if a schema_version row has no source migration', () => {
    const single = new Map<number, MigrationEntry>([
      [1, { version: 1, filename: '001_test.sql', sql: 'CREATE TABLE t1 (id INTEGER);' }],
    ]);
    runMigrations(db, single, { strict: false });

    // Now run with an empty migrations map. Phase 4 will see the row
    // for version 1 but find no matching source and record a mismatch.
    const empty = new Map<number, MigrationEntry>();
    expect(() => runMigrations(db, empty, { strict: true })).toThrow(
      /Migration checksum verification failed/,
    );
  });

  it('does not throw on missing-source mismatches in non-strict mode', () => {
    const single = new Map<number, MigrationEntry>([
      [1, { version: 1, filename: '001_test.sql', sql: 'CREATE TABLE t1 (id INTEGER);' }],
    ]);
    runMigrations(db, single, { strict: false });

    const empty = new Map<number, MigrationEntry>();
    const result = runMigrations(db, empty, { strict: false });
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].version).toBe(1);
    expect(result.mismatches[0].expected).toBe('MISSING');
  });
});
