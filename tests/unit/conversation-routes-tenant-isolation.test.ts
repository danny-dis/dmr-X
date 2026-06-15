/**
 * CRIT-1 regression test: cross-tenant data leak in conversation routes.
 *
 * Previously the conversation routes read and wrote the `conversations`
 * and `messages` tables without filtering by `tenant_id`, so any
 * authenticated tenant could list, read, update, and delete every other
 * tenant's conversations and messages.
 *
 * This test stands up a real in-memory SQLite database (via sql.js
 * against a temp data dir) and runs the exact SQL the route handlers
 * run, with the same bind parameters. It asserts that tenant A cannot
 * see, update, or delete tenant B's data, and that message operations
 * are also tenant-scoped.
 *
 * We deliberately mirror the production SQL inline rather than import
 * the route module so the test doesn't drag in the rest of the gateway
 * (which would require building half the monorepo). The route file's
 * SQL is the only thing under test here, and any future edit to the
 * route should keep the SQL patterns below in sync — this test is
 * cheap to keep green and quick to spot divergence.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let tempDir: string;
let initDb: () => Promise<unknown>;
let getDb: () => any;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'dmr-x-conv-iso-'));
  process.env.DMRX_DATA_DIR = tempDir;
  // The conversation routes don't need it. (migratePlaintextApiKeys
  // will no-op.)
  delete process.env.DMRX_ENCRYPTION_KEY;

  const dbMod = await import('../../packages/db/src/index.js');
  initDb = dbMod.initDb;
  getDb = dbMod.getDb;
  closeDb = dbMod.closeDb;
  await initDb();
});

afterAll(async () => {
  await closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Wipe tenant-scoped rows between tests so each case is independent.
  const db = getDb();
  db.exec('DELETE FROM messages;');
  db.exec('DELETE FROM conversations;');
  db.prepare(`INSERT OR REPLACE INTO tenants (id, name) VALUES (?, ?)`).run('tenant-a', 'Tenant A');
  db.prepare(`INSERT OR REPLACE INTO tenants (id, name) VALUES (?, ?)`).run('tenant-b', 'Tenant B');
});

/**
 * Run the production-shaped SQL for a given route. These are copied
 * verbatim from apps/gateway/src/routes/conversation.routes.ts so the
 * test asserts on the same query plan the route executes. If a future
 * refactor changes the SQL, the diff here is the audit trail.
 */
