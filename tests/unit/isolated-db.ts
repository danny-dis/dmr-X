import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDb, closeDb } from '../../packages/db/src/client.js';

export async function openIsolatedTestDb(prefix: string) {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  const previous = {
    dataDir: process.env.DMRX_DATA_DIR,
    dbPath: process.env.DMRX_DB_PATH,
    encryptionKey: process.env.DMRX_ENCRYPTION_KEY,
  };

  const restore = () => {
    for (const [key, value] of [
      ['DMRX_DATA_DIR', previous.dataDir],
      ['DMRX_DB_PATH', previous.dbPath],
      ['DMRX_ENCRYPTION_KEY', previous.encryptionKey],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  process.env.DMRX_DATA_DIR = dataDir;
  process.env.DMRX_DB_PATH = join(dataDir, 'data.db');
  delete process.env.DMRX_ENCRYPTION_KEY;

  try {
    const db = await initDb();
    return {
      db,
      dataDir,
      async close() {
        try {
          await closeDb();
        } finally {
          restore();
          rmSync(dataDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    restore();
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
}
