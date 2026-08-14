import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encryptBytes, decryptBytes, encryptBytesRaw, decryptBytesRaw } from '@dmr-x/utils';
import { initDb, getDb, closeDb } from '@dmr-x/db';
import { initSqlJs } from '../../packages/db/src/client.js';

const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

/**
 * Build a real SQLite payload the way the RETIRED whole-file-encrypt save path
 * did: a sql.js database export. That export is what a legacy install has
 * encrypted inside its data.db.enc, so encrypting it with encryptBytesRaw
 * reproduces a genuine legacy .enc file for the conversion tests below.
 */
async function buildSqlitePayload(sql: string[]): Promise<Buffer> {
  const SQL = await initSqlJs();
  const mem = new SQL.Database();
  for (const s of sql) mem.run(s);
  const bytes = Buffer.from(mem.export());
  mem.close();
  return bytes;
}

/**
 * Run `fn` against a fresh scratch DMRX_DATA_DIR. Handles the module-level
 * database handle (close before switching dirs and again before deleting the
 * dir — Windows cannot rmSync a directory holding an open sqlite handle) and
 * restores the previous DMRX_DATA_DIR on the way out.
 */
async function withScratchDataDir<T>(fn: (dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'dmrx-dbtest-scratch-'));
  const prevDataDir = process.env.DMRX_DATA_DIR;
  process.env.DMRX_DATA_DIR = dataDir;
  try {
    await closeDb().catch(() => {});
    return await fn(dataDir);
  } finally {
    await closeDb().catch(() => {});
    if (prevDataDir === undefined) {
      delete process.env.DMRX_DATA_DIR;
    } else {
      process.env.DMRX_DATA_DIR = prevDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

describe('legacy .enc conversion and envelope round-trip', () => {
  let originalKey: string | undefined;

  beforeAll(() => {
    originalKey = process.env.DMRX_ENCRYPTION_KEY;
    process.env.DMRX_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(async () => {
    await closeDb().catch(() => {});
    if (originalKey === undefined) {
      delete process.env.DMRX_ENCRYPTION_KEY;
    } else {
      process.env.DMRX_ENCRYPTION_KEY = originalKey;
    }
  });

  it('round-trips bytes through encryptBytes/decryptBytes', () => {
    const samples = [
      Buffer.from('hello world'),
      crypto.getRandomValues(Buffer.alloc(1024)),
      Buffer.alloc(0),
    ];
    for (const s of samples) {
      const enc = encryptBytes(s);
      const dec = decryptBytes(enc);
      expect(Buffer.compare(dec, Buffer.from(s))).toBe(0);
    }
  });

  it('round-trips bytes through the binary envelope at half the hex size', () => {
    const samples = [
      Buffer.from('hello world'),
      crypto.getRandomValues(Buffer.alloc(1024)),
      Buffer.alloc(0),
    ];
    for (const s of samples) {
      const dec = decryptBytesRaw(encryptBytesRaw(s));
      expect(Buffer.compare(dec, Buffer.from(s))).toBe(0);
    }
    // The hex form stored two ASCII characters per byte; the binary envelope
    // must not, or large databases go back to doubling every write.
    const payload = crypto.getRandomValues(Buffer.alloc(4096));
    expect(encryptBytesRaw(payload).length).toBeLessThan(
      Buffer.from(encryptBytes(payload), 'utf8').length * 0.6,
    );
  });

  it('reads databases written in the legacy hex format', () => {
    // Existing installs have a hex-encoded data.db.enc on disk. Upgrading must
    // not orphan it — that would present as "DMR-X started from zero".
    const payload = Buffer.from('SQLite format 3\0legacy-payload');
    const legacyOnDisk = Buffer.from(encryptBytes(payload), 'utf8');
    expect(Buffer.compare(decryptBytesRaw(legacyOnDisk), payload)).toBe(0);
  });

  it('rejects tampered and truncated payloads instead of returning garbage', () => {
    const enc = encryptBytesRaw(Buffer.from('important row'));
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptBytesRaw(tampered)).toThrow();
    expect(() => decryptBytesRaw(enc.subarray(0, 20))).toThrow();
  });

  it('auto-converts a legacy encrypted data.db.enc into plaintext data.db and retains the .enc', async () => {
    await withScratchDataDir(async (dataDir) => {
      // Reproduce the legacy on-disk artifact exactly as the retired whole-file
      // encrypt save path wrote it.
      const encBytes = encryptBytesRaw(await buildSqlitePayload([
        'CREATE TABLE legacy_t (id INTEGER PRIMARY KEY, v TEXT)',
        "INSERT INTO legacy_t (v) VALUES ('legacy-row')",
      ]));
      const encPath = join(dataDir, 'data.db.enc');
      writeFileSync(encPath, encBytes);
      expect(existsSync(join(dataDir, 'data.db'))).toBe(false);

      // (a) initDb decrypts the .enc, stages it through data.db.tmp, renames it
      // into place, and opens it — the plaintext data.db is readable through the
      // native engine (migrations run on top of the converted file).
      await initDb();
      expect(existsSync(join(dataDir, 'data.db'))).toBe(true);
      expect(getDb().prepare('SELECT v FROM legacy_t').all()).toEqual([{ v: 'legacy-row' }]);

      // (b) the .enc is retained byte-identical (backup, never deleted).
      expect(Buffer.compare(readFileSync(encPath), encBytes)).toBe(0);

      // (c) a SECOND initDb() (new connection) does NOT re-convert: once
      // data.db exists it is authoritative, so the .enc stays untouched and the
      // plaintext data is still served.
      await closeDb();
      await initDb();
      expect(Buffer.compare(readFileSync(encPath), encBytes)).toBe(0);
      expect(getDb().prepare('SELECT v FROM legacy_t').all()).toEqual([{ v: 'legacy-row' }]);
    });
  });

  it('a corrupt data.db.enc is left untouched and a fresh data.db is still created', async () => {
    await withScratchDataDir(async (dataDir) => {
      // No data.db exists yet, so the conversion branch runs and hits the
      // garbage .enc. Decryption fails loudly (logged); the .enc must NOT be
      // modified, and initDb must not crash — the engine proceeds to create a
      // fresh data.db for this run (the corrupt .enc stays preserved for manual
      // recovery, exactly as the code's "leave the .enc untouched" contract).
      const garbage = Buffer.from('definitely-not-a-valid-encrypted-envelope-'.repeat(3));
      const encPath = join(dataDir, 'data.db.enc');
      writeFileSync(encPath, garbage);

      const db = await initDb();
      expect(Buffer.compare(readFileSync(encPath), garbage)).toBe(0);
      expect(existsSync(join(dataDir, 'data.db'))).toBe(true);

      db.prepare('CREATE TABLE IF NOT EXISTS post_corrupt_t (v TEXT)').run();
      db.prepare("INSERT INTO post_corrupt_t (v) VALUES ('fresh-db')").run();
      expect(db.prepare('SELECT v FROM post_corrupt_t').all()).toEqual([{ v: 'fresh-db' }]);
    });
  });
});
