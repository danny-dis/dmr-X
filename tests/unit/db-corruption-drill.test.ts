/**
 * Corruption-recovery drill for the LIVE native SQLite engine (packages/db).
 *
 * These tests drive the ACTUAL recovery path in client.ts's doInitDb() — the
 * code is the source of truth, and the assertions below document what that
 * code REALLY does with the engines it loads:
 *
 *   bun:sqlite (under Bun) and node:sqlite DatabaseSync (under Node) both open
 *   a file with garbage bytes WITHOUT throwing at construction — the "file is
 *   not a database" error is deferred to the first executed statement. Since
 *   S8, doInitDb() validates the 16-byte "SQLite format 3" magic header
 *   (sqlite.org/fileformat.html) BEFORE opening, so the byte-corruption class
 *   finally runs the rename-and-restore recovery:
 *
 *   - A data.db whose bytes are garbage/truncated (the "54 MB of NUL bytes"
 *     class) is detected by the magic-header check: the file is renamed to
 *     .corrupt.<ts>.bak and the newest valid .bak is auto-restored, so
 *     initDb() RESOLVES and the pre-corruption data comes back.
 *   - The open() failure path still fires for files that throw at construction
 *     (e.g. data.db occupied by a DIRECTORY) and routes into the SAME recovery.
 *   - A file whose first 15 bytes coincidentally match the magic header but is
 *     still torn fails later on the first PRAGMA; that block is also wrapped
 *     in recovery, so it too is renamed and restored instead of rejecting.
 *   - A corrupt data.db with NO valid backup falls back to an in-memory
 *     database (DATA LOSS log) rather than crashing.
 *   - A zero-length data.db is NOT corrupt to SQLite — it opens as a brand-new
 *     empty database, and the magic check explicitly exempts it (empty is a
 *     legitimate state, not the truncation class).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initDb, getDb, closeDb } from '@dmr-x/db';
import { initSqlJs } from '../../packages/db/src/client.js';

// Garbage that is NOT a valid SQLite file (first 15 bytes != "SQLite format 3").
const GARBAGE = Buffer.from('definitely-not-a-sqlite-database-'.repeat(4));

let validBackupBytes: Buffer;

beforeAll(async () => {
  // A real SQLite payload for the recovery backup. Built via sql.js export so
  // the file is engine-agnostic — any of the native engines can open it.
  const SQL = await initSqlJs();
  const mem = new SQL.Database();
  mem.run('CREATE TABLE drill_items (id INTEGER PRIMARY KEY, v TEXT)');
  mem.run("INSERT INTO drill_items (v) VALUES ('backup-row')");
  validBackupBytes = Buffer.from(mem.export());
  mem.close();
});

describe('db corruption recovery', () => {
  let dir: string;
  let prevDataDir: string | undefined;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmrx-corruption-drill-'));
    prevDataDir = process.env.DMRX_DATA_DIR;
    process.env.DMRX_DATA_DIR = dir;
    // The drill never needs the encryption key; dropping it also guarantees the
    // legacy .enc decrypt branch (keyed on DMRX_ENCRYPTION_KEY) never fires.
    delete process.env.DMRX_ENCRYPTION_KEY;
    await closeDb().catch(() => {});
  });

  afterEach(async () => {
    // closeDb() must run BEFORE rmSync: Windows won't delete a directory while
    // a sqlite handle inside it is still open. A rejected initDb() can also
    // leave the module-level handle set to a bad engine handle, so close it.
    await closeDb().catch(() => {});
    if (prevDataDir === undefined) {
      delete process.env.DMRX_DATA_DIR;
    } else {
      process.env.DMRX_DATA_DIR = prevDataDir;
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('recovers from the newest valid .bak when data.db cannot be opened', async () => {
    // The open() path keys on `new Database(data.db)` THROWING. Neither engine
    // throws for corrupt bytes, so the deterministic trigger here is data.db
    // being a non-file (a directory) — open throws "unable to open database
    // file" on both bun:sqlite and node:sqlite, entering the recovery branch.
    fs.writeFileSync(path.join(dir, 'data.db.pre-migration.1.bak'), validBackupBytes);
    fs.mkdirSync(path.join(dir, 'data.db'));

    await initDb();

    // The recovered backup's contents are readable through the engine.
    expect(getDb().prepare('SELECT v FROM drill_items').all()).toEqual([{ v: 'backup-row' }]);

    // The broken data.db (the directory) was renamed aside as a dated
    // .corrupt.<ts>.bak; it can never be a restored DB.
    const corruptBaks = fs.readdirSync(dir).filter((f) => /^data\.db\.corrupt\.\d+\.bak$/.test(f));
    expect(corruptBaks).toHaveLength(1);
    expect(fs.statSync(path.join(dir, corruptBaks[0])).isDirectory()).toBe(true);

    // A real file-backed data.db now exists again, with the SQLite magic.
    const reopened = fs.readFileSync(path.join(dir, 'data.db'));
    expect(reopened.subarray(0, 15).toString('latin1')).toBe('SQLite format 3');
  });

  it('a corrupt data.db (garbage bytes) is caught by the magic-header check and restored from the newest valid .bak', async () => {
    // The magic-header check fires BEFORE the engine opens the file, so the
    // "54 MB of NUL bytes" corruption class finally runs recovery: data.db is
    // renamed to .corrupt.<ts>.bak and the newest valid .bak is written back.
    fs.writeFileSync(path.join(dir, 'data.db.pre-migration.1.bak'), validBackupBytes);
    fs.writeFileSync(path.join(dir, 'data.db'), GARBAGE);

    await initDb();

    // The pre-corruption row is readable through the recovered backup.
    expect(getDb().prepare('SELECT v FROM drill_items').all()).toEqual([{ v: 'backup-row' }]);

    // The garbage file was renamed aside as a dated .corrupt.<ts>.bak and its
    // bytes are preserved verbatim for manual recovery.
    const corruptBaks = fs.readdirSync(dir).filter((f) => /^data\.db\.corrupt\.\d+\.bak$/.test(f));
    expect(corruptBaks).toHaveLength(1);
    expect(Buffer.compare(fs.readFileSync(path.join(dir, corruptBaks[0])), GARBAGE)).toBe(0);

    // data.db is a real SQLite file again.
    expect(fs.readFileSync(path.join(dir, 'data.db')).subarray(0, 15).toString('latin1'))
      .toBe('SQLite format 3');
  });

  it('a truncated data.db under 16 bytes is treated as corrupt and restored from backup', async () => {
    // A file shorter than SQLite's 16-byte magic header can never be a real
    // database — the up-front header check reads fewer than 16 bytes, the
    // magic fails, and the file routes into the same recovery path as garbage.
    const TRUNCATED = Buffer.from('torn-write!'); // 11 bytes, no magic header
    fs.writeFileSync(path.join(dir, 'data.db.pre-migration.1.bak'), validBackupBytes);
    fs.writeFileSync(path.join(dir, 'data.db'), TRUNCATED);

    await initDb();

    expect(getDb().prepare('SELECT v FROM drill_items').all()).toEqual([{ v: 'backup-row' }]);

    const corruptBaks = fs.readdirSync(dir).filter((f) => /^data\.db\.corrupt\.\d+\.bak$/.test(f));
    expect(corruptBaks).toHaveLength(1);
    expect(Buffer.compare(fs.readFileSync(path.join(dir, corruptBaks[0])), TRUNCATED)).toBe(0);
  });

  it('a corrupt data.db with no valid backup falls back to :memory: without crashing', async () => {
    // No .bak to restore from → recovery renames the garbage aside and starts
    // with an in-memory database (DATA LOSS log), so initDb RESOLVES and the
    // session can still write — but nothing is persisted to data.db.
    fs.writeFileSync(path.join(dir, 'data.db'), GARBAGE);

    await initDb();

    const db = getDb();
    db.prepare('CREATE TABLE fallback_writes (v TEXT)').run();
    db.prepare("INSERT INTO fallback_writes (v) VALUES ('in-memory')").run();
    expect(db.prepare('SELECT v FROM fallback_writes').all()).toEqual([{ v: 'in-memory' }]);

    // The garbage was preserved as .corrupt.<ts>.bak and NO fresh data.db was
    // written over it (the :memory: fallback never touches the filesystem).
    const corruptBaks = fs.readdirSync(dir).filter((f) => /^data\.db\.corrupt\.\d+\.bak$/.test(f));
    expect(corruptBaks).toHaveLength(1);
    expect(Buffer.compare(fs.readFileSync(path.join(dir, corruptBaks[0])), GARBAGE)).toBe(0);
    expect(fs.existsSync(path.join(dir, 'data.db'))).toBe(false);
  });

  it('a zero-length data.db is treated as a brand-new empty database', async () => {
    // Documented ACTUAL behavior: SQLite does not consider a 0-byte file
    // corrupt — it is an empty database, and the magic-header check exempts
    // it (empty is a legitimate state, not the truncation class). initDb
    // succeeds, migrations run, and the session can write + read back.
    fs.writeFileSync(path.join(dir, 'data.db'), Buffer.alloc(0));

    const db = await initDb();
    db.prepare('CREATE TABLE drill_writes (v TEXT)').run();
    db.prepare("INSERT INTO drill_writes (v) VALUES ('written')").run();
    expect(db.prepare('SELECT v FROM drill_writes').all()).toEqual([{ v: 'written' }]);

    // The once-empty file is now a real database.
    expect(fs.readFileSync(path.join(dir, 'data.db')).subarray(0, 15).toString('latin1'))
      .toBe('SQLite format 3');
  });
});
