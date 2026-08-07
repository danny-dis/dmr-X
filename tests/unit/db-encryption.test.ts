import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encryptBytes, decryptBytes, encryptBytesRaw, decryptBytesRaw } from '@dmr-x/utils';
import { initDb, flush, getDb } from '@dmr-x/db';

const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

describe('db at-rest encryption (option 2)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dmrx-dbtest-'));
    process.env.DMRX_DATA_DIR = dir;
    process.env.DMRX_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.DMRX_DATA_DIR;
    delete process.env.DMRX_ENCRYPTION_KEY;
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

  it('writes an encrypted .enc file (not valid plaintext sqlite) and reloads', async () => {
    await initDb();
    const db = getDb()!;
    db.prepare('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)').run();
    db.prepare('INSERT INTO t (v) VALUES (?)').run('secret-row');
    await flush();

    const encPath = join(dir, 'data.db.enc');
    const plainPath = join(dir, 'data.db');
    expect(existsSync(encPath)).toBe(true);
    expect(existsSync(plainPath)).toBe(false); // no plaintext left behind

    const raw = readFileSync(encPath);
    // SQLite files start with "SQLite format 3"; encrypted bytes must NOT.
    expect(raw.subarray(0, 15).toString('latin1')).not.toContain('SQLite format');

    // New process view: re-init reads the encrypted file back.
    const { initDb: reInit, getDb: getDb2 } = await import('@dmr-x/db');
    await reInit();
    const db2 = getDb2()!;
    const rows = db2.prepare('SELECT v FROM t').all();
    expect(rows).toEqual([{ v: 'secret-row' }]);
  });
});
