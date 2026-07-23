import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';

import { MIGRATIONS } from './migrations-data.js';

// Re-export sql.js for tests and consumers that need to create a fresh
// in-memory database (e.g. unit tests for the migration runner). The
// re-export is resolved relative to this file's location, so consumers
// don't need sql.js in their own node_modules.
export { initSqlJs };
export type { SqlJsDatabase };

// Use console for logging since @dmr-x/utils may depend on @dmr-x/db (avoid circular)
const log = {
  info: (...args: unknown[]) => console.log('[dmr-x]', ...args),
  error: (...args: unknown[]) => console.error('[dmr-x]', ...args),
  warn: (...args: unknown[]) => console.warn('[dmr-x]', ...args),
};

// Store the live sql.js handle on globalThis so every copy of this module
// (the monorepo can load @dmr-x/db more than once under bun) shares ONE
// in-memory database. Without this, server-manager and the gateway each get
// their own `db`, so writes by one are invisible to the other.
const g = globalThis as unknown as { __dmrxSqlDb?: SqlJsDatabase | null; __dmrxDbPath?: string; __dmrxDbInit?: Promise<DatabaseWrapper> | null };
function getDbHandle(): SqlJsDatabase | null {
  return g.__dmrxSqlDb ?? null;
}
function setDbHandle(v: SqlJsDatabase | null): void {
  g.__dmrxSqlDb = v;
  if (v) (v as any).__marker = (v as any).__marker ?? `raw-${Math.random().toString(36).slice(2, 8)}`;
}
function getDbPath(): string {
  return g.__dmrxDbPath ?? '';
}
function setDbPath(v: string): void {
  g.__dmrxDbPath = v;
}
function getInitPromise(): Promise<DatabaseWrapper> | null {
  return g.__dmrxDbInit ?? null;
}
function setInitPromise(v: Promise<DatabaseWrapper> | null): void {
  g.__dmrxDbInit = v;
}

// ---------------------------------------------------------------------------
// FTS5 splitter
// ---------------------------------------------------------------------------

/**
 * Splits a migration SQL string into a sequence of statements, isolating
 * FTS5 virtual tables and any statement that references them. The result
 * is a series of SQL statements that are safe to run on a SQLite build
 * that doesn't include the FTS5 module.
 */
function splitFt5(sql: string): string[] {
  const ftsTableMatch = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+USING\s+fts5/i.exec(sql);
  if (!ftsTableMatch) {
    return [sql];
  }
  const ftsTable = ftsTableMatch[1];
  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s + ';');

  return statements.filter((stmt) => {
    const upper = stmt.toUpperCase();
    if (upper.includes('USING FTS5')) return false;
    if (upper.includes(` ${ftsTable.toUpperCase()}`)) return false;
    return true;
  });
}

// Serialize saves so two callers never write/rename the same tmpPath at once.
// Without this, scheduleSave() + flush() can race (TOCTOU on the `saving`
// flag) and run two concurrent saveDatabase() calls: the first rename deletes
// the .tmp file, the second rename then throws ENOENT and crashes the process.

/**
 * Atomically publish `src` as `dest`.
 *
 * `fs.rename` on Windows cannot replace a destination that still has an open
 * handle (live gateway flush, antivirus, search indexer) — it fails with
 * EPERM. We retry briefly (the lock is usually momentary), then fall back to
 * `copyFile` which overwrites a locked file. The destination is never deleted
 * before the new bytes are fully written, so a failed replace only leaves a
 * stray temp file — it can never truncate or zero the live database.
 */
async function atomicReplace(src: string, dest: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.promises.rename(src, dest);
      return;
    } catch (err: any) {
      if (err?.code === 'EPERM' || err?.code === 'EBUSY') {
        if (attempt < 4) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          continue;
        }
        // Last resort: copyFile overwrites an in-use file on Windows.
        await fs.promises.copyFile(src, dest);
        try { await fs.promises.unlink(src); } catch { /* best-effort */ }
        return;
      }
      throw err;
    }
  }
}

