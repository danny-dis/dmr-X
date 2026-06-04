"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Mock sql.js before importing client
const mockStmt = {
    bind: vitest_1.vi.fn(),
    step: vitest_1.vi.fn(() => false),
    getAsObject: vitest_1.vi.fn(() => ({})),
    free: vitest_1.vi.fn(),
};
const mockDb = {
    prepare: vitest_1.vi.fn(() => mockStmt),
    exec: vitest_1.vi.fn(),
    getRowsModified: vitest_1.vi.fn(() => 0),
    export: vitest_1.vi.fn(() => new Uint8Array([1, 2, 3])),
    close: vitest_1.vi.fn(),
};
const mockSQL = {
    Database: vitest_1.vi.fn(() => mockDb),
};
vitest_1.vi.mock('sql.js', () => ({
    default: vitest_1.vi.fn(async () => mockSQL),
}));
vitest_1.vi.mock('node:fs', () => ({
    default: {
        existsSync: vitest_1.vi.fn(() => false),
        mkdirSync: vitest_1.vi.fn(),
        readFileSync: vitest_1.vi.fn(),
        writeFileSync: vitest_1.vi.fn(),
        readdirSync: vitest_1.vi.fn(() => []),
        promises: {
            writeFile: vitest_1.vi.fn(async () => { }),
        },
    },
    existsSync: vitest_1.vi.fn(() => false),
    mkdirSync: vitest_1.vi.fn(),
    readFileSync: vitest_1.vi.fn(),
    writeFileSync: vitest_1.vi.fn(),
    readdirSync: vitest_1.vi.fn(() => []),
    promises: {
        writeFile: vitest_1.vi.fn(async () => { }),
    },
}));
(0, vitest_1.describe)('sqlite-client', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        mockStmt.step.mockReturnValue(false);
        mockDb.getRowsModified.mockReturnValue(0);
    });
    (0, vitest_1.describe)('DatabaseWrapper', () => {
        (0, vitest_1.it)('should create prepared statements', async () => {
            const { initDb } = await import('../../packages/db/src/client.js');
            const db = await initDb();
            const stmt = db.prepare('SELECT * FROM test');
            (0, vitest_1.expect)(stmt).toBeDefined();
            (0, vitest_1.expect)(typeof stmt.all).toBe('function');
            (0, vitest_1.expect)(typeof stmt.get).toBe('function');
            (0, vitest_1.expect)(typeof stmt.run).toBe('function');
        });
        (0, vitest_1.it)('prepare().all() should return rows', async () => {
            const { initDb } = await import('../../packages/db/src/client.js');
            const db = await initDb();
            mockStmt.step.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false);
            mockStmt.getAsObject
                .mockReturnValueOnce({ id: 1, name: 'Alice' })
                .mockReturnValueOnce({ id: 2, name: 'Bob' });
            const rows = db.prepare('SELECT * FROM users').all();
            (0, vitest_1.expect)(rows).toEqual([
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' },
            ]);
        });
        (0, vitest_1.it)('prepare().get() should return single row', async () => {
            const { initDb } = await import('../../packages/db/src/client.js');
            const db = await initDb();
            mockStmt.step.mockReturnValueOnce(true);
            mockStmt.getAsObject.mockReturnValueOnce({ id: 1, name: 'Alice' });
            const row = db.prepare('SELECT * FROM users WHERE id = ?').get(1);
            (0, vitest_1.expect)(row).toEqual({ id: 1, name: 'Alice' });
        });
        (0, vitest_1.it)('prepare().get() should return undefined when no rows', async () => {
            const { initDb } = await import('../../packages/db/src/client.js');
            const db = await initDb();
            mockStmt.step.mockReturnValue(false);
            const row = db.prepare('SELECT * FROM users WHERE id = ?').get(999);
            (0, vitest_1.expect)(row).toBeUndefined();
        });
        (0, vitest_1.it)('prepare().run() should return changes count', async () => {
            const { initDb } = await import('../../packages/db/src/client.js');
            const db = await initDb();
            mockDb.getRowsModified.mockReturnValue(1);
            const result = db.prepare('INSERT INTO users (name) VALUES (?)').run('Charlie');
            (0, vitest_1.expect)(result).toEqual({ changes: 1 });
        });
        (0, vitest_1.it)('exec() should call raw.exec', async () => {
            const { initDb } = await import('../../packages/db/src/client.js');
            const db = await initDb();
            db.exec('CREATE TABLE test (id INTEGER)');
            (0, vitest_1.expect)(mockDb.exec).toHaveBeenCalledWith('CREATE TABLE test (id INTEGER)');
        });
        (0, vitest_1.it)('close() should close the database', async () => {
            const { initDb, closeDb } = await import('../../packages/db/src/client.js');
            await initDb();
            await closeDb();
            (0, vitest_1.expect)(mockDb.close).toHaveBeenCalled();
        });
        (0, vitest_1.it)('getDb() should return db after initDb() is called', async () => {
            const { initDb, getDb } = await import('../../packages/db/src/client.js');
            await initDb();
            const db = getDb();
            (0, vitest_1.expect)(db).toBeDefined();
            (0, vitest_1.expect)(typeof db.prepare).toBe('function');
        });
    });
});
//# sourceMappingURL=sqlite-client.test.js.map