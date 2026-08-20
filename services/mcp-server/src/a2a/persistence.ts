/**
 * A2A persistence + push-notification layer.
 *
 * - Tasks are mirrored to a local sqlite file so they survive a process
 *   restart (single-instance; not a shared cluster store). This replaces
 *   the "in-memory only" ceiling noted in task-manager.ts.
 * - When a task reaches a terminal state, any configured
 *   pushNotificationConfig URL is POSTed the task (push-notifications fire,
 *   closing the "stored but never sent" gap).
 *
 * Prefers Bun's built-in `bun:sqlite`; falls back to Node's `node:sqlite`
 * (Node 22.5+) — no new dependency. Both imports are LAZY (dynamic), so a
 * runtime that lacks either can still run the server in-memory mode without
 * crashing at load time.
 */

import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Task, PushNotificationConfig } from './task-manager.js';

export interface A2APersistenceConfig {
  /** Absolute path to the sqlite file. Empty/in-memory if not set. */
  dbPath?: string;
  /** When true, push webhooks are actually fired (default true). */
  pushEnabled?: boolean;
}

// `any` because node:sqlite is only loaded on demand (see initPersistence).
let db: any = null;
let cfg: A2APersistenceConfig = {};
const pushConfigs = new Map<string, PushNotificationConfig>();

/**
 * Apply shared schema + rehydrate logic to whichever engine opened the handle.
 * Both `bun:sqlite` and `node:sqlite` DatabaseSync expose
 * `.exec()`, `.prepare().run()/.all()`.
 */
function setupDb(handle: any): void {
  try {
    // Pragmas are best-effort; an engine that rejects them must be non-fatal.
    // Order matters: busy_timeout must be armed BEFORE journal_mode=WAL so a
    // cold open during another process's WAL recovery waits up to 5s instead
    // of failing instantly with SQLITE_BUSY. synchronous=FULL (not NORMAL)
    // because in WAL mode NORMAL can lose recently-committed transactions on
    // power loss, while FULL fsyncs each commit.
    handle.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  } catch {
    /* pragmas unsupported — non-fatal */
  }
  handle.exec(`
    CREATE TABLE IF NOT EXISTS a2a_tasks (
      id TEXT PRIMARY KEY,
      context_id TEXT,
      state TEXT,
      data TEXT,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS a2a_push_configs (
      task_id TEXT PRIMARY KEY,
      url TEXT,
      token TEXT,
      updated_at INTEGER
    );
  `);
  // Rehydrate push configs. The table was written but never read, so a
  // restart silently dropped every registered webhook while
  // pushNotificationConfig/get kept reporting success from memory.
  try {
    const rows = handle
      .prepare('SELECT task_id, url, token FROM a2a_push_configs')
      .all() as Array<{ task_id: string; url: string; token: string | null }>;
    for (const row of rows) {
      if (!row.url) continue;
      pushConfigs.set(row.task_id, { url: row.url, ...(row.token ? { token: row.token } : {}) });
    }
  } catch {
    // A missing/legacy table is not fatal — continue with memory only.
  }
}

/**
 * Quarantine a broken a2a db file before re-starting fresh. Best-effort: a
 * rename failure (e.g. the file is locked) must not block recovery.
 */
function quarantineCorruptDb(): void {
  const p = cfg.dbPath as string;
  if (!p || !existsSync(p)) return;
  try {
    const bak = `${p}.corrupt.${Date.now()}.bak`;
    renameSync(p, bak);
    console.error(`[a2a] quarantined non-database/corrupt file -> ${bak}; starting fresh`);
  } catch (e) {
    console.error('[a2a] failed to quarantine corrupt a2a db file:', (e as Error).message);
  }
}

/**
 * Cheap pre-flight integrity gate. `bun:sqlite`/`node:sqlite` do not validate
 * the "SQLite format 3" magic at open time (the header check is deferred to the
 * first read), so a garbage/truncated file would either silently self-heal and
 * lose its (already junk) contents, or fail lazily and cascade the whole
 * persistence layer to the in-memory fallback. Detect it here instead.
 * A 0-byte file is a legitimate brand-new database to SQLite and is left alone.
 */
function isNotSqliteFile(): boolean {
  const p = cfg.dbPath as string;
  if (!p || !existsSync(p)) return false;
  let size: number;
  try {
    size = statSync(p).size;
  } catch {
    return false;
  }
  if (size < 16) return size > 0; // 1..15 bytes = truncated/garbage
  let fh: number;
  try {
    fh = openSync(p, 'r');
  } catch {
    return false;
  }
  try {
    const magic = Buffer.alloc(16);
    readSync(fh, magic, 0, 16, 0);
    return !magic.equals(Buffer.from('SQLite format 3\0'));
  } catch {
    return false;
  } finally {
    closeSync(fh);
  }
}

/**
 * Open a handle with recovery. If the open throws, or the on-disk file is
 * detected as not-a-database, quarantine the broken file (`<path>.corrupt.
 * <ts>.bak`) and reopen fresh. Returns the handle, or null if it could not be
 * opened at all (caller falls back to the next engine / in-memory mode).
 */
