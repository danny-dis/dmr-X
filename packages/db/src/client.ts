import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveDataDir } from '@dmr-x/utils';
import { fileURLToPath } from 'node:url';

// sql.js is retained as the engine for the exported migration runner and the
// migration unit tests (they build a fresh in-memory SQLite via initSqlJs).
// The LIVE engine is Bun's native bun:sqlite — see below.
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';

// The live native handle. `any` because the engine modules are resolved at
// runtime; every use goes through methods both bun:sqlite and node:sqlite
// actually expose (mirrors the pattern in
// services/mcp-server/src/a2a/persistence.ts).
type BunDatabase = any;

// Engine acquisition: pick bun:sqlite when running under Bun (production),
// node:sqlite DatabaseSync otherwise (Node runtime — vitest's fork workers
// spawn plain Node even when vitest itself is launched via `bun`, so the
// `bun:` URL scheme is unresolvable there). The import is LAZY and marked
// @vite-ignore so Vite's module runner (vitest) leaves the dynamic import
// untouched — the specifier is resolved by the RUNTIME, which resolves it
// natively on its own runtime. Both engines expose the same surface we need:
// `.exec(sql)`, `.prepare(sql).all/.get/.run`, `.close()`.
let nativeEngine: { name: 'bun' | 'node'; open(filePath: string): BunDatabase } | null = null;
async function getNativeEngine(): Promise<typeof nativeEngine> {
  if (nativeEngine) return nativeEngine;
  if (typeof (globalThis as Record<string, unknown>).Bun !== 'undefined') {
    const { Database } = await import(/* @vite-ignore */ 'bun:sqlite') as { Database: new (path: string) => BunDatabase };
    nativeEngine = { name: 'bun', open: (filePath: string) => new Database(filePath) };
  } else {
    const { DatabaseSync } = await import('node:sqlite') as { DatabaseSync: new (path: string, opts?: { readBigInts?: boolean }) => BunDatabase };
    nativeEngine = {
      name: 'node',
      open: (filePath: string) => new DatabaseSync(filePath, { readBigInts: true }),
    };
  }
  return nativeEngine;
}

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

