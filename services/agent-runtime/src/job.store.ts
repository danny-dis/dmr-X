import { getDb } from '@dmr-x/db';

// ---------------------------------------------------------------------------
// Job store
//
// Persists "jobs" — delivered outcomes (e.g. "build me a 2D platformer")
// that are decomposed into `job_tasks`, each assigned to an agent. This is
// the durability primitive for multi-agent orchestration: a job tracks
// intake -> planning -> running -> blocked -> verifying -> delivered /
// failed / cancelled, with budget/spend tracking and a JSON plan/result/
// decision log. Orchestration logic that actually drives a job through
// this lifecycle lives elsewhere; this module only reads and writes the
// `jobs` and `job_tasks` tables (see migration 064_jobs.sql).
//
// Mirrors the conventions of AgentSessionStore / AgenticSessionStore:
// class + singleton export, `getDb()` per call, JSON columns serialized on
// write and parsed on read via `safeJsonParse`, `?? null` / `?? 0` on every
// binding, and every mutation bumps `updated_at`.
// ---------------------------------------------------------------------------

export type JobSource = 'api' | 'ui' | 'mcp';

export type JobStatus =
  | 'intake'
  | 'planning'
  | 'running'
  | 'blocked'
  | 'verifying'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export type JobTaskStatus =
  | 'pending'
  | 'assigned'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Job {
  id: string;
  tenantId: string;
  submittedBy?: string | null;
  source: JobSource;
  brief: string;
  acceptanceCriteria?: unknown;
  status: JobStatus;
  budgetUsd?: number | null;
  budgetTokens?: number | null;
  deadlineAt?: string | null;
  maxDepth: number;
  spentUsd: number;
  spentTokens: number;
  plan?: unknown;
  result?: unknown;
  decisionLog?: unknown;
  pinAgents: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobInput {
  id: string;
  tenantId: string;
  submittedBy?: string | null;
  source: JobSource;
  brief: string;
  acceptanceCriteria?: unknown;
  status?: JobStatus;
  budgetUsd?: number | null;
  budgetTokens?: number | null;
  deadlineAt?: string | null;
  maxDepth?: number;
  plan?: unknown;
  decisionLog?: unknown;
  pinAgents?: boolean;
}

/** Partial patch for `updateJob`. Only fields present are updated. */
export interface JobPatch {
  status?: JobStatus;
  budgetUsd?: number | null;
  budgetTokens?: number | null;
  deadlineAt?: string | null;
  maxDepth?: number;
  plan?: unknown;
  result?: unknown;
  decisionLog?: unknown;
  pinAgents?: boolean;
  acceptanceCriteria?: unknown;
}

export interface ListJobsOptions {
  status?: JobStatus;
  limit?: number;
  offset?: number;
}

export interface JobTask {
  id: string;
  jobId: string;
  parentTaskId?: string | null;
  seq: number;
  title: string;
  description?: string | null;
  deliverable?: string | null;
  acceptance?: string | null;
  assignedAgentDefId?: string | null;
  assignedAgentVersion?: string | null;
  assignedInstanceId?: string | null;
  sessionId?: string | null;
  assignedModel?: string | null;
  status: JobTaskStatus;
  dependsOn?: string[];
  attempt: number;
  maxRetries: number;
  retryAfter?: string | null;
  output?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  id: string;
  jobId: string;
  parentTaskId?: string | null;
  seq: number;
  title: string;
  description?: string | null;
  deliverable?: string | null;
  acceptance?: string | null;
  assignedAgentDefId?: string | null;
  assignedAgentVersion?: string | null;
  assignedInstanceId?: string | null;
  sessionId?: string | null;
  assignedModel?: string | null;
  status?: JobTaskStatus;
  dependsOn?: string[];
  maxRetries?: number;
}

/** Partial patch for `updateTask`. Only fields present are updated. */
export interface TaskPatch {
  title?: string;
  description?: string | null;
  deliverable?: string | null;
  acceptance?: string | null;
  status?: JobTaskStatus;
  dependsOn?: string[];
  attempt?: number;
  maxRetries?: number;
  retryAfter?: string | null;
  output?: unknown;
  assignedAgentDefId?: string | null;
  assignedAgentVersion?: string | null;
  assignedInstanceId?: string | null;
  sessionId?: string | null;
  assignedModel?: string | null;
}

export interface AssignTaskInput {
  assignedAgentDefId: string;
  assignedAgentVersion?: string | null;
  assignedInstanceId?: string | null;
  sessionId?: string | null;
  assignedModel?: string | null;
}

export class JobStore {
  // -------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------

  /** Insert a new job row. */
  createJob(input: CreateJobInput): Job {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO jobs (
         id, tenant_id, submitted_by, source, brief, acceptance_criteria, status,
         budget_usd, budget_tokens, deadline_at, max_depth, spent_usd, spent_tokens,
         plan, result, decision_log, pin_agents, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.tenantId,
      input.submittedBy ?? null,
      input.source,
      input.brief,
      input.acceptanceCriteria !== undefined ? JSON.stringify(input.acceptanceCriteria) : null,
      input.status ?? 'intake',
      input.budgetUsd ?? null,
      input.budgetTokens ?? null,
      input.deadlineAt ?? null,
      input.maxDepth ?? 3,
      0,
      0,
      input.plan !== undefined ? JSON.stringify(input.plan) : null,
      null,
      input.decisionLog !== undefined ? JSON.stringify(input.decisionLog) : null,
      input.pinAgents ? 1 : 0,
      now,
      now,
    );

    const created = this.getJob(input.tenantId, input.id);
    if (!created) {
      throw new Error(`Failed to read back job ${input.id} after insert`);
    }
    return created;
  }

  /** Load a job by id, scoped to tenant. null if absent/owned elsewhere. */
  getJob(tenantId: string, jobId: string): Job | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM jobs WHERE id = ? AND tenant_id = ?')
      .get(jobId, tenantId) as any;
    if (!row) return null;
    return rowToJob(row);
  }

  /** List jobs for a tenant, optionally filtered by status, newest-first. */
  listJobs(tenantId: string, options?: ListJobsOptions): Job[] {
    const db = getDb();
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const rows = options?.status
      ? (db
          .prepare(
            `SELECT * FROM jobs
             WHERE tenant_id = ? AND status = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(tenantId, options.status, limit, offset) as any[])
      : (db
          .prepare(
            `SELECT * FROM jobs
             WHERE tenant_id = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(tenantId, limit, offset) as any[]);

    return rows.map(rowToJob);
  }

  /** Update just the status of a job (tenant-scoped). Bumps updated_at. */
  updateJobStatus(tenantId: string, jobId: string, status: JobStatus): Job | null {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE jobs SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    ).run(status, now, jobId, tenantId);

    return this.getJob(tenantId, jobId);
  }

  /**
   * Apply a partial patch to a job (tenant-scoped). Only fields present on
   * `patch` are updated; builds a parameterized `SET` list, never
   * interpolates values into the SQL string. Returns null if the job does
   * not exist / is not owned by the tenant, or if the patch is empty.
   */
  updateJob(tenantId: string, jobId: string, patch: JobPatch): Job | null {
    const db = getDb();

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.budgetUsd !== undefined) {
      sets.push('budget_usd = ?');
      params.push(patch.budgetUsd ?? null);
    }
    if (patch.budgetTokens !== undefined) {
      sets.push('budget_tokens = ?');
      params.push(patch.budgetTokens ?? null);
    }
    if (patch.deadlineAt !== undefined) {
      sets.push('deadline_at = ?');
      params.push(patch.deadlineAt ?? null);
    }
    if (patch.maxDepth !== undefined) {
      sets.push('max_depth = ?');
      params.push(patch.maxDepth ?? 3);
    }
    if (patch.plan !== undefined) {
      sets.push('plan = ?');
      params.push(patch.plan === null ? null : JSON.stringify(patch.plan));
    }
    if (patch.result !== undefined) {
      sets.push('result = ?');
      params.push(patch.result === null ? null : JSON.stringify(patch.result));
    }
    if (patch.decisionLog !== undefined) {
      sets.push('decision_log = ?');
      params.push(patch.decisionLog === null ? null : JSON.stringify(patch.decisionLog));
    }
    if (patch.pinAgents !== undefined) {
      sets.push('pin_agents = ?');
      params.push(patch.pinAgents ? 1 : 0);
    }
    if (patch.acceptanceCriteria !== undefined) {
      sets.push('acceptance_criteria = ?');
      params.push(patch.acceptanceCriteria === null ? null : JSON.stringify(patch.acceptanceCriteria));
    }

    if (sets.length === 0) return this.getJob(tenantId, jobId);

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(jobId, tenantId);

    db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
    return this.getJob(tenantId, jobId);
  }

  /** Convenience wrapper: set status to 'cancelled' (tenant-scoped). */
  cancelJob(tenantId: string, jobId: string): Job | null {
    return this.updateJobStatus(tenantId, jobId, 'cancelled');
  }

  /**
   * Atomically increment a job's spend counters in SQL (never
   * read-modify-write in JS). Bumps updated_at.
   */
  addSpend(tenantId: string, jobId: string, usd: number, tokens: number): void {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE jobs
       SET spent_usd = spent_usd + ?, spent_tokens = spent_tokens + ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
    ).run(usd ?? 0, tokens ?? 0, now, jobId, tenantId);
  }

  // -------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------

  /** Insert a new task row under a job. */
  createTask(input: CreateTaskInput): JobTask {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO job_tasks (
         id, job_id, parent_task_id, seq, title, description, deliverable, acceptance,
         assigned_agent_def_id, assigned_agent_version, assigned_instance_id, session_id,
         assigned_model, status, depends_on, attempt, max_retries, output, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.jobId,
      input.parentTaskId ?? null,
      input.seq,
      input.title,
      input.description ?? null,
      input.deliverable ?? null,
      input.acceptance ?? null,
      input.assignedAgentDefId ?? null,
      input.assignedAgentVersion ?? null,
      input.assignedInstanceId ?? null,
      input.sessionId ?? null,
      input.assignedModel ?? null,
      input.status ?? 'pending',
      input.dependsOn !== undefined ? JSON.stringify(input.dependsOn) : null,
      0,
      input.maxRetries ?? 3,
      null,
      now,
      now,
    );

    const created = this.getTaskUnscoped(input.id);
    if (!created) {
      throw new Error(`Failed to read back task ${input.id} after insert`);
    }
    return created;
  }

  /**
   * Load a task by id, verifying its parent job belongs to the tenant.
   * Returns null if the task does not exist OR its job is not owned by
   * the tenant — never returns a task on id match alone.
   */
  getTask(tenantId: string, taskId: string): JobTask | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT t.* FROM job_tasks t
         JOIN jobs j ON j.id = t.job_id
         WHERE t.id = ? AND j.tenant_id = ?`,
      )
      .get(taskId, tenantId) as any;
    if (!row) return null;
    return rowToTask(row);
  }

  /** Internal: load a task by id without tenant scoping (post-insert readback only). */
  private getTaskUnscoped(taskId: string): JobTask | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM job_tasks WHERE id = ?').get(taskId) as any;
    if (!row) return null;
    return rowToTask(row);
  }

  /**
   * List tasks for a job, ordered by seq. Tenant-scoped via a join on
   * `jobs` so tasks belonging to another tenant's job are never returned.
   */
  listTasks(tenantId: string, jobId: string): JobTask[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT t.* FROM job_tasks t
         JOIN jobs j ON j.id = t.job_id
         WHERE t.job_id = ? AND j.tenant_id = ?
         ORDER BY t.seq ASC`,
      )
      .all(jobId, tenantId) as any[];
    return rows.map(rowToTask);
  }

  /**
   * Apply a partial patch to a task (tenant-scoped via job ownership).
   * Only fields present on `patch` are updated. Bumps updated_at. Returns
   * null if the task does not exist, is not owned by the tenant, or the
   * patch is empty.
   */
  updateTask(tenantId: string, taskId: string, patch: TaskPatch): JobTask | null {
    const db = getDb();
    const existing = this.getTask(tenantId, taskId);
    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(patch.title);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(patch.description ?? null);
    }
    if (patch.deliverable !== undefined) {
      sets.push('deliverable = ?');
      params.push(patch.deliverable ?? null);
    }
    if (patch.acceptance !== undefined) {
      sets.push('acceptance = ?');
      params.push(patch.acceptance ?? null);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.dependsOn !== undefined) {
      sets.push('depends_on = ?');
      params.push(patch.dependsOn === null ? null : JSON.stringify(patch.dependsOn));
    }
    if (patch.attempt !== undefined) {
      sets.push('attempt = ?');
      params.push(patch.attempt ?? 0);
    }
    if (patch.maxRetries !== undefined) {
      sets.push('max_retries = ?');
      params.push(patch.maxRetries ?? 3);
    }
    if (patch.retryAfter !== undefined) {
      sets.push('retry_after = ?');
      params.push(patch.retryAfter);
    }
    if (patch.output !== undefined) {
      sets.push('output = ?');
      params.push(patch.output === null ? null : JSON.stringify(patch.output));
    }
    if (patch.assignedAgentDefId !== undefined) {
      sets.push('assigned_agent_def_id = ?');
      params.push(patch.assignedAgentDefId ?? null);
    }
    if (patch.assignedAgentVersion !== undefined) {
      sets.push('assigned_agent_version = ?');
      params.push(patch.assignedAgentVersion ?? null);
    }
    if (patch.assignedInstanceId !== undefined) {
      sets.push('assigned_instance_id = ?');
      params.push(patch.assignedInstanceId ?? null);
    }
    if (patch.sessionId !== undefined) {
      sets.push('session_id = ?');
      params.push(patch.sessionId ?? null);
    }
    if (patch.assignedModel !== undefined) {
      sets.push('assigned_model = ?');
      params.push(patch.assignedModel ?? null);
    }

    if (sets.length === 0) return existing;

    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(taskId);

    db.prepare(`UPDATE job_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getTask(tenantId, taskId);
  }

  /**
   * Assign a task to an agent: sets assigned_agent_def_id,
   * assigned_agent_version, assigned_instance_id, session_id, and
   * assigned_model together, and moves status to 'assigned'. Bumps
   * updated_at. Tenant-scoped via job ownership.
   */
  assignTask(tenantId: string, taskId: string, input: AssignTaskInput): JobTask | null {
    const db = getDb();
    const existing = this.getTask(tenantId, taskId);
    if (!existing) return null;

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE job_tasks
       SET assigned_agent_def_id = ?, assigned_agent_version = ?, assigned_instance_id = ?,
           session_id = ?, assigned_model = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.assignedAgentDefId,
      input.assignedAgentVersion ?? null,
      input.assignedInstanceId ?? null,
      input.sessionId ?? null,
      input.assignedModel ?? null,
      'assigned',
      now,
      taskId,
    );

    return this.getTask(tenantId, taskId);
  }
}

function rowToJob(row: any): Job {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    submittedBy: row.submitted_by ?? null,
    source: row.source,
    brief: row.brief,
    acceptanceCriteria: safeJsonParse(row.acceptance_criteria),
    status: row.status,
    budgetUsd: row.budget_usd ?? null,
    budgetTokens: row.budget_tokens ?? null,
    deadlineAt: row.deadline_at ?? null,
    maxDepth: row.max_depth ?? 3,
    spentUsd: row.spent_usd ?? 0,
    spentTokens: row.spent_tokens ?? 0,
    plan: safeJsonParse(row.plan),
    result: safeJsonParse(row.result),
    decisionLog: safeJsonParse(row.decision_log),
    pinAgents: !!row.pin_agents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTask(row: any): JobTask {
  return {
    id: row.id,
    jobId: row.job_id,
    parentTaskId: row.parent_task_id ?? null,
    seq: row.seq,
    title: row.title,
    description: row.description ?? null,
    deliverable: row.deliverable ?? null,
    acceptance: row.acceptance ?? null,
    assignedAgentDefId: row.assigned_agent_def_id ?? null,
    assignedAgentVersion: row.assigned_agent_version ?? null,
    assignedInstanceId: row.assigned_instance_id ?? null,
    sessionId: row.session_id ?? null,
    assignedModel: row.assigned_model ?? null,
    status: row.status,
    dependsOn: safeJsonParse(row.depends_on) as string[] | undefined,
    attempt: row.attempt ?? 0,
    maxRetries: row.max_retries ?? 3,
    retryAfter: row.retry_after ?? null,
    output: safeJsonParse(row.output),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Parse a JSON TEXT column, returning undefined for null/absent rather
 * than throwing on `JSON.parse(null)`. Falls back to undefined on
 * corrupt JSON rather than throwing.
 */
function safeJsonParse(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export const jobStore = new JobStore();