function openDatabaseWithRecovery(open: () => any, engine: string): any {
  let handle: any;
  try {
    handle = open();
  } catch (e) {
    console.error(`[a2a] persistence open failed (${engine}):`, (e as Error).message);
    quarantineCorruptDb();
    try {
      handle = open();
    } catch (e2) {
      console.error(`[a2a] persistence reopen failed (${engine}):`, (e2 as Error).message);
      return null;
    }
    return handle;
  }
  if (isNotSqliteFile()) {
    console.error(`[a2a] ${engine}: existing file is not a SQLite database; quarantining`);
    try { handle.close(); } catch { /* best-effort */ }
    quarantineCorruptDb();
    try {
      handle = open();
    } catch (e2) {
      console.error(`[a2a] persistence reopen after quarantine failed (${engine}):`, (e2 as Error).message);
      return null;
    }
  }
  return handle;
}

export function initPersistence(config: A2APersistenceConfig = {}): void {
  cfg = { pushEnabled: true, ...config };
  if (!cfg.dbPath) return; // in-memory only
  try {
    const dir = dirname(cfg.dbPath as string);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch {
    // Non-fatal: a real filesystem problem surfaces on open.
  }
  // Prefer Bun's native `bun:sqlite` (the actual runtime). Fall back to
  // Node's `node:sqlite` only when the import is unavailable or the open or
  // schema setup fails. Keeps the original in-memory fallback intact.
  import('bun:sqlite' as string)
    .then(({ Database }: { Database: new (path: string) => any }) => {
      try {
        db = openDatabaseWithRecovery(() => new Database(cfg.dbPath as string), 'bun:sqlite');
        if (db) setupDb(db);
        else openNodeSqlite();
      } catch (e) {
        console.error('[a2a] persistence init (bun:sqlite) failed:', (e as Error).message);
        db = null;
        openNodeSqlite();
      }
    })
    .catch((e) => {
      console.error('[a2a] bun:sqlite unavailable, falling back to node:sqlite:', (e as Error).message);
      openNodeSqlite();
    });
}

/** Open the node:sqlite DatabaseSync fallback (no-op if bun:sqlite won). */
function openNodeSqlite(): void {
  import('node:sqlite')
    .then(({ DatabaseSync }) => {
      try {
        db = openDatabaseWithRecovery(() => new DatabaseSync(cfg.dbPath as string), 'node:sqlite');
        if (db) setupDb(db);
      } catch (e) {
        console.error('[a2a] persistence init failed, falling back to memory:', (e as Error).message);
        db = null;
      }
    })
    .catch((e) => {
      console.error('[a2a] node:sqlite unavailable, running in-memory:', (e as Error).message);
      db = null;
    });
}

export function persistTask(task: Task): void {
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO a2a_tasks (id, context_id, state, data, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET context_id=excluded.context_id, state=excluded.state, data=excluded.data, updated_at=excluded.updated_at`
    ).run(task.id, task.contextId, task.status.state, JSON.stringify(task), Date.now());
  } catch (e) {
    console.error('[a2a] persistTask failed:', (e as Error).message);
  }
}

export function loadPersistedTasks(): Task[] {
  if (!db) return [];
  try {
    const rows = db.prepare('SELECT data FROM a2a_tasks').all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as Task);
  } catch {
    return [];
  }
}

export function setPushConfig(taskId: string, config: PushNotificationConfig): void {
  pushConfigs.set(taskId, config);
  if (db) {
    try {
      db.prepare(
        `INSERT INTO a2a_push_configs (task_id, url, token, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET url=excluded.url, token=excluded.token, updated_at=excluded.updated_at`
      ).run(taskId, config.url, config.token ?? '', Date.now());
    } catch (e) {
      console.error('[a2a] setPushConfig failed:', (e as Error).message);
    }
  }
}

export function getPushConfig(taskId: string): PushNotificationConfig | undefined {
  return pushConfigs.get(taskId);
}

/**
 /** Fire the task's push webhook if configured. Best-effort: failures are
  * logged but never throw (a dead webhook must not break task completion). */
 const PUSH_TIMEOUT_MS = 10_000;
 export async function firePushNotification(task: Task): Promise<void> {
   if (!cfg.pushEnabled) return;
   const pc = pushConfigs.get(task.id);
   if (!pc?.url) return;
   try {
     const ctrl = new AbortController();
     const timer = setTimeout(() => ctrl.abort(), PUSH_TIMEOUT_MS);
     const res = await fetch(pc.url, {
       method: 'POST',
       headers: {
         'content-type': 'application/json',
         ...(pc.token ? { authorization: `Bearer ${pc.token}` } : {}),
       },
       body: JSON.stringify({ id: task.id, contextId: task.contextId, status: task.status, artifacts: task.artifacts }),
       signal: ctrl.signal,
     });
     clearTimeout(timer);
     if (!res.ok) console.warn(`[a2a] push to ${pc.url} returned ${res.status}`);
   } catch (e) {
     console.warn(`[a2a] push to ${pc.url} failed:`, (e as Error).message);
   }
 }

export function closePersistence(): void {
  try { db?.exec('PRAGMA optimize;'); } catch {
    // Non-fatal: optimize is a maintenance no-op; a failure here must not
    // block process teardown.
  }
  try { db?.close(); } catch {
    // Best-effort only: this runs during shutdown, so a failure to close
    // the handle (e.g. already closed) must not block process teardown.
  }
  db = null;
}

export const _internal = {
  randomUUID,
  // Read-only diagnostic seam (used by tests/probes to verify live pragmas —
  // e.g. synchronous / busy_timeout — which are per-connection and cannot be
  // observed from a second connection to the same file).
  getPragma: (name: string): unknown => {
    try {
      if (!db) return null;
      const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
      return row ? Object.values(row)[0] ?? null : null;
    } catch {
      return null;
    }
  },
};
