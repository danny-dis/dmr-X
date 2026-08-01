import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import type { ConversationState } from '@dmr-x/utils';
import { type SessionStatus } from './agent-session.store.js';

// ---------------------------------------------------------------------------
// Durable /agentic/chat session store
//
// Persists a ConversationState to SQLite so a generic /agentic/chat
// conversation can be PAUSED (e.g. awaiting a tool-approval decision) and
// RESUMED after the event arrives — even across gateway restarts. This is
// the agentic counterpart to AgentSessionStore, but scoped to the
// instance-less agentic endpoint: it cannot reuse `agent_sessions` because
// that table's agent_instance_id is a NOT NULL FK to agent_instances.
//
// A conversation is keyed by conversationId + tenantId. The route layer
// loads it on each request, runs the loop, then saves the resulting state
// back. If the loop decides to pause (sets status to 'awaiting_approval'),
// the partial state is persisted and the HTTP response ends; a later resume
// request reloads the exact state (pending tool calls included) and
// continues.
//
// `locks` is an in-process per-conversation mutex so concurrent requests
// for the same conversation serialize their reads/writes. It is
// intentionally NOT persisted — a crash releases the lock automatically.
// ---------------------------------------------------------------------------

export interface PersistedAgenticSession {
  id: string;
  tenantId: string;
  state: ConversationState;
  status: SessionStatus;
  statusReason?: string | null;
  lastTurn: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
}

export interface AgenticUpsertInput {
  tenantId: string;
  conversationId: string;
  state: ConversationState;
  status?: SessionStatus;
  statusReason?: string | null;
  lastTurn?: number;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
}

export class AgenticSessionStore {
  /** In-process per-conversation mutex (not persisted). */
  readonly locks = new Map<string, Promise<void>>();

  /**
   * Persist a conversation (insert or update). `state` is serialized whole;
   * bookkeeping columns are projected from it / the provided metadata.
   */
  upsert(input: AgenticUpsertInput): void {
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db
      .prepare('SELECT created_at FROM agentic_sessions WHERE id = ?')
      .get(input.conversationId) as { created_at: string } | undefined;

    db.prepare(
      `INSERT INTO agentic_sessions (
         id, tenant_id, state, metadata, status, status_reason,
         last_turn, created_at, updated_at, expires_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         state = excluded.state,
         metadata = excluded.metadata,
         status = excluded.status,
         status_reason = excluded.status_reason,
         last_turn = excluded.last_turn,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at`,
    ).run(
      input.conversationId,
      input.tenantId,
      JSON.stringify(input.state),
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.status ?? (input.state.status as SessionStatus) ?? 'in_progress',
      input.statusReason ?? null,
      input.lastTurn ?? 0,
      existing?.created_at ?? now,
      now,
      input.expiresAt ?? null,
    );
  }

  /** Load a conversation by conversationId + tenant. null if absent/expired. */
  get(tenantId: string, conversationId: string): PersistedAgenticSession | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM agentic_sessions WHERE id = ? AND tenant_id = ?')
      .get(conversationId, tenantId) as any;
    if (!row) return null;

    if (row.expires_at) {
      const expires = new Date(row.expires_at);
      if (expires < new Date()) {
        this.delete(conversationId);
        return null;
      }
    }

    let state: ConversationState;
    try {
      state = JSON.parse(row.state);
    } catch {
      logger.warn({ id: conversationId }, 'Corrupt agentic session state, dropping');
      this.delete(conversationId);
      return null;
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      state,
      status: row.status,
      statusReason: row.status_reason ?? null,
      lastTurn: row.last_turn ?? 0,
      metadata: safeJson(row.metadata, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at ?? null,
    };
  }

  /** List conversations for a tenant, newest-first. */
  list(tenantId: string, limit = 200): PersistedAgenticSession[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM agentic_sessions
         WHERE tenant_id = ?
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(tenantId, limit) as any[];

    return rows
      .map((row) => {
        try {
          return {
            id: row.id,
            tenantId: row.tenant_id,
            state: JSON.parse(row.state) as ConversationState,
            status: row.status,
            statusReason: row.status_reason ?? null,
            lastTurn: row.last_turn ?? 0,
            metadata: safeJson(row.metadata, {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            expiresAt: row.expires_at ?? null,
          } as PersistedAgenticSession;
        } catch {
          return null;
        }
      })
      .filter((s): s is PersistedAgenticSession => s !== null);
  }

  /** Delete a conversation by id. */
  delete(conversationId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM agentic_sessions WHERE id = ?').run(conversationId);
  }
}

function safeJson(raw: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

export const agenticSessionStore = new AgenticSessionStore();
