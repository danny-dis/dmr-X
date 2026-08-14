
// NOTE: this test runs against the real sql.js WASM, not a mock. The
// previous `vi.mock('sql.js')` pattern does not intercept the default
// import on Windows + Vitest 3.x (the mock object never replaces the
// real Database constructor), so the production code path was being
// exercised anyway. We embrace that here: `initDb()` runs the real
// migration set on a real on-disk database, then we create a
// scratch `users` table on the same database to exercise the
// wrapper methods.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDb, getDb, closeDb } from '../../packages/db/src/client.js';

let tmpDir: string;
let originalDataDir: string | undefined;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-sqlite-test-'));
  originalDataDir = process.env.DMRX_DATA_DIR;
  process.env.DMRX_DATA_DIR = tmpDir;
  // Reset the module-level cache so a fresh DB is created per test.
  // The client module exports a singleton `db` variable; we close it
  // here to make sure the new DMRX_DATA_DIR takes effect.
  try {
    await closeDb();
  } catch {
    // ignore — first test
  }
});

afterEach(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  if (originalDataDir === undefined) {
    delete process.env.DMRX_DATA_DIR;
  } else {
    process.env.DMRX_DATA_DIR = originalDataDir;
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('sqlite-client', () => {
  describe('DatabaseWrapper', () => {
    it('initializes sql.js and applies all migrations', async () => {
      const wrapper = await initDb();
      const row = wrapper.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
      // NOTE: this asserts the current applied migration version. It is
      // expected to grow as new .sql migrations are added under
      // packages/db/src/migrations/ (054–058 added agent sessions, session
      // steps, evaluations, plan mode, and compaction).
      // Bump this number when adding migrations — it verifies the full
      // migration set is applied, not just the schema seed.
      // 062 adds model_profiles.operator_disabled.
      // 063 adds api_keys.role (agent RBAC — see agent-rbac.middleware.ts).
      // 064 adds api_keys.key_lookup_hash (indexed O(1) auth lookup).
      // 065 adds agentic_sessions (durable /agentic/chat conversations).
      // 070 adds jobs.
      // 071 adds bandit_arms (persisted Thompson bandit posterior).
      expect(row.v).toBe(71);
    });

    it('should expose prepare / get / run / all / close on the wrapper', async () => {
      const wrapper = await initDb();
      const stmt = wrapper.prepare('SELECT 1 AS one');
      expect(stmt).toBeDefined();
      expect(typeof stmt.all).toBe('function');
      expect(typeof stmt.get).toBe('function');
      expect(typeof stmt.run).toBe('function');
    });

    it('prepare().all() should return rows', async () => {
      const wrapper = await initDb();
      wrapper.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
      `);
      wrapper.prepare('INSERT INTO users (name) VALUES (?)').run('Alice');
      wrapper.prepare('INSERT INTO users (name) VALUES (?)').run('Bob');

      const rows = wrapper.prepare('SELECT * FROM users ORDER BY id').all() as Array<{ id: number; name: string }>;
      expect(rows).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
    });

    it('prepare().get() should return single row', async () => {
      const wrapper = await initDb();
      wrapper.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
      `);
      wrapper.prepare('INSERT INTO users (name) VALUES (?)').run('Alice');

      const row = wrapper.prepare('SELECT * FROM users WHERE id = 1').get() as { id: number; name: string };
      expect(row).toEqual({ id: 1, name: 'Alice' });
    });

    it('prepare().get() should return undefined when no rows', async () => {
      const wrapper = await initDb();
      wrapper.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
      `);
      const row = wrapper.prepare('SELECT * FROM users WHERE id = 999').get();
      expect(row).toBeUndefined();
    });

    it('prepare().run() should return changes count', async () => {
      const wrapper = await initDb();
      wrapper.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        );
      `);
      const result = wrapper.prepare('INSERT INTO users (name) VALUES (?)').run('Charlie');
      expect(result).toEqual({ changes: 1 });
    });

    it('exec() should execute raw SQL', async () => {
      const wrapper = await initDb();
      wrapper.exec('CREATE TABLE exec_test (id INTEGER)');
      wrapper.prepare('INSERT INTO exec_test (id) VALUES (42)').run();
      const row = wrapper.prepare('SELECT id FROM exec_test').get() as { id: number };
      expect(row).toEqual({ id: 42 });
    });

    it('closeDb() should clear the singleton so getDb() throws', async () => {
      await initDb();
      // closeDb() flushes pending writes, closes the underlying
      // Database, and nulls the module-level singleton. After that,
      // getDb() should throw because no database is initialized.
      await closeDb();
      expect(() => getDb()).toThrow(/Database not initialized/);
    });

    it('getDb() should return wrapper after initDb() is called', async () => {
      await initDb();
      const wrapper = getDb();
      expect(wrapper).toBeDefined();
      expect(typeof wrapper.prepare).toBe('function');
    });
  });
});