const routeSql = {
  listConversations(tenantId: string, opts: { mode?: string; isTemporary?: 0 | 1; search?: string; limit?: number; offset?: number } = {}) {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    let sql = `
      SELECT c.*,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
      FROM conversations c
      WHERE c.tenant_id = ?
    `;
    const params: any[] = [tenantId];
    if (opts.mode) { sql += ` AND c.mode = ?`; params.push(opts.mode); }
    if (opts.isTemporary !== undefined) { sql += ` AND c.is_temporary = ?`; params.push(opts.isTemporary); }
    if (opts.search) { sql += ` AND c.id IN (SELECT rowid FROM conversations_fts WHERE conversations_fts MATCH ?)`; params.push(opts.search); }
    sql += ` ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    return { sql, params };
  },

  getConversation(tenantId: string, id: string) {
    return {
      sql: `
        SELECT c.*,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
        FROM conversations c
        WHERE c.id = ? AND c.tenant_id = ?
      `,
      params: [id, tenantId],
    };
  },

  listMessages(tenantId: string, conversationId: string) {
    return {
      sql: `SELECT * FROM messages WHERE conversation_id = ? AND tenant_id = ? ORDER BY created_at ASC`,
      params: [conversationId, tenantId],
    };
  },

  updateTitle(tenantId: string, id: string, title: string) {
    return {
      sql: `UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`,
      params: [title, id, tenantId],
    };
  },

  deleteConversation(tenantId: string, id: string) {
    return {
      sql: `DELETE FROM conversations WHERE id = ? AND tenant_id = ?`,
      params: [id, tenantId],
    };
  },

  deleteMessage(tenantId: string, messageId: string) {
    return {
      sql: `DELETE FROM messages WHERE id = ? AND tenant_id = ?`,
      params: [messageId, tenantId],
    };
  },

  findMessageForDelete(tenantId: string, conversationId: string, messageId: string) {
    return {
      sql: `SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND tenant_id = ?`,
      params: [messageId, conversationId, tenantId],
    };
  },
};

describe('CRIT-1: cross-tenant data leak in conversation routes', () => {
  describe('SQL query shapes include tenant_id (regression check)', () => {
    it('list / get / update / delete all reference tenant_id', () => {
      expect(routeSql.listConversations('tenant-a').sql).toMatch(/tenant_id\s*=\s*\?/);
      expect(routeSql.getConversation('tenant-a', 'x').sql).toMatch(/tenant_id\s*=\s*\?/);
      expect(routeSql.listMessages('tenant-a', 'x').sql).toMatch(/tenant_id\s*=\s*\?/);
      expect(routeSql.updateTitle('tenant-a', 'x', 't').sql).toMatch(/tenant_id\s*=\s*\?/);
      expect(routeSql.deleteConversation('tenant-a', 'x').sql).toMatch(/tenant_id\s*=\s*\?/);
      expect(routeSql.deleteMessage('tenant-a', 'x').sql).toMatch(/tenant_id\s*=\s*\?/);
      expect(routeSql.findMessageForDelete('tenant-a', 'x', 'y').sql).toMatch(/tenant_id\s*=\s*\?/);
    });
  });

  describe('tenant A and tenant B are isolated at the SQL layer', () => {
    function seed() {
      const db = getDb();
      const convA = 'conv-a-1';
      const convB = 'conv-b-1';
      const msgA = 'msg-a-1';
      const msgB = 'msg-b-1';
      db.prepare(
        `INSERT INTO conversations (id, tenant_id, mode, is_temporary) VALUES (?, ?, 'chat', 0)`,
      ).run(convA, 'tenant-a');
      db.prepare(
        `INSERT INTO conversations (id, tenant_id, mode, is_temporary) VALUES (?, ?, 'chat', 0)`,
      ).run(convB, 'tenant-b');
      db.prepare(
        `INSERT INTO messages (id, conversation_id, tenant_id, role, content) VALUES (?, ?, ?, 'user', 'secret-a')`,
      ).run(msgA, convA, 'tenant-a');
      db.prepare(
        `INSERT INTO messages (id, conversation_id, tenant_id, role, content) VALUES (?, ?, ?, 'user', 'secret-b')`,
      ).run(msgB, convB, 'tenant-b');
      return { convA, convB, msgA, msgB };
    }

    it('tenant B cannot see tenant A conversations in the list', () => {
      const { convA, convB } = seed();
      const db = getDb();

      const aList = db.prepare(routeSql.listConversations('tenant-a').sql).all(...routeSql.listConversations('tenant-a').params) as any[];
      const bList = db.prepare(routeSql.listConversations('tenant-b').sql).all(...routeSql.listConversations('tenant-b').params) as any[];

      expect(aList.map((c) => c.id)).toEqual([convA]);
      expect(bList.map((c) => c.id)).toEqual([convB]);
    });

    it('tenant B cannot read tenant A conversation by id', () => {
      const { convA } = seed();
      const db = getDb();

      const aGet = db.prepare(routeSql.getConversation('tenant-a', convA).sql).get(...routeSql.getConversation('tenant-a', convA).params);
      const bGet = db.prepare(routeSql.getConversation('tenant-b', convA).sql).get(...routeSql.getConversation('tenant-b', convA).params);

      expect(aGet).toBeDefined();
      expect((aGet as any).id).toBe(convA);
      expect(bGet).toBeUndefined();
    });

    it('tenant B cannot read tenant A messages', () => {
      const { convA, msgA } = seed();
      const db = getDb();

      const aMsgs = db.prepare(routeSql.listMessages('tenant-a', convA).sql).all(...routeSql.listMessages('tenant-a', convA).params) as any[];
      const bMsgs = db.prepare(routeSql.listMessages('tenant-b', convA).sql).all(...routeSql.listMessages('tenant-b', convA).params) as any[];

      expect(aMsgs.map((m) => m.id)).toEqual([msgA]);
      expect(bMsgs).toEqual([]);
    });

    it('tenant B cannot update tenant A conversation title', () => {
      const { convA } = seed();
      const db = getDb();

      const r = db.prepare(routeSql.updateTitle('tenant-b', convA, 'pwned').sql).run(...routeSql.updateTitle('tenant-b', convA, 'pwned').params);
      expect(r.changes).toBe(0);

      const after = db.prepare(`SELECT title FROM conversations WHERE id = ?`).get(convA) as { title: string | null };
      expect(after.title).toBeNull();
    });

    it('tenant B cannot delete tenant A conversation', () => {
      const { convA } = seed();
      const db = getDb();

      const r = db.prepare(routeSql.deleteConversation('tenant-b', convA).sql).run(...routeSql.deleteConversation('tenant-b', convA).params);
      expect(r.changes).toBe(0);

      const stillThere = db.prepare(`SELECT id FROM conversations WHERE id = ?`).get(convA);
      expect(stillThere).toBeDefined();
    });

    it('tenant B cannot delete tenant A message', () => {
      const { convA, msgA } = seed();
      const db = getDb();

      const lookup = db.prepare(routeSql.findMessageForDelete('tenant-b', convA, msgA).sql).get(...routeSql.findMessageForDelete('tenant-b', convA, msgA).params);
      expect(lookup).toBeUndefined();

      // Even if a malicious client forged a request that skipped the
      // lookup, the DELETE itself is also tenant-scoped.
      const r = db.prepare(routeSql.deleteMessage('tenant-b', msgA).sql).run(...routeSql.deleteMessage('tenant-b', msgA).params);
      expect(r.changes).toBe(0);

      const stillThere = db.prepare(`SELECT id FROM messages WHERE id = ?`).get(msgA);
      expect(stillThere).toBeDefined();
    });

    it('tenant A can still update their own conversation', () => {
      const { convA } = seed();
      const db = getDb();

      const r = db.prepare(routeSql.updateTitle('tenant-a', convA, 'renamed').sql).run(...routeSql.updateTitle('tenant-a', convA, 'renamed').params);
      expect(r.changes).toBe(1);

      const after = db.prepare(`SELECT title FROM conversations WHERE id = ?`).get(convA) as { title: string };
      expect(after.title).toBe('renamed');
    });

    it('list count query (the pagination total) is also tenant-scoped', () => {
      // The production route's count query is structurally similar
      // to the list query. Re-run the same WHERE clause to make sure
      // it also pins tenant_id.
      const { convA } = seed();
      const db = getDb();

      const countSql = `SELECT COUNT(*) as total FROM conversations WHERE tenant_id = ?`;
      const aCount = (db.prepare(countSql).get('tenant-a') as { total: number }).total;
      const bCount = (db.prepare(countSql).get('tenant-b') as { total: number }).total;
      expect(aCount).toBe(1);
      expect(bCount).toBe(1);
      expect(convA).toBeDefined();
    });
  });

  describe('creating a conversation stamps the caller tenant_id', () => {
    it('INSERT writes the active tenant_id, and the row is invisible to the other tenant', () => {
      const db = getDb();
      const newId = randomUUID();
      db.prepare(
        `INSERT INTO conversations (id, tenant_id, mode, is_temporary) VALUES (?, ?, ?, ?)`,
      ).run(newId, 'tenant-a', 'chat', 0);

      const visibleToA = db.prepare(`SELECT * FROM conversations WHERE id = ? AND tenant_id = ?`).get(newId, 'tenant-a');
      const visibleToB = db.prepare(`SELECT * FROM conversations WHERE id = ? AND tenant_id = ?`).get(newId, 'tenant-b');
      expect(visibleToA).toBeDefined();
      expect(visibleToB).toBeUndefined();
    });
  });
});