// Store the live native handle on globalThis so every copy of this module
// (the monorepo can load @dmr-x/db more than once under bun) shares ONE
// file-backed database. Without this, server-manager and the gateway each get
// their own `db`, so writes by one are invisible to the other.
const g = globalThis as unknown as { __dmrxSqlDb?: BunDatabase | null; __dmrxDbPath?: string; __dmrxDbInit?: Promise<DatabaseWrapper> | null };
function getDbHandle(): BunDatabase | null {
  return g.__dmrxSqlDb ?? null;
}
function setDbHandle(v: BunDatabase | null): void {
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

// ---------------------------------------------------------------------------
// Durable write helper (S6: whole-file publish machinery removed)
//
// The sql.js save path built a whole-file export, encrypted/verified it and
// atomically replaced data.db(.enc) — with .tmp staging, a cross-process
// publish lock and .lastgood/.corrupt artifacts. The native engine retired all
// of it: saveDatabase() is a WAL checkpoint and SQLite owns the file. The only
// survivor is writeFileDurable, used by doInitDb to write decrypted legacy
// data out as the native file (the .enc auto-convert) and to restore backups.
// ---------------------------------------------------------------------------

/**
 * Write `bytes` to `filePath` and force them onto the physical device.
 *
 * fs.writeFile() returns once the data is in the OS page cache, not once it is
 * durable. The newest corruption backup on the reporting machine was 54 MB of
 * pure NUL bytes — the file had been extended to full length but its contents
 * never reached the disk before the process died. Without the explicit fsync
 * that stays possible no matter how carefully the rename is sequenced.
 */
async function writeFileDurable(filePath: string, bytes: Uint8Array): Promise<void> {
  const handle = await fs.promises.open(filePath, 'w');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

let saveInFlight: Promise<void> | null = null;
let saveQueued = false;
async function saveDatabase(): Promise<void> {
  if (!getDbHandle() || !getDbPath()) return;
  // Coalescing must not drop the newest state. Returning the in-flight promise
  // meant a caller whose write landed *after* that save had already persisted
  // the database was told "saved" while its rows were never flushed. Queue a
  // follow-up save instead, so the last writer is always written out.
  if (saveInFlight) {
    saveQueued = true;
    return saveInFlight.then(() => {
      if (!saveQueued) return;
      saveQueued = false;
      return saveDatabase();
    });
  }
  const run = (async () => {
    await fs.promises.mkdir(path.dirname(getDbPath()), { recursive: true });
    try {
      // Native engine: the file-backed database is already on disk, so a
      // "save" is a WAL checkpoint that folds every committed frame into the
      // main database file. TRUNCATE both checkpoints AND resets the WAL, so a
      // reboot never has un-replayed frames to recover. Defensively wrapped: a
      // brand-new database may not have a WAL yet, and a failed checkpoint
      // must not clobber anything — the frames are still in the WAL and are
      // replayed on the next open.
      try {
        getDbHandle()!.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch (checkpointErr) {
        log.warn(`WAL checkpoint failed (non-fatal): ${checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr)}`);
        throw checkpointErr;
      }
      // Only a fully successful checkpoint clears the dirty flag. A failed
      // checkpoint (re-thrown above) stays dirty so the heartbeat retries it
      // rather than letting a reboot lose the writes.
      dirty = false;
      lastSaveAt = Date.now();
    } catch (err) {
      log.error('Failed to save database:', err);
    }
  })();
  saveInFlight = run;
  try {
    await run;
  } finally {
    if (saveInFlight === run) saveInFlight = null;
  }
}

const SAVE_DEBOUNCE_MIN_MS = 50;
const SAVE_DEBOUNCE_MAX_MS = 2000;
let lastSaveDurationMs = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaveResolvers: (() => void)[] = [];
let saving = false;
// Set true whenever a write landed since the last successful save. A hard
// reboot delivers no signal, so only the debounced deadline used to bound
// write loss — but a quiet database with no new writes never saved at all.
// The heartbeat below forces a save every MAX_STALE_MS after a write even
// when nothing else triggers one, bounding reboot loss to ~2 s.
let dirty = false;
let lastSaveAt = Date.now();
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
// Read once at module load (env var override for tests/tuning; floor 500 ms).
const MAX_STALE_MS = Math.max(500, Number(process.env.DMRX_DB_MAX_STALE_MS) || 2000);

/**
 * How long to coalesce writes before hitting the disk.
 *
 * A fixed 50 ms window assumed a save is cheap. On a real 10 MB database a
 * durable save costs well over that, so bulk work (startup migrations, a
 * marketplace import) queued a fresh save for practically every statement —
 * one run was observed issuing 2217 saves, each rewriting the whole file.
 * That write amplification is what kept a save in flight long enough to be
 * torn by the next one.
 *
 * Scaling the window with how long the last save actually took keeps small
 * databases as responsive as before while letting a large one breathe.
 */
function saveDebounceMs(): number {
  return Math.min(Math.max(SAVE_DEBOUNCE_MIN_MS, lastSaveDurationMs), SAVE_DEBOUNCE_MAX_MS);
}

/**
 * Schedule a debounced save. Multiple calls within the debounce window are
 * coalesced into a single disk write. Returns a Promise that resolves once
 * the write actually completes, so callers can await it when needed.
 */
function scheduleSave(): Promise<void> {
  dirty = true;
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
      const startedAt = Date.now();
      try {
        await saveDatabase();
      } finally {
        lastSaveDurationMs = Date.now() - startedAt;
        for (const r of resolvers) r();
        saving = false;
        if (pendingSaveResolvers.length > 0 && saveTimer === null) {
          scheduleSave();
        }
      }
    }, saveDebounceMs());
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
  // If a debounced save is mid-flight, wait for it. Bailing here meant a
  // shutdown-time flush() (e.g. closeDb) could close the sql.js handle out
  // from under an in-flight export() and drop the newest state.
  while (saving || saveInFlight) {
    await (saveInFlight ?? new Promise((r) => setTimeout(r, 1)));
  }
  // Nothing changed since the last save — skip the needless whole-file
  // export. `dirty` is set by scheduleSave() (every DatabaseWrapper write
  // path) and only cleared on a successful save, so a real pending write
  // can never be skipped.
  if (!dirty && pendingSaveResolvers.length === 0) {
    return;
  }
  saving = true;
  try {
    const resolvers = pendingSaveResolvers;
    pendingSaveResolvers = [];
    await saveDatabase();
    dirty = false;
    lastSaveAt = Date.now();
    for (const r of resolvers) r();
  } finally {
    saving = false;
    if (pendingSaveResolvers.length > 0) {
      scheduleSave();
    }
  }
}

// ---------------------------------------------------------------------------
// Migration-runner compatibility shim
// ---------------------------------------------------------------------------
//
// `runMigrations` and `migratePlaintextApiKeys` were written against sql.js's
// API shape: `db.exec(sql)` returns `[{ columns, values }]` and
// `db.prepare(sql)` returns a `{ bind, step, free }` statement. The exported
// runner keeps that contract so the migration unit tests can keep driving it
// with a real sql.js Database. This shim presents the SAME shape over the live
// native handle, so production migrations run natively without rewriting
// the runner. S6 may retire this along with the sql.js engine.

interface MigrationCompatStatement {
  bind(params: unknown[]): void;
  step(): void;
  free(): void;
}

interface MigrationCompatDb {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string): MigrationCompatStatement;
}

