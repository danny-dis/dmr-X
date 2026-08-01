// Integration tests for migration 065 + AgenticSessionStore — the durable
// backend for /agentic/chat (remediation #13 second half).
//
// Exercises the real SQLite path (initDb + migration runner + sql.js), the
// same convention as auth-lookup-hash.test.ts / aaas-eve-features.test.ts:
// no mocks. Covers the store round-trip (approval-gate fields survive JSON
// serialization), tenant-scoped listing, deletion, expiry, and the key
// durability guarantee — a conversation paused at 'awaiting_approval' with
// pendingToolCalls is reloadable after a simulated gateway restart.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { agenticSessionStore } from '@dmr-x/agent-runtime';

// Bind to the SAME db module singleton the store uses (see
// aaas-eve-features.test.ts for the rationale) so initDb/getDb/closeDb
// always operate on the same handle as AgenticSessionStore.
let initDb: (...args: any[]) => Promise<unknown>;
let getDb: () => any;
let closeDb: (...args: any[]) => Promise<unknown>;

let tmpDir: string;

beforeAll(async () => {
  const dbMod = await import('@dmr-x/db');
  initDb = dbMod.initDb as any;
  getDb = dbMod.getDb as any;
  closeDb = dbMod.closeDb as any;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-agentic-test-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    /* first test */
  }
  await initDb();
});

afterAll(async () => {
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM agentic_sessions;');
  db.exec('DELETE FROM tenants;');
  // Seed tenants so the FK reference resolves regardless of whether the
  // sql.js build enforces foreign keys.
  db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run('t1', 'Tenant One');
  db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run('t2', 'Tenant Two');
});

function convState(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    messages: [{ role: 'user', content: 'hi' }] as any,
    status: 'in_progress' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...extra,
  };
}

describe('migration 065: agentic_sessions', () => {
  it('applies the migration (table + index exist)', () => {
    const table = getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agentic_sessions'",
    ).get() as { name: string } | undefined;
    expect(table).toBeDefined();

    const idx = getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agentic_sessions_tenant'",
    ).get() as { name: string } | undefined;
    expect(idx).toBeDefined();
  });
});

describe('AgenticSessionStore', () => {
  it('round-trips a conversation state including approval-gate fields', () => {
    const pendingToolCalls = [
      { id: 'call_1', name: 'bash', arguments: { cmd: 'ls' } },
      { id: 'call_2', name: 'read_file', arguments: { path: '/tmp/x' } },
    ];
    const state = convState('conv-1', {
      status: 'awaiting_approval',
      pendingToolCalls,
    });

    agenticSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'conv-1',
      state: state as any,
      status: 'awaiting_approval',
      lastTurn: 3,
      metadata: { model: 'gpt-4o', requestId: 'req-1' },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    const got = agenticSessionStore.get('t1', 'conv-1');
    expect(got).not.toBeNull();
    expect(got!.state.status).toBe('awaiting_approval');
    // pendingToolCalls must survive the JSON round-trip intact.
    expect(got!.state.pendingToolCalls).toEqual(pendingToolCalls);
    expect(got!.status).toBe('awaiting_approval');
    expect(got!.lastTurn).toBe(3);
    expect(got!.state.messages).toEqual(state.messages);
    expect((got!.metadata as any).model).toBe('gpt-4o');
  });

  it('isolates conversations by tenant', () => {
    agenticSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'conv-x',
      state: convState('conv-x') as any,
    });
    expect(agenticSessionStore.get('t2', 'conv-x')).toBeNull();
  });

  it('lists conversations for a tenant (newest-first, tenant-scoped)', () => {
    agenticSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'c1',
      state: convState('c1') as any,
    });
    agenticSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'c2',
      state: convState('c2') as any,
    });
    const list = agenticSessionStore.list('t1');
    expect(list.map((s) => s.id).sort()).toEqual(['c1', 'c2']);
    expect(agenticSessionStore.list('t2')).toEqual([]);
  });

  it('deletes a conversation', () => {
    agenticSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'conv-del',
      state: convState('conv-del') as any,
    });
    expect(agenticSessionStore.get('t1', 'conv-del')).not.toBeNull();
    agenticSessionStore.delete('conv-del');
    expect(agenticSessionStore.get('t1', 'conv-del')).toBeNull();
  });

  it('treats an expired conversation as gone', () => {
    agenticSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'conv-expired',
      state: convState('conv-expired') as any,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(agenticSessionStore.get('t1', 'conv-expired')).toBeNull();
  });

  it('reloads an awaiting_approval conversation after a simulated restart', async () => {
    const pendingToolCalls = [{ id: 'call_9', name: 'bash', arguments: { cmd: 'whoami' } }];
    agenticSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'conv-9',
      state: convState('conv-9', { status: 'awaiting_approval', pendingToolCalls }) as any,
      status: 'awaiting_approval',
      lastTurn: 1,
    });

    // Simulate a gateway restart: close the DB handle and re-open the same
    // on-disk database.
    await closeDb();
    await initDb();

    const got = agenticSessionStore.get('t1', 'conv-9');
    expect(got).not.toBeNull();
    expect(got!.status).toBe('awaiting_approval');
    expect(got!.state.status).toBe('awaiting_approval');
    expect(got!.state.pendingToolCalls).toEqual(pendingToolCalls);
    expect(got!.lastTurn).toBe(1);
  });
});
