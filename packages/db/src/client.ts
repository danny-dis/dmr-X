import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

let db: SqlJsDatabase | null = null;
let dbPath = '';

function saveDatabase() {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } catch (err) {
    console.error('[dmr-x] Failed to save database:', err);
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
          saveDatabase();
          return { changes };
        } finally {
          stmt.free();
        }
      },
    };
  }

  exec(sql: string) {
    this.raw.exec(sql);
    saveDatabase();
  }

  pragma(_p: string) {
    // sql.js doesn't support PRAGMA the same way — no-op
  }

  close() {
    saveDatabase();
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

  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      try {
        db.exec(sql);
      } catch (err) {
        console.error(`[dmr-x] Migration ${file} failed:`, err);
        throw err;
      }
    }
  }

  saveDatabase();
  console.log(`[dmr-x] SQLite database ready at ${dbPath}`);
  return new DatabaseWrapper(db);
}

export function getDb(): DatabaseWrapper {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return new DatabaseWrapper(db);
}

export function closeDb() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}
