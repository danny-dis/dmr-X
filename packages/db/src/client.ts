import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Use console for logging since @dmr-x/utils may depend on @dmr-x/db (avoid circular)
const log = {
  info: (...args: unknown[]) => console.log('[dmr-x]', ...args),
  error: (...args: unknown[]) => console.error('[dmr-x]', ...args),
  warn: (...args: unknown[]) => console.warn('[dmr-x]', ...args),
};

let db: SqlJsDatabase | null = null;
let dbPath = '';

async function saveDatabase(): Promise<void> {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    await fs.promises.writeFile(dbPath, Buffer.from(data));
  } catch (err) {
    log.error('Failed to save database:', err);
  }
}

const SAVE_DEBOUNCE_MS = 100;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaveResolvers: (() => void)[] = [];

/**
 * Schedule a debounced save. Multiple calls within the debounce window are
 * coalesced into a single disk write. Returns a Promise that resolves once
 * the write actually completes, so callers can await it when needed.
 */
function scheduleSave(): Promise<void> {
  return new Promise<void>((resolve) => {
    pendingSaveResolvers.push(resolve);
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const resolvers = pendingSaveResolvers;
      pendingSaveResolvers = [];
      await saveDatabase();
      for (const r of resolvers) r();
    }, SAVE_DEBOUNCE_MS);
  });
}

/**
 * Immediately flush any pending debounced save to disk. Use this before
 * graceful shutdown or after critical writes where you need a guarantee
 * that data is persisted right now.
 */
export async function flush(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const resolvers = pendingSaveResolvers;
  pendingSaveResolvers = [];
  await saveDatabase();
  for (const r of resolvers) r();
}

// ---------------------------------------------------------------------------
// One-time migration: encrypt any plaintext provider API keys
// ---------------------------------------------------------------------------

async function migratePlaintextApiKeys(dbWrapper: SqlJsDatabase): Promise<void> {
  if (!process.env.DMRX_ENCRYPTION_KEY) return; // No encryption configured

  let encrypt: ((plaintext: string) => string) | null = null;
  let decrypt: ((encryptedHex: string) => string) | null = null;
  try {
    const crypto = await import('@dmr-x/utils');
    encrypt = crypto.encrypt;
    decrypt = crypto.decrypt;
  } catch {
    // utils not available — skip migration
    return;
  }

  try {
    const rows = dbWrapper.exec('SELECT id, config FROM providers');
    if (rows.length === 0 || !rows[0].values) return;

    const stmt = dbWrapper.prepare('UPDATE providers SET config = ? WHERE id = ?');
    for (const row of rows[0].values) {
      const id = row[0] as string;
      const configStr = row[1] as string || '{}';
      const config = JSON.parse(configStr);

      if (typeof config.apiKey !== 'string' || config.apiKey.length === 0) continue;

      // Try decrypting — if it fails, the key is plaintext
      try {
        decrypt!(config.apiKey);
        // Decryption succeeded — already encrypted, skip
      } catch {
        // Plaintext — encrypt it
        config.apiKey = encrypt!(config.apiKey);
        stmt.bind([JSON.stringify(config), id]);
        stmt.step();
        stmt.free();
        log.info(`Migrated plaintext API key for provider "${id}" to encrypted`);
      }
    }
  } catch (err) {
    log.error('API key migration failed (non-fatal):', err);
  }
}

// Wrapper that mimics better-sqlite3 API on top of sql.js
class DatabaseWrapper {
  private raw: SqlJsDatabase;

  constructor(raw: SqlJsDatabase) {
    this.raw = raw;
  }

  prepare(sql: string) {
    const raw = this.raw;
    return {
      all(...params: unknown[]) {
        const stmt = raw.prepare(sql);
        try {
          stmt.bind(params.length > 0 ? params as initSqlJs.BindParams : undefined);
          const rows: Record<string, unknown>[] = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } finally {
          stmt.free();
        }
      },
      get(...params: unknown[]) {
        const stmt = raw.prepare(sql);
        try {
          stmt.bind(params.length > 0 ? params as initSqlJs.BindParams : undefined);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },
      run(...params: unknown[]) {
        const stmt = raw.prepare(sql);
        try {
          stmt.bind(params.length > 0 ? params as initSqlJs.BindParams : undefined);
          stmt.step();
          const changes = raw.getRowsModified();
          scheduleSave();
          return { changes };
        } finally {
          stmt.free();
        }
      },
    };
  }

  exec(sql: string) {
    this.raw.exec(sql);
    scheduleSave();
  }

  pragma(_p: string) {
    // sql.js doesn't support PRAGMA the same way — no-op
  }

  flush() {
    return flush();
  }

  async close() {
    await flush();
    this.raw.close();
  }
}

export async function initDb(): Promise<DatabaseWrapper> {
  if (db) return new DatabaseWrapper(db);

  const SQL = await initSqlJs();

  const dataDir = process.env.DMRX_DATA_DIR || path.join(os.homedir(), '.dmr-x');
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, 'data.db');

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Run migrations from the migrations directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationsDir = path.join(__dirname, 'migrations');

  // Enable foreign key enforcement (SQLite has it off by default)
  db.exec('PRAGMA foreign_keys = ON;');

  if (fs.existsSync(migrationsDir)) {
    // Create schema_version table if it doesn't exist (first-run)
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        filename TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Get already-applied migration versions
    const applied = new Set<number>();
    try {
      const rows = db.exec('SELECT version FROM schema_version');
      if (rows.length > 0 && rows[0].values) {
        for (const row of rows[0].values) {
          applied.add(row[0] as number);
        }
      }
    } catch {
      // schema_version table doesn't yet exist; first migration will create it
    }

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      // Extract version number from filename (e.g., "001_initial_schema.sql" → 1)
      const versionMatch = file.match(/^(\d+)_/);
      if (!versionMatch) continue;
      const version = parseInt(versionMatch[1], 10);

      if (applied.has(version)) {
        continue; // Already applied — skip
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      try {
        db.exec(sql);
        // Record successful migration
        db.exec(
          `INSERT OR IGNORE INTO schema_version (version, filename) VALUES (${version}, '${file}')`
        );
      } catch (err) {
        log.error(`Migration ${file} failed:`, err);
        throw err;
      }
    }
  }

  await saveDatabase();
  log.info(`SQLite database ready at ${dbPath}`);

  // Migrate plaintext API keys to encrypted (one-time pass)
  await migratePlaintextApiKeys(db);

  return new DatabaseWrapper(db);
}

export function getDb(): DatabaseWrapper {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return new DatabaseWrapper(db);
}

export async function closeDb() {
  if (db) {
    await flush();
    db.close();
    db = null;
  }
}

// Register process signal handlers to flush pending writes on crash/shutdown
function registerCrashHandlers(): void {
  const emergencyFlush = async () => {
    try {
      await flush();
    } catch {
      // Best-effort — nothing more we can do
    }
  };

  process.on('SIGTERM', () => { void emergencyFlush(); });
  process.on('SIGINT', () => { void emergencyFlush(); });
  process.on('beforeExit', () => { void emergencyFlush(); });
}

registerCrashHandlers();