/**
 * Column names for a prepared statement. bun:sqlite exposes them as the
 * `columnNames` array property; node:sqlite exposes them via the `columns()`
 * method (array of `{ name, type }`). Returns [] when neither is available.
 */
function statementColumnNames(stmt: BunDatabase): string[] {
  const names = stmt?.columnNames;
  if (Array.isArray(names)) return names as string[];
  if (typeof stmt?.columns === 'function') {
    try {
      return stmt.columns().map((c: { name: string }) => c.name);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Finalize a prepared statement. bun:sqlite requires explicit finalize to
 * release the statement; node:sqlite has no `finalize()` at all (statements
 * are finalized when GC'd). Guard both so one engine's absence is harmless.
 */
function tryFinalizeStatement(stmt: BunDatabase): void {
  try {
    if (typeof stmt?.finalize === 'function') stmt.finalize();
  } catch {
    // Already finalized by all/run/get — fine.
  }
}

function createMigrationCompat(raw: BunDatabase): MigrationCompatDb {
  return {
    exec(sql: string) {
      // prepare() only executes the FIRST statement of a multi-statement
      // string on BOTH engines, so DDL / DML (migration files, CREATE etc.)
      // must go through raw.exec() which runs every statement. Only single,
      // row-returning statements (SELECT / PRAGMA / WITH / VALUES) are read
      // back as sql.js-shaped { columns, values }.
      const head = /^\s*(SELECT|PRAGMA|WITH|VALUES|EXPLAIN)\b/i.exec(sql);
      if (head) {
        const stmt = raw.prepare(sql);
        try {
          const columns = statementColumnNames(stmt);
          const rows = stmt.all() as Array<Record<string, unknown>>;
          // sql.js returns INTEGER columns as plain numbers; node:sqlite
          // returns bigints when readBigInts is on (see getNativeEngine).
          // Coerce so the migration runner's numeric version lookups
          // (migrations.get(version), applied.has(version)) keep working.
          return [{
            columns,
            values: rows.map((r) => columns.map((c) => {
              const v = r[c];
              return typeof v === 'bigint' ? Number(v) : v;
            })),
          }];
        } finally {
          tryFinalizeStatement(stmt);
        }
      }
      raw.exec(sql);
      return [];
    },
    prepare(sql: string) {
      const stmt = raw.prepare(sql);
      let params: unknown[] = [];
      return {
        bind(p: unknown[]) { params = p; },
        step() {
          stmt.run(...params);
          tryFinalizeStatement(stmt);
        },
        free() {
          tryFinalizeStatement(stmt);
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// One-time migration: encrypt any plaintext provider API keys
// ---------------------------------------------------------------------------

async function migratePlaintextApiKeys(dbWrapper: MigrationCompatDb): Promise<void> {
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
// bun:sqlite returns plain numbers by default (safeIntegers off), so this is
// a no-op on the native engine but is kept for parity and safety.
function coerceBigInt(row: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (typeof v === 'bigint') row[key] = Number(v);
  }
  return row;
}

// Wrapper that mimics better-sqlite3 API on top of the native engine
// (bun:sqlite under Bun, node:sqlite DatabaseSync under Node).
class DatabaseWrapper {
  private raw: BunDatabase;

  constructor(raw: BunDatabase) {
    this.raw = raw;
  }

  prepare(sql: string) {
    const raw = this.raw;
    return {
      all(...params: unknown[]) {
        const stmt = raw.prepare(sql);
        try {
          const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
          return rows.map(coerceBigInt);
        } finally {
          tryFinalizeStatement(stmt);
        }
      },
      get(...params: unknown[]) {
        const stmt = raw.prepare(sql);
        try {
          const row = params.length > 0 ? stmt.get(...params) : stmt.get();
          return row == null ? undefined : coerceBigInt(row);
        } finally {
          tryFinalizeStatement(stmt);
        }
      },
      run(...params: unknown[]) {
        const stmt = raw.prepare(sql);
        try {
          const res = params.length > 0 ? stmt.run(...params) : stmt.run();
          scheduleSave();
          return { changes: typeof res.changes === 'bigint' ? Number(res.changes) : res.changes };
        } finally {
          tryFinalizeStatement(stmt);
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

  pragma(p: string) {
    // The native engine supports PRAGMA statements, so execute them rather
    // than the sql.js no-op.
    this.raw.exec(p);
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
  const appliedMigrations: Array<{ version: number; filename: string; sql: string }> = [];
  for (const mig of pendingMigrations) {
    try {
      db.exec(mig.sql);
      appliedMigrations.push(mig);
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
        let fts5Failed = false;
        for (const stmt of statements) {
          if (!stmt.trim()) continue;
          try {
            db.exec(stmt);
          } catch (e2: unknown) {
            const m2 = e2 instanceof Error ? e2.message : String(e2);
            log.warn(`Migration ${mig.filename}: skipping statement (${m2})`);
            fts5Failed = true;
          }
        }
        if (!fts5Failed) {
          appliedMigrations.push(mig);
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

  // Phase 3: record each successfully applied migration in schema_version.
  // Only migrations that were actually applied (not skipped due to errors)
  // are recorded. This prevents marking partially-applied migrations as complete.
  for (const mig of appliedMigrations) {
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

// ---------------------------------------------------------------------------
// R1 — request_logs pruning to prevent unbounded DB growth.
// ---------------------------------------------------------------------------

const DEFAULT_REQUEST_LOGS_RETENTION_DAYS = Number(
  process.env.DMRX_REQUEST_LOGS_RETENTION_DAYS || '7'
);

export async function pruneRequestLogs(): Promise<void> {
  const retentionDays = Math.max(1, DEFAULT_REQUEST_LOGS_RETENTION_DAYS);
  try {
    const db = getDbHandle();
    if (!db) return;
    const stmt = db.prepare(
      `DELETE FROM request_logs WHERE timestamp < datetime('now', ?);`
    );
    const result = stmt.run(`-${retentionDays} days`);
    if (result.changes > 0) {
      log.info(`Pruned ${result.changes} request_logs rows older than ${retentionDays} days`);
    }
  } catch (err) {
    log.warn(`request_logs prune failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function initDb(): Promise<DatabaseWrapper> {
  if (getDbHandle()) return Promise.resolve(new DatabaseWrapper(getDbHandle()!));
  if (getInitPromise()) return getInitPromise()!;

  setInitPromise(doInitDb());
  return getInitPromise()!;
}

/**
 * Remove save artifacts that no live process can still be using.
 *
 * Every interrupted save leaves its unique `.tmp.<pid>.<n>` file behind, and
 * every failed open renames the database to `.corrupt.<ts>.bak`. Nothing ever
 * collected them, so the data directory had grown to 2.2 GB — 1.6 GB of dead
 * temp files and 230 MB of stale corruption backups. Temp files belonging to
 * processes that are still alive are left alone.
 */
function cleanupStaleArtifacts(dataDir: string, keepBackups = 3): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dataDir);
  } catch {
    return;
  }

  let removedTmp = 0;
  let freed = 0;
  const tmpPattern = /\.tmp\.(\d+)\.\d+$/;
  for (const name of entries) {
    if (!name.startsWith('data.db')) continue;
    const m = name.match(tmpPattern);
    if (!m) continue;
    const ownerPid = Number(m[1]);
    // Never delete a temp file that a currently running process may still be
    // writing — including our own.
    if (ownerPid === process.pid) continue;
    try {
      process.kill(ownerPid, 0);
      continue; // Process is alive; leave its temp file alone.
    } catch {
      // ESRCH (no such process) — the owner is gone, so this temp is orphaned.
    }
    const full = path.join(dataDir, name);
    try {
      freed += fs.statSync(full).size;
      fs.unlinkSync(full);
      removedTmp++;
    } catch { /* best-effort */ }
  }

  // Keep only the newest few corruption backups; they are large and every
  // restart after a bad write mints another one.
  let removedBaks = 0;
  try {
    const baks = entries
      .filter((f) => f.startsWith('data.db') && /\.corrupt\.\d+\.bak$/.test(f))
      .map((f) => ({ f, m: fs.statSync(path.join(dataDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const { f } of baks.slice(keepBackups)) {
      const full = path.join(dataDir, f);
      try {
        freed += fs.statSync(full).size;
        fs.unlinkSync(full);
        removedBaks++;
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }

  if (removedTmp || removedBaks) {
    log.info(
      `Cleaned ${removedTmp} orphaned temp file(s) and ${removedBaks} old corruption backup(s), freeing ${(freed / 1024 / 1024).toFixed(1)} MB`,
    );
  }
}

// ---------------------------------------------------------------------------
// Corruption detection + recovery
// ---------------------------------------------------------------------------

/**
 * SQLite's 16-byte magic header (sqlite.org/fileformat.html §1.4). Both native
 * engines open a file with the WRONG header without throwing — the "file is
 * not a database" error is deferred to the first executed statement — so the
 * header is validated up front in doInitDb, before the engine ever sees the
 * file. Mirrors the same check used to validate backup candidates below.
 */
function isSqliteDatabase(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).subarray(0, 15).toString('latin1') === 'SQLite format 3';
}

/**
 * Escape a filesystem path as a SQL string literal (single quotes doubled).
 */
function quotePathLiteral(filePath: string): string {
  return `'${filePath.replace(/'/g, "''")}'`;
}

/**
 * Recover from a corrupt or unopenable database file: move the broken file
 * aside as a dated .corrupt backup, then auto-restore the newest VALID .bak
 * candidate (pre-migration snapshots and prior .corrupt renames); with no
 * valid backup, fall back to an in-memory database — never a fresh empty file,
 * which would shadow the preserved .corrupt backup (see the DATA LOSS note).
 * Shared by the up-front magic-header check, the open() failure path, and the
 * deferred first-statement failure path.
 */
async function recoverFromCorruptDb(
  nativePath: string,
  dataDir: string,
  keySet: boolean,
  engine: typeof nativeEngine,
): Promise<BunDatabase> {
  // Move the broken file out of the way
  const backupPath = `${nativePath}.corrupt.${Date.now()}.bak`;
  try { fs.renameSync(nativePath, backupPath); } catch { /* best-effort */ }

  // ── Auto-restore from the most recent backup ──────────────────
  // The pre-S5 "last good" snapshot files (.lastgood / .enc.lastgood)
  // have had no writer since S5 and were retired in S6 — dated .bak
  // backups (pre-migration snapshots and prior .corrupt renames) are the
  // only recovery material left.
  try {
    const candidates = fs.readdirSync(dataDir)
      .filter(f => f.startsWith(path.basename(nativePath)) && f.endsWith('.bak'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(dataDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime); // newest first

    for (const cand of candidates) {
      try {
        let bytes: Buffer<ArrayBufferLike> = fs.readFileSync(path.join(dataDir, cand.name));
        // Legacy whole-file-encrypted backups (data.db.enc.*.bak) need a
        // key to open.
        if (keySet && cand.name.includes('.enc.')) {
          const { decryptBytesRaw } = await import('@dmr-x/utils');
          bytes = decryptBytesRaw(bytes);
        }
        if (!isSqliteDatabase(bytes)) continue;
        await writeFileDurable(nativePath, bytes);
        const reopened = engine!.open(nativePath);
        log.warn(`Restored database from backup: ${cand.name}`);
        return reopened;
      } catch {
        // This backup is also corrupt or incompatible — skip it
      }
    }
  } catch { /* readdir failed — ignore */ }

  // Starting empty here means real user data (providers, keys, request
  // history) just became unreachable. Say so unmistakably. The broken
  // file stays preserved as <backupPath> for manual recovery.
  log.error(
    `DATA LOSS: could not open ${nativePath} or any backup — starting with an EMPTY database. ` +
    `The previous file was preserved as ${backupPath}. If DMRX_ENCRYPTION_KEY changed, restore the ` +
    `old key and restart before doing anything else.`,
  );
  // In-memory on purpose: never write a fresh empty file over the
  // preserved .corrupt backup during this run.
  return engine!.open(':memory:');
}

async function doInitDb(): Promise<DatabaseWrapper> {
  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  setDbPath(path.join(dataDir, 'data.db'));
  cleanupStaleArtifacts(dataDir);

  // DMRX_ENCRYPTION_KEY drives the LEGACY whole-file-encrypted path
  // (data.db.enc). The ACTIVE save path produces a plaintext native data.db
  // (see saveDatabase()), so the key is only used here — to auto-convert an
  // existing data.db.enc and to open legacy encrypted backups. Column-level
  // encryption is a later phase.
  const keySet = !!process.env.DMRX_ENCRYPTION_KEY;
  const nativePath = getDbPath();
  const encPath = `${nativePath}.enc`;

  // ── Auto-convert a legacy encrypted database ──────────────────────────
  // S6's sole remaining whole-file-encryption READ path. Converts only when
  // no native plaintext data.db exists yet — an existing data.db is ALWAYS
  // authoritative and is never converted-over or clobbered. The .enc is
  // retained as a backup after a successful convert (deliberately never
  // deleted here), and the same .enc is never re-converted: once data.db
  // exists this branch is skipped entirely. The decrypted payload is staged
  // through data.db.tmp and atomically renamed into place, so an interrupted
  // convert leaves no partial data.db behind — at worst a stale .tmp that the
  // next startup truncates before re-attempting. A corrupt .enc produces a
  // loud error and leaves BOTH the .enc and any healthy data.db untouched.
  if (!fs.existsSync(nativePath) && keySet && fs.existsSync(encPath)) {
    const tmpPath = `${nativePath}.tmp`;
    try {
      const { decryptBytesRaw } = await import('@dmr-x/utils');
      // readFileSync returns after closing its handle — no .enc handle stays
      // open across the write below or the engine's open of data.db.
      const bytes = decryptBytesRaw(fs.readFileSync(encPath));
      if (bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3') {
        throw new Error('decrypted .enc payload is not a SQLite database');
      }
      // writeFileDurable opens with 'w' (truncating any stale .tmp from an
      // interrupted earlier attempt) and closes before the rename; the rename
      // destination does not exist, so there is no Windows EPERM window.
      await writeFileDurable(tmpPath, bytes);
      await fs.promises.rename(tmpPath, nativePath);
      log.info('Migrated legacy encrypted database to native plaintext data.db (data.db.enc retained as backup)');
    } catch (convertErr) {
      // Discard any partial .tmp — never publish a torn file as data.db — and
      // leave the .enc untouched. A healthy data.db is never reached here
      // because this branch only runs when data.db does not exist.
      try { await fs.promises.unlink(tmpPath); } catch { /* best-effort */ }
      log.error(`Legacy .enc conversion failed (data.db.enc left untouched): ${convertErr instanceof Error ? convertErr.message : String(convertErr)}`);
    }
  }

  // Load the native engine once. Production (Bun) resolves bun:sqlite; the
  // vitest suite (Node fork workers) resolves node:sqlite DatabaseSync. Both
  // engines open a file-backed database with `new Database(':memory:')` too.
  const engine = await getNativeEngine();
  const openNative = (filePath: string): BunDatabase => engine!.open(filePath);

  let db: BunDatabase | null = null;
  // Set true once recoverFromCorruptDb has run. Guards the deferred-PRAGMA
  // recovery below from re-entering recovery on a RESTORED backup or the
  // :memory: fallback (an infinite-recursion guard).
  let recovered = false;
  if (fs.existsSync(nativePath)) {
    // Corruption guard (industry standard — sqlite.org/fileformat.html §1.4):
    // a real SQLite database MUST begin with the "SQLite format 3" magic
    // header. bun:sqlite and node:sqlite both OPEN a file with garbage bytes
    // WITHOUT throwing at construction — the "file is not a database" error is
    // deferred to the first executed statement (the PRAGMA block below) and
    // used to fire outside any recovery path. The header is therefore
    // validated BEFORE the engine ever sees the file. A zero-length file is
    // exempt: SQLite opens a 0-byte file as a brand-new EMPTY database, which
    // is a legitimate state, not corruption.
    let magicOk = true;
    try {
      const head = Buffer.alloc(16);
      const headHandle = await fs.promises.open(nativePath, 'r');
      let bytesRead = 0;
      try {
        ({ bytesRead } = await headHandle.read(head, 0, 16, 0));
      } finally {
        await headHandle.close();
      }
      magicOk = bytesRead === 0 || isSqliteDatabase(head.subarray(0, bytesRead));
    } catch (headErr) {
      // Could not read the header (e.g. data.db is a directory) — let the
      // engine try; its own open error (and the PRAGMA guard below) still
      // routes into recovery.
      magicOk = true;
    }
    if (!magicOk) {
      log.error('Failed to open database: file is not a database (magic header check failed)');
      db = await recoverFromCorruptDb(nativePath, dataDir, keySet, engine);
      recovered = true;
    } else {
      try {
        db = openNative(nativePath);
      } catch (openErr) {
        // Log the exact error so operators can diagnose file truncation or
        // actual corruption.
        log.error(`Failed to open database: ${openErr instanceof Error ? openErr.message : String(openErr)}`);
        db = await recoverFromCorruptDb(nativePath, dataDir, keySet, engine);
        recovered = true;
      }
    }
  } else {
    db = openNative(nativePath);
  }

  // The PRAGMA block is the FIRST statement executed on the handle, so a
  // garbage file whose first 15 bytes happen to look like the magic header
  // (or a torn page-1) still fails HERE with a deferred "file is not a
  // database" / "database disk image is malformed" error. Wrapping it keeps
  // that failure inside recovery: if the handle still points at the ORIGINAL
  // corrupt file (recovery has not run), close it and recover; a restored
  // backup or the :memory: fallback is never re-recovered.
  try {
    setDbHandle(db!);
    // busy_timeout FIRST, before journal_mode: on a cold open while another
    // process is still recovering the WAL, the busy handler must already be
    // installed or the WAL-mode switch fails instantly with SQLITE_BUSY.
    getDbHandle()!.exec('PRAGMA busy_timeout = 5000;');
    getDbHandle()!.exec('PRAGMA journal_mode = WAL;');
    getDbHandle()!.exec('PRAGMA synchronous = FULL;');
    // Explicitly keep foreign_keys OFF to match the behavior that shipped under
    // sql.js (which never enforced FK constraints). bun:sqlite defaults to OFF,
    // but node:sqlite's DatabaseSync defaults to ON — so we must set it
    // explicitly or the engine swap silently changes delete/insert semantics
    // for existing callers written against FK-off behavior.
    getDbHandle()!.exec('PRAGMA foreign_keys = OFF;');
  } catch (pragmaErr) {
    log.error(`Failed to configure database: ${pragmaErr instanceof Error ? pragmaErr.message : String(pragmaErr)}`);
    if (!recovered) {
      recovered = true;
      try { getDbHandle()?.close(); } catch { /* best-effort */ }
      db = await recoverFromCorruptDb(nativePath, dataDir, keySet, engine);
      setDbHandle(db!);
    }
  }

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
    // VACUUM INTO produces a consistent snapshot even with concurrent
    // writers, is compact, and — unlike a raw file copy — needs no manual
    // checkpoint first (sqlite.org/backup.html).
    getDbHandle()!.exec(`VACUUM INTO ${quotePathLiteral(preMigrationPath)}`);
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
  const migrationResult = runMigrations(
    createMigrationCompat(getDbHandle()!) as unknown as SqlJsDatabase,
    migrations,
    { strict: isProduction },
  );
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

  // Force a save at most MAX_STALE_MS after any write even when no new
  // writes (and thus no debounced save) arrives — a hard reboot delivers no
  // signal, so without this the newest state could sit un-persisted for an
  // unbounded time. unref() is critical: the timer must not hold the process
  // open at shutdown.
  let heartbeatTicks = 0;
  heartbeatTimer = setInterval(() => {
    heartbeatTicks++;
    if (dirty && Date.now() - lastSaveAt >= MAX_STALE_MS) {
      void flush();
    }
    // R1 — prune request_logs every ~60s to prevent unbounded DB growth.
    // At 1 req/s, request_logs reaches 500k rows in ~6 days, causing 2-second
    // event-loop-blocking saves. Pruning keeps it bounded to ~7 days of data.
    if (heartbeatTicks % 60 === 0) {
      void pruneRequestLogs();
    }
  }, Math.max(250, Math.floor(MAX_STALE_MS / 2)));
  heartbeatTimer.unref();

  // Migrate plaintext API keys to encrypted (one-time pass)
  await migratePlaintextApiKeys(createMigrationCompat(getDbHandle()!));

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
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    // R3 — await the in-flight flush before closing the DB handle. The audit
    // found that a shutdown-time flush() could early-return `if (saving)`
    // without awaiting, then closeDb() called raw.close() which freed the
    // WASM heap out from under an in-flight export() — dropping the newest
    // writes (billing deductions, quota counters, conversation messages).
    await flush();
    try {
      getDbHandle()!.exec('PRAGMA optimize;');
    } catch {
      // Non-fatal; close must proceed regardless.
    }
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
