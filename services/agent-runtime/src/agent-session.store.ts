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

/**
 * Compact per-run step artifact stored alongside conversation state.
 *
 * Stored in `session_steps` keyed by `conversationId + turn`, keeping the
 * durable payload minimal while still surfacing tool execution shape and
 * budget status.
 */
export interface SessionStep {
  turn: number;
  status: 'ok' | 'error' | 'blocked' | 'completed';
  budgetStatus: 'within' | 'exceeded';
  allowedToolCallNames?: string[];
  blockedToolCallNames?: string[];
  toolResults?: Array<{
    toolCallId?: string;
    name?: string;
    ok?: boolean;
    error?: string | null;
    truncated?: boolean;
  }>;
  tokenDelta?: number;
  costDelta?: number;
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
   * Append durable step-level telemetry for a finished conversation run.
   *
   * Caller-visible contract:
   * - Always persists the step list alongside the conversation row once
   *   `persistSessionArtifacts` is enabled.
   * - Does not mutate previous step history by default; use `reset` only
   *   for explicit rerun semantics.
   * - Returns the stored step count for verification/testing.
   */
  persistRunSteps(
    tenantId: string,
    conversationId: string,
    steps: SessionStep[],
    options?: { reset?: boolean; budgetStatus?: SessionStep['budgetStatus'] },
  ): number {
    const normalized = steps.map((step) => ({
      ...step,
      budgetStatus: step.budgetStatus ?? options?.budgetStatus ?? 'within',
    }));
    const db = getDb();
    const now = new Date().toISOString();

    if (options?.reset) {
      db.prepare('DELETE FROM session_steps WHERE conversation_id = ?')
        .run(conversationId);
    }

    const insert = db.prepare(
      `INSERT INTO session_steps (
         tenant_id, conversation_id, turn, status, budget_status, allowed_tool_calls,
         blocked_tool_calls, tool_results, token_delta, cost_delta, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let lastInserted = 0;
    for (const step of normalized) {
      insert.run(
        tenantId,
        conversationId,
        step.turn,
        step.status,
        step.budgetStatus,
        step.allowedToolCallNames ? JSON.stringify(step.allowedToolCallNames) : '[]',
        step.blockedToolCallNames ? JSON.stringify(step.blockedToolCallNames) : '[]',
        step.toolResults?.length ? JSON.stringify(step.toolResults) : '[]',
        step.tokenDelta ?? 0,
        step.costDelta ?? 0,
        now,
      );
      lastInserted++;
    }

    return lastInserted;
  }

  /**
   * Load durable step-level artifacts for a conversation, oldest-first.
   * Returns empty array when none are present.
   */
  loadRunSteps(conversationId: string): SessionStep[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT turn, status, budget_status, allowed_tool_calls,
                blocked_tool_calls, tool_results, token_delta, cost_delta
         FROM session_steps
         WHERE conversation_id = ?
         ORDER BY turn ASC`,
      )
      .all(conversationId) as any[];

    return rows.map((row) => ({
      turn: row.turn,
      status: row.status,
      budgetStatus: row.budget_status,
      allowedToolCallNames: row.allowed_tool_calls ? JSON.parse(row.allowed_tool_calls) : undefined,
      blockedToolCallNames: row.blocked_tool_calls ? JSON.parse(row.blocked_tool_calls) : undefined,
      toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
      tokenDelta: row.token_delta ?? undefined,
      costDelta: row.cost_delta ?? undefined,
    }));
  }

  /**
   * Hard-delete step artifacts for a conversation.
   * Does not remove the main `agent_sessions` row; the public `delete`
   * method still owns that lifecycle contract.
   */
  deleteRunSteps(conversationId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM session_steps WHERE conversation_id = ?').run(conversationId);
  }

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

  /**
   * Boot-time watchdog: mark orphaned runs as interrupted. Any session still
   * 'in_progress' whose updated_at is older than `olderThanMs` was left behind
   * by a crashed/restarted gateway and can no longer be resumed as live.
   * Returns the number of sessions transitioned.
   */
  markStaleInterrupted(olderThanMs: number): number {
    const db = getDb();
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const result = db
      .prepare(
        `UPDATE agent_sessions
         SET status = 'interrupted',
             status_reason = COALESCE(status_reason, 'run_orphaned'),
             updated_at = ?
         WHERE status = 'in_progress' AND updated_at < ?`,
      )
      .run(cutoff, cutoff);
    return result.changes;
  }

  /** Delete a session by id. */
  delete(conversationId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(conversationId);
    this.deleteRunSteps(conversationId);
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
