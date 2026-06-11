import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS } from './migrations-data.js';

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

const SAVE_DEBOUNCE_MS = 50;
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

  transaction(fn: () => void) {
    this.raw.exec('BEGIN TRANSACTION');
    try {
      fn();
      this.raw.exec('COMMIT');
      scheduleSave();
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
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
    try {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } catch {
      const backupPath = `${dbPath}.corrupt.${Date.now()}.bak`;
      fs.renameSync(dbPath, backupPath);
      log.warn(`Corrupted database backed up to ${backupPath}, creating fresh database`);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // Enable foreign key enforcement (SQLite has it off by default)
  db.exec('PRAGMA foreign_keys = ON;');

  // Enable Write-Ahead Logging for concurrent reads without blocking on writes
  db.exec('PRAGMA journal_mode = WAL;');

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

  // Load migrations from disk when present, then backfill any missing versions
  // from embedded SQL. Some dev/dist layouts can have a partial migrations
  // directory, so a filesystem-only load would silently skip newer migrations.
  const migrations = new Map<number, { version: number; filename: string; sql: string }>();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const migrationsDir = path.join(__dirname, 'migrations');

  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const versionMatch = file.match(/^(\d+)_/);
      if (!versionMatch) continue;
      const version = parseInt(versionMatch[1], 10);
      migrations.set(version, {
        version,
        filename: file,
        sql: fs.readFileSync(path.join(migrationsDir, file), 'utf-8'),
      });
    }
  }

  {
    // Compiled binary — use embedded migration SQL
    for (const [ver, mig] of Object.entries(MIGRATIONS)) {
      const version = parseInt(ver, 10);
      if (migrations.has(version)) continue;
      migrations.set(version, {
        version,
        filename: mig.filename,
        sql: mig.sql,
      });
    }
  }

  for (const mig of [...migrations.values()].sort((a, b) => a.version - b.version)) {
    if (applied.has(mig.version)) continue;

    try {
      db.exec(mig.sql);
      const insertStmt = db.prepare(
        'INSERT OR IGNORE INTO schema_version (version, filename) VALUES (?, ?)'
      );
      insertStmt.bind([mig.version, mig.filename]);
      insertStmt.step();
      insertStmt.free();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column name')) {
        log.info(`Migration ${mig.filename}: column already exists, skipping`);
        const retryStmt = db.prepare(
          'INSERT OR IGNORE INTO schema_version (version, filename) VALUES (?, ?)'
        );
        retryStmt.bind([mig.version, mig.filename]);
        retryStmt.step();
        retryStmt.free();
      } else {
        log.error(`Migration ${mig.filename} failed:`, err);
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
  process.on('uncaughtException', () => { void emergencyFlush(); });
  process.on('unhandledRejection', () => { void emergencyFlush(); });
}

registerCrashHandlers();