let saveInFlight: Promise<void> | null = null;
let tmpCounter = 0;
async function saveDatabase(): Promise<void> {
  if (!getDbHandle() || !getDbPath()) return;
  if (saveInFlight) return saveInFlight;
  const run = (async () => {
    await fs.promises.mkdir(path.dirname(getDbPath()), { recursive: true });
    const keySet = !!process.env.DMRX_ENCRYPTION_KEY;
    const targetPath = keySet ? `${getDbPath()}.enc` : getDbPath();
    const lastGoodPath = `${targetPath}.lastgood`;
    // Unique temp file per save. A fixed ".tmp" name let two concurrent
    // saves (e.g. the init-time saveDatabase() and a debounced scheduleSave)
    // overwrite each other's temp and then fail rename with ENOENT — which
    // left a corrupt/zeroed on-disk file and forced a fresh DB on reboot.
    const tmpPath = `${targetPath}.tmp.${process.pid}.${++tmpCounter}`;
    try {
      const data = getDbHandle()!.export();
      // Guard against persisting an empty/invalid export. A mid-crash export
      // can yield a zero-byte buffer; writing that would clobber the last
      // good on-disk copy and force a "fresh database" reset on the next
      // reboot (the root cause of the dashboard resetting to zero).
      if (!data || data.byteLength === 0) {
        log.warn('Refusing to persist empty database export — keeping existing on-disk copy');
        return;
      }
      let toWrite: Buffer;
      if (keySet) {
        // Encrypt the on-disk database at rest (AES-256-GCM).
        const { encryptBytes } = await import('@dmr-x/utils');
        toWrite = Buffer.from(encryptBytes(Buffer.from(data)));
        // Never leave a plaintext copy behind once encryption is enabled.
        try { if (fs.existsSync(getDbPath())) await fs.promises.unlink(getDbPath()); } catch { /* best-effort */ }
      } else {
        toWrite = Buffer.from(data);
      }
      // Write to a temporary file first to ensure atomic replacement.
      // This prevents database corruption if the process crashes mid-write.
      await fs.promises.writeFile(tmpPath, toWrite);
      // Atomically publish the new file. On Windows, fs.rename over an
      // existing target fails with EPERM when the destination still has an
      // open handle (the live gateway's own flush, an antivirus scan, the
      // search indexer). Retry with a short backoff, then fall back to
      // copyFile (which can overwrite a locked file). CRITICAL: the existing
      // good file is never deleted before the new one is in place, so a
      // failed replace only leaves a stray temp — it can never zero the DB.
      await atomicReplace(tmpPath, targetPath);
      // Keep a rolling "last good" copy. If the live target is ever caught
      // mid-write during the next crash, recovery prefers this complete
      // snapshot instead of falling back to a brand-new empty database.
      try { await fs.promises.copyFile(targetPath, lastGoodPath); } catch { /* best-effort */ }
    } catch (err) {
      log.error('Failed to save database:', err);
      // Best-effort cleanup of the temporary file
      try {
        if (fs.existsSync(tmpPath)) {
          await fs.promises.unlink(tmpPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  })();
  saveInFlight = run;
  try {
    await run;
  } finally {
    if (saveInFlight === run) saveInFlight = null;
  }
}

const SAVE_DEBOUNCE_MS = 50;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaveResolvers: (() => void)[] = [];
let saving = false;

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
      if (saving) return;
      saving = true;
      const resolvers = pendingSaveResolvers;
      pendingSaveResolvers = [];
      try {
        await saveDatabase();
      } finally {
        for (const r of resolvers) r();
        saving = false;
        if (pendingSaveResolvers.length > 0 && saveTimer === null) {
          scheduleSave();
        }
      }
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
  if (saving) return;
  saving = true;
  try {
    const resolvers = pendingSaveResolvers;
    pendingSaveResolvers = [];
    await saveDatabase();
    for (const r of resolvers) r();
  } finally {
    saving = false;
    if (pendingSaveResolvers.length > 0) {
      scheduleSave();
    }
  }
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
    try {
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
    } finally {
      stmt.free();
    }
  } catch (err) {
    log.error('API key migration failed (non-fatal):', err);
  }
}

// sql.js returns BigInt for INTEGER columns; JSON.stringify cannot
// serialize BigInt. This helper converts every BigInt in a row to Number.
function coerceBigInt(row: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (typeof v === 'bigint') row[key] = Number(v);
  }
  return row;
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
            rows.push(coerceBigInt(stmt.getAsObject()));
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
            return coerceBigInt(stmt.getAsObject());
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

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN TRANSACTION');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      scheduleSave();
      return result;
    } catch (err) {
      try {
        this.raw.exec('ROLLBACK');
      } catch (rollbackErr) {
        log.error('Rollback failed:', rollbackErr);
      }
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

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

export interface MigrationMismatch {
  version: number;
  filename: string;
  /** The checksum we stored in `schema_version.checksum` (or 'NULL'). */
  stored: string;
  /** The expected checksum, or 'MISSING' if no migration source was found. */
  expected: string;
}

export interface MigrationRunOptions {
  /** When true, throw if any checksum verification fails. */
  strict: boolean;
}

export interface MigrationRunResult {
  /** Versions of migrations that were applied during this run. */
  applied: number[];
  /** Number of pre-existing rows whose checksum was backfilled. */
  backfilled: number;
  /** Versions whose stored checksum no longer matches the migration source. */
  mismatches: MigrationMismatch[];
}

/**
 * Compute the SHA-256 hex digest of a migration's SQL content. We use this
 * to detect when a migration's SQL has been edited after being applied.
 */
function computeChecksum(sql: string): string {
  return crypto.createHash('sha256').update(sql, 'utf-8').digest('hex');
}

/**
 * Returns true if the given SQLite table has a column with the given name.
 * Uses `PRAGMA table_info`, which is supported on every sql.js build.
 */
function tableHasColumn(
  db: SqlJsDatabase,
  table: string,
  column: string,
): boolean {
  // Validate table name to prevent SQL injection via PRAGMA interpolation
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return false;
  try {
    const rows = db.exec(`PRAGMA table_info(${table})`);
    if (rows.length === 0 || !rows[0]?.values) return false;
    return rows[0].values.some((row) => row[1] === column);
  } catch {
    return false;
  }
}

function insertSchemaVersionRow(
  db: SqlJsDatabase,
  version: number,
  filename: string,
  checksum: string | null,
  hasChecksumColumn: boolean,
): void {
  if (hasChecksumColumn) {
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO schema_version (version, filename, checksum) VALUES (?, ?, ?)',
    );
    stmt.bind([version, filename, checksum]);
    try {
      stmt.step();
    } finally {
      stmt.free();
    }
  } else {
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO schema_version (version, filename) VALUES (?, ?)',
    );
    stmt.bind([version, filename]);
    try {
      stmt.step();
    } finally {
      stmt.free();
    }
  }
}

