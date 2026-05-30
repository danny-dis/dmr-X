import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sql.js before importing client
const mockStmt = {
  bind: vi.fn(),
  step: vi.fn(() => false),
  getAsObject: vi.fn(() => ({})),
  free: vi.fn(),
};

const mockDb = {
  prepare: vi.fn(() => mockStmt),
  exec: vi.fn(),
  getRowsModified: vi.fn(() => 0),
  export: vi.fn(() => new Uint8Array([1, 2, 3])),
  close: vi.fn(),
};

const mockSQL = {
  Database: vi.fn(() => mockDb),
};

vi.mock('sql.js', () => ({
  default: vi.fn(async () => mockSQL),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  },
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

describe('sqlite-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStmt.step.mockReturnValue(false);
    mockDb.getRowsModified.mockReturnValue(0);
  });

  describe('DatabaseWrapper', () => {
    it('should create prepared statements', async () => {
      const { initDb } = await import('../../packages/db/src/client.js');
      const db = await initDb();
      const stmt = db.prepare('SELECT * FROM test');
      expect(stmt).toBeDefined();
      expect(typeof stmt.all).toBe('function');
      expect(typeof stmt.get).toBe('function');
      expect(typeof stmt.run).toBe('function');
    });

    it('prepare().all() should return rows', async () => {
      const { initDb } = await import('../../packages/db/src/client.js');
      const db = await initDb();

      mockStmt.step.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false);
      mockStmt.getAsObject
        .mockReturnValueOnce({ id: 1, name: 'Alice' })
        .mockReturnValueOnce({ id: 2, name: 'Bob' });

      const rows = db.prepare('SELECT * FROM users').all();
      expect(rows).toEqual([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]);
    });

    it('prepare().get() should return single row', async () => {
      const { initDb } = await import('../../packages/db/src/client.js');
      const db = await initDb();

      mockStmt.step.mockReturnValueOnce(true);
      mockStmt.getAsObject.mockReturnValueOnce({ id: 1, name: 'Alice' });

      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(1);
      expect(row).toEqual({ id: 1, name: 'Alice' });
    });

    it('prepare().get() should return undefined when no rows', async () => {
      const { initDb } = await import('../../packages/db/src/client.js');
      const db = await initDb();

      mockStmt.step.mockReturnValue(false);
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(999);
      expect(row).toBeUndefined();
    });

    it('prepare().run() should return changes count', async () => {
      const { initDb } = await import('../../packages/db/src/client.js');
      const db = await initDb();

      mockDb.getRowsModified.mockReturnValue(1);
      const result = db.prepare('INSERT INTO users (name) VALUES (?)').run('Charlie');
      expect(result).toEqual({ changes: 1 });
    });

    it('exec() should call raw.exec', async () => {
      const { initDb } = await import('../../packages/db/src/client.js');
      const db = await initDb();

      db.exec('CREATE TABLE test (id INTEGER)');
      expect(mockDb.exec).toHaveBeenCalledWith('CREATE TABLE test (id INTEGER)');
    });

    it('close() should close the database', async () => {
      const { initDb, closeDb } = await import('../../packages/db/src/client.js');
      await initDb();
      await closeDb();
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('getDb() should return db after initDb() is called', async () => {
      const { initDb, getDb } = await import('../../packages/db/src/client.js');
      await initDb();
      const db = getDb();
      expect(db).toBeDefined();
      expect(typeof db.prepare).toBe('function');
    });
  });
});
