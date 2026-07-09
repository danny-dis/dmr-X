import crypto from 'node:crypto';

import { getDb } from '@dmr-x/db';

export type MemoryKind = 'short_term' | 'long_term';

export interface AgentMemoryItem {
  id: string;
  tenantId: string;
  agentId: string;
  sessionId: string | null;
  kind: MemoryKind;
  content: string;
  importance: number;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface RememberOptions {
  sessionId?: string;
  kind?: MemoryKind;
  importance?: number;
}

export interface RecallOptions {
  sessionId?: string;
  kind?: MemoryKind;
  limit?: number;
  query?: string;
}

interface AgentMemoryRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  session_id: string | null;
  kind: string;
  content: string;
  importance: number;
  created_at: number | null;
  updated_at: number | null;
}

/**
 * Hermes-style memory manager: short-term (per-session) vs long-term
 * (cross-session, persistent) memories for an agent. Storage + query layer
 * only; runtime injection is handled by a sibling agent.
 */
export class AgentMemoryManager {
  async remember(
    tenantId: string,
    agentId: string,
    content: string,
    opts: RememberOptions = {},
  ): Promise<AgentMemoryItem> {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = Date.now();

    // If a sessionId is provided but kind not set, treat as short-term.
    const kind: MemoryKind = opts.kind ?? (opts.sessionId ? 'short_term' : 'long_term');
    const sessionId = opts.sessionId ?? null;
    const importance = opts.importance ?? 1;

    db.prepare(`
      INSERT INTO agent_memories (id, tenant_id, agent_id, session_id, kind, content, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, agentId, sessionId, kind, content, importance, now, now);

    return this.getById(id)!;
  }

  async sync(
    tenantId: string,
    agentId: string,
    sessionId: string | undefined,
    content: string,
    opts: { importance?: number } = {},
  ): Promise<AgentMemoryItem> {
    return this.remember(tenantId, agentId, content, {
      sessionId,
      kind: 'short_term',
      importance: opts.importance,
    });
  }

  async recall(
    tenantId: string,
    agentId: string,
    opts: RecallOptions = {},
  ): Promise<AgentMemoryItem[]> {
    const db = getDb();
    const where: string[] = ['tenant_id = ?', 'agent_id = ?'];
    const params: unknown[] = [tenantId, agentId];

    if (opts.kind) {
      where.push('kind = ?');
      params.push(opts.kind);
    }

    if (opts.sessionId) {
      where.push('session_id = ?');
      params.push(opts.sessionId);
    } else if (opts.kind !== 'short_term') {
      // When recalling across sessions, only include long-term and
      // session-less memories (unless an explicit kind was given).
      where.push('(kind = ? OR session_id IS NULL)');
      params.push('long_term');
    }

    let rows = db.prepare(`
      SELECT id, tenant_id, agent_id, session_id, kind, content, importance, created_at, updated_at
      FROM agent_memories
      WHERE ${where.join(' AND ')}
      ORDER BY importance DESC, created_at DESC
    `).all(...params) as unknown as AgentMemoryRow[];

    if (opts.query) {
      const q = opts.query.toLowerCase();
      rows = rows.filter(r => r.content.toLowerCase().includes(q));
    }

    const limit = opts.limit ?? 10;
    return rows.slice(0, limit).map(r => this.mapRow(r));
  }

  /**
   * Returns a formatted string block of the most relevant long-term memories
   * and the current session's short-term memories, suitable for inlining
   * into a system prompt. Empty string if none.
   */
  async prefetchForPrompt(
    tenantId: string,
    agentId: string,
    sessionId?: string,
  ): Promise<string> {
    const [longTerm, shortTerm] = await Promise.all([
      this.recall(tenantId, agentId, { kind: 'long_term', limit: 10 }),
      sessionId
        ? this.recall(tenantId, agentId, { sessionId, kind: 'short_term', limit: 10 })
        : Promise.resolve([] as AgentMemoryItem[]),
    ]);

    const lines: string[] = [];
    for (const m of longTerm) lines.push(`- ${m.content}`);
    for (const m of shortTerm) lines.push(`- ${m.content}`);

    return lines.length ? `Memory:\n${lines.join('\n')}` : '';
  }

  getById(id: string): AgentMemoryItem | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT id, tenant_id, agent_id, session_id, kind, content, importance, created_at, updated_at
      FROM agent_memories WHERE id = ?
    `).get(id) as AgentMemoryRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: AgentMemoryRow): AgentMemoryItem {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      agentId: row.agent_id,
      sessionId: row.session_id,
      kind: row.kind as MemoryKind,
      content: row.content,
      importance: row.importance,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const agentMemoryManager = new AgentMemoryManager();