/**
 * Apply pending migrations and verify the checksums of already-applied
 * ones. Exported for unit testing; `initDb()` calls this internally.
 *
 * The runner computes a SHA-256 of each migration's SQL content and
 * stores it in `schema_version.checksum`. On startup it re-hashes the
 * migration source (whether from disk or the embedded `MIGRATIONS`
 * constant) and compares. A mismatch means the migration's SQL has
 * been modified after being applied — the schema is no longer what
 * the runner thinks it is, so we refuse to start (in strict mode) or
 * warn loudly (in non-strict / dev mode).
 *
 * Rows whose checksum is NULL (created before migration 016 added the
 * column) are backfilled in place. This is a one-time pass; once all
 * rows have a checksum, future startups will detect tampering.
 */
export function runMigrations(
  db: SqlJsDatabase,
  migrations: ReadonlyMap<number, { version: number; filename: string; sql: string }>,
  options: MigrationRunOptions,
): MigrationRunResult {
  const result: MigrationRunResult = {
    applied: [],
    backfilled: 0,
    mismatches: [],
  };

  // Create schema_version table if it doesn't exist (first-run).
  // Note: this CREATE is the original (pre-016) shape — we add the
  // checksum column in migration 016 itself.
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
    // schema_version table doesn't yet exist; the first migration will create it
  }

  // Compute pending migrations
  const pendingMigrations = [...migrations.values()]
    .filter((m) => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);

  // Phase 1: apply SQL for each pending migration
  for (const mig of pendingMigrations) {
    try {
      db.exec(mig.sql);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column name')) {
        log.info(`Migration ${mig.filename}: column already exists, skipping`);
      } else if (msg.includes('no such module: fts5')) {
        // FTS5 is not compiled into this SQLite build (the sql.js WASM
        // shipping with some Bun versions doesn't include it). The
        // conversation search feature will be unavailable, but the
        // rest of the migration is safe to apply. Split the SQL and
        // drop any FTS5 statements, then retry.
        log.warn(
          `Migration ${mig.filename}: FTS5 module unavailable, applying migration without the search index`,
        );
        const statements = splitFt5(mig.sql);
        for (const stmt of statements) {
          if (!stmt.trim()) continue;
          try {
            db.exec(stmt);
          } catch (e2: unknown) {
            const m2 = e2 instanceof Error ? e2.message : String(e2);
            log.warn(`Migration ${mig.filename}: skipping statement (${m2})`);
          }
        }
      } else {
        log.error(`Migration ${mig.filename} failed:`, err);
        throw err;
      }
    }
  }

  // Phase 2: detect whether the checksum column exists (added by 016).
  // Phase 1 may have just applied 016, so we re-check rather than
  // tracking it via the migrations list.
  const hasChecksumColumn = tableHasColumn(db, 'schema_version', 'checksum');

  // Phase 3: record each newly applied migration in schema_version.
  // The INSERT shape depends on whether the checksum column exists.
  for (const mig of pendingMigrations) {
    const checksum = computeChecksum(mig.sql);
    insertSchemaVersionRow(db, mig.version, mig.filename, checksum, hasChecksumColumn);
    result.applied.push(mig.version);
  }

  // Phase 4: verify the checksum of every applied row. Rows with
  // checksum IS NULL are backfilled in place (one-time migration for
  // databases created before migration 016). Rows with a non-NULL
  // checksum that no longer matches the migration source are
  // recorded as mismatches.
  try {
    const selectSql = hasChecksumColumn
      ? 'SELECT version, filename, checksum FROM schema_version'
      : 'SELECT version, filename, CAST(NULL AS TEXT) AS checksum FROM schema_version';
    const rows = db.exec(selectSql);
    if (rows.length > 0 && rows[0].values) {
      for (const row of rows[0].values) {
        const version = row[0] as number;
        const filename = row[1] as string;
        const storedChecksum = (row[2] as string | null) ?? null;
        const mig = migrations.get(version);
        if (!mig) {
          // No matching source on disk or in the embedded constant.
          // Refuse to silently ignore this — it usually means a
          // migration was deleted or the embedded constant was
          // rebuilt with a different set of versions.
          log.error(
            `Schema version ${version} (${filename}) has no matching migration source.`,
          );
          result.mismatches.push({
            version,
            filename,
            stored: storedChecksum ?? 'NULL',
            expected: 'MISSING',
          });
          continue;
        }
        const expectedChecksum = computeChecksum(mig.sql);
        if (storedChecksum === null) {
          // Backfill: this row predates migration 016
          if (hasChecksumColumn) {
            const upd = db.prepare(
              'UPDATE schema_version SET checksum = ? WHERE version = ?',
            );
            upd.bind([expectedChecksum, version]);
            try {
              upd.step();
            } finally {
              upd.free();
            }
          }
          result.backfilled++;
        } else if (storedChecksum !== expectedChecksum) {
          log.error(
            `Migration ${filename} (version ${version}) checksum mismatch. ` +
              `Stored: ${storedChecksum}, expected: ${expectedChecksum}. ` +
              `The migration file has been modified after being applied.`,
          );
          result.mismatches.push({
            version,
            filename,
            stored: storedChecksum,
            expected: expectedChecksum,
          });
        }
      }
    }
  } catch (err) {
    log.warn('Failed to verify migration checksums:', err);
  }

  if (result.mismatches.length > 0) {
    if (options.strict) {
      throw new Error(
        `Migration checksum verification failed: ${result.mismatches.length} mismatch(es) detected. ` +
          `Refusing to start in strict mode. See logs for details.`,
      );
    } else {
      log.warn(
        `Migration checksum verification found ${result.mismatches.length} mismatch(es). ` +
          `Running in non-strict mode; logs only.`,
      );
    }
  }

  return result;
}

