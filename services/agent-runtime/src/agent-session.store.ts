import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import type { ConversationState } from '@dmr-x/utils';

// ---------------------------------------------------------------------------
// Durable agent session store
//
// Persists a ConversationState to SQLite so an agent run can be PAUSED
// (e.g. awaiting a tool-approval decision or a human answer) and RESUMED
// after the event arrives — even across gateway restarts. This is the
// Workflow-SDK-style durability primitive borrowed from Vercel EVE, adapted
// to DMR-X's "everything is SQLite" philosophy.
//
// A session is keyed by conversationId. The route layer loads it on each
// request, runs the agent loop, then saves the resulting state back. If the
// loop decides to pause (sets status to 'awaiting_approval'/'interrupted'),
// the partial state is persisted and the HTTP response ends; a later
// resume request reloads the exact state and continues.
//
// `locks` is an in-process per-conversation mutex so concurrent
// requests for the same conversation serialize their reads/writes. It is
// intentionally NOT persisted — a crash releases the lock automatically.
// ---------------------------------------------------------------------------

export type SessionStatus =
  | 'in_progress'
  | 'awaiting_approval'
  | 'interrupted'
  | 'completed'
  | 'error';

export interface SessionMetadata {
  lastResponseText?: string;
  totalTokensUsed?: number;
  loadedSkillIds?: string;
  [key: string]: unknown;
}

export interface PersistedSession {
  id: string;
  tenantId: string;
  agentInstanceId: string;
  agentDefinitionId?: string;
  state: ConversationState;
  status: SessionStatus;
  statusReason?: string | null;
  lastTurn: number;
  loadedSkills: string[];
  metadata: SessionMetadata;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
}

export interface UpsertInput {
  tenantId: string;
  conversationId: string;
  instanceId: string;
  agentDefinitionId?: string;
  state: ConversationState;
  status?: SessionStatus;
  statusReason?: string | null;
  lastTurn?: number;
  loadedSkillIds?: string[];
  metadata?: SessionMetadata;
  expiresAt?: string | null;
}

export class AgentSessionStore {
  /** In-process per-conversation mutex (not persisted). */
  readonly locks = new Map<string, Promise<void>>();

  /**
   * Persist a session (insert or update). `state` is serialized whole;
   * bookkeeping columns are projected from it / the provided metadata.
   */
  upsert(input: UpsertInput): void {
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db
      .prepare('SELECT created_at FROM agent_sessions WHERE id = ?')
      .get(input.conversationId) as { created_at: string } | undefined;

    db.prepare(
      `INSERT INTO agent_sessions (
         id, tenant_id, agent_instance_id, agent_definition_id, state, status, status_reason,
         last_turn, loaded_skills, metadata, created_at, updated_at, expires_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         agent_instance_id = excluded.agent_instance_id,
         agent_definition_id = excluded.agent_definition_id,
         state = excluded.state,
         status = excluded.status,
         status_reason = excluded.status_reason,
         last_turn = excluded.last_turn,
         loaded_skills = excluded.loaded_skills,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at`,
    ).run(
      input.conversationId,
      input.tenantId,
      input.instanceId,
      input.agentDefinitionId ?? null,
      JSON.stringify(input.state),
      input.status ?? (input.state.status as SessionStatus) ?? 'in_progress',
      input.statusReason ??
        (input.state.interruptedBy ? `interrupted:${input.state.interruptedBy}` : null),
      input.lastTurn ?? 0,
      JSON.stringify(input.loadedSkillIds ?? []),
      input.metadata ? JSON.stringify(input.metadata) : null,
      existing?.created_at ?? now,
      now,
      input.expiresAt ?? null,
    );
  }

  /** Load a session by conversationId + tenant. null if absent/owned elsewhere. */
  get(tenantId: string, conversationId: string): PersistedSession | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM agent_sessions WHERE id = ? AND tenant_id = ?')
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
      logger.warn({ id: conversationId }, 'Corrupt agent session state, dropping');
      this.delete(conversationId);
      return null;
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      agentInstanceId: row.agent_instance_id,
      agentDefinitionId: row.agent_definition_id ?? undefined,
      state,
      status: row.status,
      statusReason: row.status_reason ?? null,
      lastTurn: row.last_turn ?? 0,
      loadedSkills: JSON.parse(row.loaded_skills || '[]'),
      metadata: safeJson(row.metadata, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at ?? null,
    };
  }

  /** List sessions for an agent instance (feature #1: resume queue). */
  listForInstance(tenantId: string, instanceId: string): PersistedSession[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM agent_sessions
         WHERE tenant_id = ? AND agent_instance_id = ?
         ORDER BY updated_at DESC LIMIT 200`,
      )
      .all(tenantId, instanceId) as any[];

    return rows
      .map((row) => {
        try {
          return {
            id: row.id,
            tenantId: row.tenant_id,
            agentInstanceId: row.agent_instance_id,
            agentDefinitionId: row.agent_definition_id ?? undefined,
            state: JSON.parse(row.state) as ConversationState,
            status: row.status,
            statusReason: row.status_reason ?? null,
            lastTurn: row.last_turn ?? 0,
            loadedSkills: JSON.parse(row.loaded_skills || '[]'),
            metadata: safeJson(row.metadata, {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            expiresAt: row.expires_at ?? null,
          } as PersistedSession;
        } catch {
          return null;
        }
      })
      .filter((s): s is PersistedSession => s !== null);
  }

  /** Delete a session by id. */
  delete(conversationId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(conversationId);
  }

  /** Hard-delete expired (non-permanent) sessions. Returns count removed. */
  cleanupExpired(): number {
    const db = getDb();
    const result = db
      .prepare(
        `DELETE FROM agent_sessions
         WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`,
      )
      .run();
    return result.changes;
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

export const agentSessionStore = new AgentSessionStore();
