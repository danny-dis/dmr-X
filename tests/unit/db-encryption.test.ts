import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encryptBytes, decryptBytes } from '@dmr-x/utils';
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