export function initDb(): Promise<DatabaseWrapper> {
  if (getDbHandle()) return Promise.resolve(new DatabaseWrapper(getDbHandle()!));
  if (getInitPromise()) return getInitPromise()!;

  setInitPromise(doInitDb());
  return getInitPromise()!;
}

async function doInitDb(): Promise<DatabaseWrapper> {
  const SQL = await initSqlJs();

  const dataDir = process.env.DMRX_DATA_DIR || path.join(os.homedir(), '.dmr-x');
  fs.mkdirSync(dataDir, { recursive: true });
  setDbPath(path.join(dataDir, 'data.db'));

  // When DMRX_ENCRYPTION_KEY is set, the on-disk DB is stored encrypted as
  // data.db.enc. Otherwise we use the plaintext data.db (dev / local mode).
  const keySet = !!process.env.DMRX_ENCRYPTION_KEY;
  const activeDbPath = keySet ? `${getDbPath()}.enc` : getDbPath();

  async function openDbFile(filePath: string): Promise<SqlJsDatabase> {
    const raw = fs.readFileSync(filePath);
    if (keySet) {
      const { decryptBytes } = await import('@dmr-x/utils');
      // encryptBytes() returns a hex STRING; it is persisted as UTF-8 bytes,
      // so recover the original hex string with toString('utf8') (NOT 'hex',
      // which would double-encode and corrupt the ciphertext).
      return new SQL.Database(decryptBytes(raw.toString('utf8')));
    }
    return new SQL.Database(raw);
  }

  if (fs.existsSync(activeDbPath)) {
    try {
      setDbHandle(await openDbFile(activeDbPath));
    } catch (openErr) {
      // Log the exact error so operators can diagnose sql.js version
      // mismatches, file truncation, or actual corruption.
      log.error(`Failed to open database: ${openErr instanceof Error ? openErr.message : String(openErr)}`);

      // Move the broken file out of the way
      const backupPath = `${activeDbPath}.corrupt.${Date.now()}.bak`;
      try { fs.renameSync(activeDbPath, backupPath); } catch { /* best-effort */ }

      // ── Auto-restore from the most recent backup ──────────────────
      // Look for any .bak files produced by previous corruption events,
      // pre-migration snapshots, or manual backups.  Try each from
      // newest to oldest until one opens successfully.
      const dataDir = path.dirname(activeDbPath);
      const basename = path.basename(activeDbPath); // e.g. "data.db.enc"
      let restored = false;
      // ── Try the rolling "last good" snapshot first ───────────────
      // Updated by saveDatabase() after every successful write, so it is
      // always the most recent complete (non-mid-write) copy. Prefer it
      // over dated .bak files to avoid losing real data on reboot.
      const lastGoodPath = `${activeDbPath}.lastgood`;
      if (!restored && fs.existsSync(lastGoodPath)) {
        try {
          const lgBuf = fs.readFileSync(lastGoodPath);
          setDbHandle(keySet
            ? new SQL.Database((await import('@dmr-x/utils')).decryptBytes(lgBuf.toString('utf8')))
            : new SQL.Database(lgBuf));
          fs.copyFileSync(lastGoodPath, activeDbPath);
          log.warn(`Restored database from last-good snapshot: ${lastGoodPath}`);
          restored = true;
        } catch {
          // lastgood is also unusable — fall through to .bak candidates
        }
      }
      try {
        const candidates = fs.readdirSync(dataDir)
          .filter(f => f.startsWith(basename) && f.endsWith('.bak'))
          .map(f => ({
            name: f,
            mtime: fs.statSync(path.join(dataDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime); // newest first

        for (const cand of candidates) {
          try {
            const candBuf = fs.readFileSync(path.join(dataDir, cand.name));
            setDbHandle(keySet
              ? new SQL.Database((await import('@dmr-x/utils')).decryptBytes(candBuf.toString('utf8')))
              : new SQL.Database(candBuf));
            // Restore the good file back to the primary path
            fs.copyFileSync(path.join(dataDir, cand.name), activeDbPath);
            log.warn(`Restored database from backup: ${cand.name}`);
            restored = true;
            break;
          } catch {
            // This backup is also corrupt or incompatible — skip it
          }
        }
      } catch { /* readdir failed — ignore */ }

      if (!restored) {
        log.warn('No valid backup found — creating fresh database');
        setDbHandle(new SQL.Database());
      }
    }
  } else {
    setDbHandle(new SQL.Database());
  }

  // Enable foreign key enforcement (SQLite has it off by default)
  getDbHandle()!.exec('PRAGMA foreign_keys = ON;');

  // Enable Write-Ahead Logging for concurrent reads without blocking on writes
  getDbHandle()!.exec('PRAGMA journal_mode = WAL;');

  // Load migrations from disk when present, then backfill any missing versions
  // from embedded SQL. Some dev/dist layouts can have a partial migrations
  // directory, so a filesystem-only load would silently skip newer migrations.
  const migrations = new Map<number, { version: number; filename: string; sql: string }>();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Try multiple candidate directories for the migrations SQL files.
  // When running from compiled dist/, the src/migrations/ directory may
  // be the only one present (dist/migrations/ is not copied by tsc).
  const candidateDirs = [
    path.join(__dirname, 'migrations'),                                    // dist/migrations or src/migrations
    path.join(__dirname, '..', 'src', 'migrations'),                       // ../src/migrations (from dist/)
    path.join(__dirname, '..', '..', 'packages', 'db', 'src', 'migrations'), // monorepo fallback
  ];

  let migrationsDir: string | null = null;
  for (const candidate of candidateDirs) {
    if (fs.existsSync(candidate)) {
      migrationsDir = candidate;
      break;
    }
  }

  if (migrationsDir) {
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

  // ── Pre-migration backup ────────────────────────────────────────
  // Snapshot the database before applying any pending migrations so we
  // can recover if a migration corrupts the file or the user needs to
  // roll back.  Keep at most 5 pre-migration snapshots to avoid
  // filling the data directory.
  try {
    const preMigrationPath = `${getDbPath()}.pre-migration.${Date.now()}.bak`;
    fs.copyFileSync(getDbPath(), preMigrationPath);
    log.info(`Pre-migration backup: ${preMigrationPath}`);

    // Prune old pre-migration backups (keep newest 5)
    const dataDir = path.dirname(getDbPath());
    const basename = path.basename(getDbPath());
    const preMigrationBackups = fs.readdirSync(dataDir)
      .filter(f => f.startsWith(`${basename}.pre-migration.`) && f.endsWith('.bak'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dataDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of preMigrationBackups.slice(5)) {
      try { fs.unlinkSync(path.join(dataDir, old.name)); } catch { /* best-effort */ }
    }
  } catch (backupErr) {
    log.warn(`Pre-migration backup failed (non-fatal): ${backupErr instanceof Error ? backupErr.message : String(backupErr)}`);
  }

  // Apply pending migrations and verify checksums of already-applied ones.
  // Strict mode (production) refuses to start on mismatch; dev mode logs only.
  const isProduction = process.env.NODE_ENV === 'production';
  const migrationResult = runMigrations(getDbHandle()!, migrations, { strict: isProduction });
  if (migrationResult.applied.length > 0) {
    log.info(
      `Applied ${migrationResult.applied.length} migration(s): ${migrationResult.applied.join(', ')}`,
    );
  }
  if (migrationResult.backfilled > 0) {
    log.info(
      `Backfilled ${migrationResult.backfilled} pre-existing migration checksum(s).`,
    );
  }

  await saveDatabase();
  log.info(`SQLite database ready at ${getDbPath()}`);

  // Migrate plaintext API keys to encrypted (one-time pass)
  await migratePlaintextApiKeys(getDbHandle()!);

  return new DatabaseWrapper(getDbHandle()!);
}

export function getDb(): DatabaseWrapper {
  if (!getDbHandle()) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return new DatabaseWrapper(getDbHandle()!);
}

export async function closeDb() {
  if (getDbHandle()) {
    await flush();
    getDbHandle()!.close();
    setDbHandle(null);
    setInitPromise(null);
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
