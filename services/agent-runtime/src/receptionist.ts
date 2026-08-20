// ---------------------------------------------------------------------------
// Receptionist
//
// The meta-agent coordinator for multi-agent jobs. A job arrives as a raw
// brief; the Receptionist decomposes it into tasks, assigns each task to the
// agent whose declared capabilities best match it, tracks progress on the
// job board, verifies deliverables against the acceptance criteria, and
// escalates out-of-scope or stuck work to a human.
//
// These functions are pure orchestration logic in services/ (they never
// import from apps/). The gateway exposes them to the `__receptionist` agent
// as tools via registerToolHandler (see apps/gateway/src/lib/receptionist-tools.ts),
// supplying the tenant id from the tool-call context.
//
// The LLM-heavy decomposition lives in the gateway (planJob). It cannot be
// imported from services/, so job_decompose reaches it over HTTP the same way
// job-runner.ts and agent-scheduler.ts already reach the gateway — Bearer
// DMRX_INTERNAL_API_KEY against DMRX_GATEWAY_URL.
// ---------------------------------------------------------------------------

import { jobStore, type Job, type JobTask } from './job.store.js';
import { readBoard } from './job-board.js';
import {
  agentRegistryService,
  isSystemAgentName,
  type AgentCapabilities,
} from '@dmr-x/agent-registry';

/** Context every Receptionist tool receives from the gateway glue. */
export interface ReceptionistToolContext {
  tenantId: string;
}

/** The system agent these tools are registered under. */
export const RECEPTIONIST_AGENT_NAME = '__receptionist';

const DEFAULT_AGENT_LIMIT = 8;
const MAX_AGENT_POOL = 200;

// ---------------------------------------------------------------------------
// Gateway HTTP transport (mirrors apps/gateway/src/lib/job-runner.ts)
// ---------------------------------------------------------------------------

interface GatewayCallOptions {
  gatewayUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

function resolveGateway(opts: GatewayCallOptions = {}): { url: string; headers: Record<string, string>; timeoutMs: number } {
  const url = opts.gatewayUrl ?? process.env.DMRX_GATEWAY_URL ?? 'http://localhost:3000';
  const key = opts.apiKey ?? process.env.DMRX_INTERNAL_API_KEY;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['authorization'] = `Bearer ${key}`;
  return { url, headers, timeoutMs: opts.timeoutMs ?? 300_000 };
}

async function callGateway(
  gw: { url: string; headers: Record<string, string>; timeoutMs: number },
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const res = await fetch(`${gw.url}${path}`, {
      method,
      headers: gw.headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(gw.timeoutMs),
    });
    let parsed: any = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, body: { error: { message } } };
  }
}

// ---------------------------------------------------------------------------
// Decision log
// ---------------------------------------------------------------------------

interface DecisionEntry {
  at: string;
  by: string;
  action: string;
  [key: string]: unknown;
}

/** Append an entry to a job's decision log, preserving existing entries. */
function appendDecisionLog(tenantId: string, jobId: string, entry: DecisionEntry): Job | null {
  const job = jobStore.getJob(tenantId, jobId);
  if (!job) return null;
  const log = Array.isArray(job.decisionLog) ? (job.decisionLog as DecisionEntry[]) : [];
  return jobStore.updateJob(tenantId, jobId, { decisionLog: [...log, entry] });
}

// ---------------------------------------------------------------------------
// Acceptance-criteria verification (pure; unit-testable)
// ---------------------------------------------------------------------------

export interface CriterionVerdict {
  text: string;
  status: 'met' | 'unmet' | 'unverified';
  evidence?: string;
}

export interface AcceptanceVerification {
  criteria: CriterionVerdict[];
  allTasksCompleted: boolean;
  missingDeliverables: string[];
  /** True when every criterion is met and all tasks completed. */
  passed: boolean;
  verifiedAt: string;
}

/**
 * Normalize a job's acceptance_criteria JSON column into a list of criterion
 * strings. Accepts either `["do X", ...]` or `[{text|description, ...}, ...]`.
 */
export function normalizeCriteria(criteria: unknown): string[] {
  if (Array.isArray(criteria)) {
    return criteria
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object') {
          const o = c as Record<string, unknown>;
          const text = o.text ?? o.description ?? o.title;
          if (typeof text === 'string') return text;
        }
        return null;
      })
      .filter((t): t is string => Boolean(t && t.trim()));
  }
  return [];
}

/**
 * Verify a job's deliverables against its acceptance criteria.
 *
 * The Receptionist cannot judge natural-language outputs itself, so this is
 * an honest structural check: a criterion is `met` only when every task is
 * completed and carries output (a deliverable was produced); `unverified`
 * when the job has no criteria or tasks are still running; `unmet` when a
 * task failed or is blocked. The gateway-side tool layer may override the
 * verdict with the Receptionist's own reasoned verification (see the
 * `deliver_job` tool), which is stored alongside this structural record.
 */
export function verifyAcceptanceCriteria(job: Job, tasks: JobTask[]): AcceptanceVerification {
  const criteria = normalizeCriteria(job.acceptanceCriteria);
  const allTasksCompleted = tasks.length > 0 && tasks.every((t) => t.status === 'completed');
  const missingDeliverables = tasks
    .filter((t) => t.status !== 'completed')
    .map((t) => t.title);

  const verdicts: CriterionVerdict[] = criteria.map((text) => {
    if (!allTasksCompleted) {
      return { text, status: 'unverified', evidence: 'not all tasks completed' };
    }
    const completedWithOutput = tasks.filter(
      (t) => t.status === 'completed' && t.output !== null && t.output !== undefined,
    );
    if (completedWithOutput.length === 0) {
      return { text, status: 'unmet', evidence: 'no task produced output' };
    }
    // No criterion failed explicitly; deliverables exist for every completed task.
    return { text, status: 'met', evidence: `${completedWithOutput.length} task(s) delivered output` };
  });

  const passed = criteria.length > 0
    ? allTasksCompleted && verdicts.every((v) => v.status === 'met')
    : allTasksCompleted;

  return {
    criteria: verdicts,
    allTasksCompleted,
    missingDeliverables,
    passed,
    verifiedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Capability matching (find_agents)
// ---------------------------------------------------------------------------

export interface AgentMatch {
  instanceId: string;
  definitionId: string | null;
  name: string;
  score: number;
  /** The capability surfaces that produced the match. */
  matchedOn: string[];
}

const CAPABILITY_WEIGHT = 3;
const TAG_WEIGHT = 2;
const CATEGORY_WEIGHT = 1.5;
const DESCRIPTION_WEIGHT = 0.5;
const NAME_WEIGHT = 1;

function tokenize(...inputs: Array<string | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const input of inputs) {
    if (!input) continue;
    for (const part of input.toLowerCase().split(/[^a-z0-9+#._-]+/)) {
      const t = part.trim();
      if (t.length > 1) tokens.add(t);
    }
  }
  return tokens;
}

/**
 * Score one agent instance against a task. Matches task language/domain/
 * deliverable keywords against the definition's capability declaration
 * (domains, deliverables, languages, summary, accepts) with fallbacks to
 * category, tags, description and name.
 */
export function scoreAgentForTask(
  instance: { definitionName: string | null; definitionDescription: string | null; definitionCategory: string | null; definitionTags?: string[]; definitionCapabilities?: Partial<AgentCapabilities> },
  task: string,
  language?: string,
): { score: number; matchedOn: string[] } {
  const taskTokens = tokenize(task, language);
  const matchedOn: string[] = [];

  const caps = instance.definitionCapabilities;
  let score = 0;

  const capSources: Array<[string, string[] | undefined]> = [
    ['domains', caps?.domains],
    ['deliverables', caps?.deliverables],
    ['languages', caps?.languages],
    ['summary', caps?.summary ? [caps.summary] : undefined],
    ['accepts', caps?.accepts],
  ];
  for (const [label, values] of capSources) {
    if (!values || values.length === 0) continue;
    const valueTokens = tokenize(...values);
    let overlap = 0;
    for (const t of taskTokens) if (valueTokens.has(t)) overlap++;
    if (overlap > 0) {
      score += overlap * CAPABILITY_WEIGHT;
      matchedOn.push(label);
    }
  }

  const tags = instance.definitionTags ?? [];
  const tagTokens = tokenize(...tags);
  let tagOverlap = 0;
  for (const t of taskTokens) if (tagTokens.has(t)) tagOverlap++;
  if (tagOverlap > 0) {
    score += tagOverlap * TAG_WEIGHT;
    matchedOn.push('tags');
  }

  const categoryTokens = tokenize(instance.definitionCategory ?? undefined);
  let catOverlap = 0;
  for (const t of taskTokens) if (categoryTokens.has(t)) catOverlap++;
  if (catOverlap > 0) {
    score += catOverlap * CATEGORY_WEIGHT;
    matchedOn.push('category');
  }

  const descTokens = tokenize(instance.definitionDescription ?? undefined);
  for (const t of taskTokens) if (descTokens.has(t)) score += DESCRIPTION_WEIGHT;
  if (descTokens.size > 0) {
    for (const t of taskTokens) if (descTokens.has(t)) matchedOn.push('description');
  }

  const nameTokens = tokenize(instance.definitionName ?? undefined);
  for (const t of taskTokens) if (nameTokens.has(t)) score += NAME_WEIGHT;

  return { score: Math.round(score * 100) / 100, matchedOn: [...new Set(matchedOn)] };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Decompose a job's brief into tasks. The actual planning (LLM prompt,
 * plan parsing, materialization) runs in the gateway's planJob; this tool
 * triggers it over HTTP and returns the resulting task list.
 */
export async function jobDecompose(
  ctx: ReceptionistToolContext,
  args: { jobId?: unknown; model?: unknown },
): Promise<unknown> {
  const jobId = typeof args.jobId === 'string' ? args.jobId : '';
  if (!jobId) return { error: 'jobId is required' };

  const job = jobStore.getJob(ctx.tenantId, jobId);
  if (!job) return { error: `job ${jobId} not found in tenant ${ctx.tenantId}` };

  // Already planned: nothing to do, report the plan.
  const existingTasks = jobStore.listTasks(ctx.tenantId, jobId);
  if (existingTasks.length > 0) {
    return { jobId, taskCount: existingTasks.length, tasks: existingTasks, alreadyPlanned: true };
  }

  const gw = resolveGateway();
  const model = typeof args.model === 'string' ? args.model : undefined;
  const result = await callGateway(gw, 'POST', `/v1/jobs/${encodeURIComponent(jobId)}/plan`, model ? { model } : undefined);

  if (!result.ok) {
    const message = result.body?.error?.message ?? `plan request failed with status ${result.status}`;
    return { error: message, jobId };
  }

  const tasks = jobStore.listTasks(ctx.tenantId, jobId);
  appendDecisionLog(ctx.tenantId, jobId, {
    at: new Date().toISOString(),
    by: RECEPTIONIST_AGENT_NAME,
    action: 'job_decompose',
    taskCount: tasks.length,
  });

  return { jobId, taskCount: tasks.length, tasks };
}

/**
 * Find the best agents for a task by matching its language/domain/deliverable
 * keywords against each active agent's capability declaration (falling back to
 * category/tags/description/name). Excludes system-owned (`__`-prefixed)
 * definitions — the Receptionist coordinates, it never assigns itself.
 */
export async function findAgents(
  ctx: ReceptionistToolContext,
  args: { task?: unknown; language?: unknown; limit?: unknown },
): Promise<unknown> {
  const task = typeof args.task === 'string' ? args.task.trim() : '';
  if (!task) return { error: 'task is required' };
  const language = typeof args.language === 'string' ? args.language : undefined;
  const limit = Math.min(
    Math.max(typeof args.limit === 'number' ? Math.floor(args.limit) : DEFAULT_AGENT_LIMIT, 1),
    MAX_AGENT_POOL,
  );

  const { items } = await agentRegistryService.listInstances(ctx.tenantId, {
    status: 'active',
    limit: MAX_AGENT_POOL,
  });

  const matches: AgentMatch[] = [];
  for (const instance of items) {
    if (isSystemAgentName(instance.definitionName)) continue;
    const { score, matchedOn } = scoreAgentForTask(instance, task, language);
    if (score > 0) {
      matches.push({
        instanceId: instance.id,
        definitionId: instance.agentDefinitionId,
        name: instance.definitionHumanName ?? instance.definitionName ?? instance.id,
        score,
        matchedOn,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, limit);

  return {
    task,
    language: language ?? null,
    candidates: top,
    totalScored: matches.length,
    note: top.length === 0
      ? 'no active agent matched this task — consider escalating to a human'
      : undefined,
  };
}

/**
 * Assign an agent to a task. The agent is identified by its definition id
 * (from find_agents) and optionally a deployed instance id; the task moves
 * from pending to assigned so the job runner can pick it up.
 */
export async function assignTask(
  ctx: ReceptionistToolContext,
  args: { taskId?: unknown; agentDefinitionId?: unknown; agentVersion?: unknown; instanceId?: unknown; model?: unknown },
): Promise<unknown> {
  const taskId = typeof args.taskId === 'string' ? args.taskId : '';
  const agentDefinitionId = typeof args.agentDefinitionId === 'string' ? args.agentDefinitionId : '';
  if (!taskId) return { error: 'taskId is required' };
  if (!agentDefinitionId) return { error: 'agentDefinitionId is required' };

  const task = jobStore.getTask(ctx.tenantId, taskId);
  if (!task) return { error: `task ${taskId} not found in tenant ${ctx.tenantId}` };

  const updated = jobStore.assignTask(ctx.tenantId, taskId, {
    assignedAgentDefId: agentDefinitionId,
    assignedAgentVersion: typeof args.agentVersion === 'string' ? args.agentVersion : undefined,
    assignedInstanceId: typeof args.instanceId === 'string' ? args.instanceId : undefined,
    assignedModel: typeof args.model === 'string' ? args.model : undefined,
  });
  if (!updated) return { error: `failed to assign task ${taskId}` };

  appendDecisionLog(ctx.tenantId, task.jobId, {
    at: new Date().toISOString(),
    by: RECEPTIONIST_AGENT_NAME,
    action: 'assign_task',
    taskId,
    agentDefinitionId,
    instanceId: updated.assignedInstanceId ?? null,
  });

  return { taskId, jobId: updated.jobId, status: updated.status, assignedAgentDefId: updated.assignedAgentDefId };
}

/**
 * Read the job board — every task's structured handoff entry — so the
 * Receptionist can review state before assigning, verifying, or escalating.
 */
export async function readJobBoard(
  ctx: ReceptionistToolContext,
  args: { jobId?: unknown },
): Promise<unknown> {
  const jobId = typeof args.jobId === 'string' ? args.jobId : '';
  if (!jobId) return { error: 'jobId is required' };

  const job = jobStore.getJob(ctx.tenantId, jobId);
  if (!job) return { error: `job ${jobId} not found in tenant ${ctx.tenantId}` };

  const board = readBoard(ctx.tenantId, jobId);
  return {
    jobId,
    status: job.status,
    taskCount: jobStore.listTasks(ctx.tenantId, jobId).length,
    board,
  };
}

/**
 * Request verification for a job's deliverables: move the job to `verifying`
 * and record the request in the decision log. The actual check happens in
 * deliver_job against the acceptance criteria.
 */
export async function requestVerification(
  ctx: ReceptionistToolContext,
  args: { jobId?: unknown; note?: unknown },
): Promise<unknown> {
  const jobId = typeof args.jobId === 'string' ? args.jobId : '';
  if (!jobId) return { error: 'jobId is required' };

  const job = jobStore.getJob(ctx.tenantId, jobId);
  if (!job) return { error: `job ${jobId} not found in tenant ${ctx.tenantId}` };

  const note = typeof args.note === 'string' ? args.note : undefined;
  const updated = jobStore.updateJobStatus(ctx.tenantId, jobId, 'verifying');
  appendDecisionLog(ctx.tenantId, jobId, {
    at: new Date().toISOString(),
    by: RECEPTIONIST_AGENT_NAME,
    action: 'request_verification',
    note: note ?? null,
  });

  return { jobId, status: updated?.status ?? 'verifying' };
}

/**
 * Deliver a job: verify the deliverables against the acceptance criteria and
 * mark the job `delivered` with the verification record in its result.
 *
 * `verification` is optional: when the Receptionist supplies its own reasoned
 * verdict (it may have read task outputs), it is merged over the structural
 * check produced by verifyAcceptanceCriteria.
 */
export async function deliverJob(
  ctx: ReceptionistToolContext,
  args: { jobId?: unknown; verification?: unknown },
): Promise<unknown> {
  const jobId = typeof args.jobId === 'string' ? args.jobId : '';
  if (!jobId) return { error: 'jobId is required' };

  const job = jobStore.getJob(ctx.tenantId, jobId);
  if (!job) return { error: `job ${jobId} not found in tenant ${ctx.tenantId}` };

  const tasks = jobStore.listTasks(ctx.tenantId, jobId);
  const structural = verifyAcceptanceCriteria(job, tasks);

  // Merge an agent-supplied reasoned verdict over the structural record.
  const verification =
    args.verification && typeof args.verification === 'object'
      ? { ...structural, ...(args.verification as Record<string, unknown>) }
      : structural;

  const result = {
    criteria: verification.criteria ?? structural.criteria,
    passed: verification.passed ?? structural.passed,
    allTasksCompleted: structural.allTasksCompleted,
    missingDeliverables: structural.missingDeliverables,
    verifiedAt: new Date().toISOString(),
    deliveredBy: RECEPTIONIST_AGENT_NAME,
  };

  const updated = jobStore.updateJob(ctx.tenantId, jobId, { status: 'delivered', result });
  appendDecisionLog(ctx.tenantId, jobId, {
    at: new Date().toISOString(),
    by: RECEPTIONIST_AGENT_NAME,
    action: 'deliver_job',
    passed: result.passed,
    criteriaCount: result.criteria.length,
  });

  return { jobId, status: updated?.status ?? 'delivered', result };
}

/**
 * Escalate an out-of-scope or stuck job to a human: move it to `blocked`
 * with a clear reason recorded in the decision log.
 */
export async function escalateToHuman(
  ctx: ReceptionistToolContext,
  args: { jobId?: unknown; reason?: unknown },
): Promise<unknown> {
  const jobId = typeof args.jobId === 'string' ? args.jobId : '';
  if (!jobId) return { error: 'jobId is required' };
  const reason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : 'escalated by receptionist';

  const job = jobStore.getJob(ctx.tenantId, jobId);
  if (!job) return { error: `job ${jobId} not found in tenant ${ctx.tenantId}` };

  const updated = jobStore.updateJobStatus(ctx.tenantId, jobId, 'blocked');
  appendDecisionLog(ctx.tenantId, jobId, {
    at: new Date().toISOString(),
    by: RECEPTIONIST_AGENT_NAME,
    action: 'escalate_to_human',
    reason,
  });

  return { jobId, status: updated?.status ?? 'blocked', reason };
}

// ---------------------------------------------------------------------------
// Tool manifest — consumed by the gateway glue and the __receptionist seed.
// ---------------------------------------------------------------------------

export interface ReceptionistToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const RECEPTIONIST_TOOLS: ReceptionistToolDefinition[] = [
  {
    name: 'job_decompose',
    description:
      'Decompose a job brief into an ordered, dependency-aware task list. Calls the planner (POST /v1/jobs/:id/plan) and returns the materialized tasks. Use once per new job, before assigning anything.',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job id to decompose.' },
        model: { type: 'string', description: 'Optional model override for the planner call.' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'find_agents',
    description:
      'Find the best agents for a task by matching its language/domain/deliverable keywords against each active agent\u2019s capability declaration (falling back to category, tags, description, name). Returns top candidates ranked by score. Never assigns yourself.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task title/description to match agents against.' },
        language: { type: 'string', description: 'Optional language hint, e.g. "typescript".' },
        limit: { type: 'number', description: 'Max candidates to return (default 8).' },
      },
      required: ['task'],
    },
  },
  {
    name: 'assign_task',
    description:
      'Assign an agent to a task, moving the task from pending to assigned so the job runner can pick it up. Use the agentDefinitionId returned by find_agents.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task id to assign.' },
        agentDefinitionId: { type: 'string', description: 'The agent definition id to assign (from find_agents).' },
        agentVersion: { type: 'string', description: 'Optional definition version.' },
        instanceId: { type: 'string', description: 'Optional deployed instance id to pin.' },
        model: { type: 'string', description: 'Optional concrete model to assign.' },
      },
      required: ['taskId', 'agentDefinitionId'],
    },
  },
  {
    name: 'read_job_board',
    description:
      'Read the job board: every task\u2019s structured handoff entry plus job status and task count. Review state before assigning, verifying, or escalating.',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job id to read.' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'request_verification',
    description:
      'Request verification of a job\u2019s deliverables: move the job to verifying and log the request. Call when the job\u2019s tasks have produced deliverables and the acceptance criteria need checking.',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job id to verify.' },
        note: { type: 'string', description: 'Optional note describing what to verify.' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'deliver_job',
    description:
      'Deliver a job: verify its deliverables against the acceptance criteria and mark it delivered, recording the verification (criteria verdicts, passed flag) in the job result. Only call when the acceptance criteria have been verified.',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job id to deliver.' },
        verification: {
          type: 'object',
          description: 'Optional reasoned verification record to merge over the structural check.',
        },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Escalate an out-of-scope, stuck, or blocked job to a human: move it to blocked with a clear reason. Use when no agent matches the task, a task fails repeatedly, or the assigned agent escalated.',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'The job id to escalate.' },
        reason: { type: 'string', description: 'Clear reason for the escalation.' },
      },
      required: ['jobId'],
    },
  },
];

/** Map tool name -> handler, used by the gateway glue. */
export function getReceptionistToolHandlers(): Record<string, (ctx: ReceptionistToolContext, args: Record<string, unknown>) => Promise<unknown>> {
  return {
    job_decompose: (ctx, args) => jobDecompose(ctx, args as { jobId?: unknown; model?: unknown }),
    find_agents: (ctx, args) => findAgents(ctx, args as { task?: unknown; language?: unknown; limit?: unknown }),
    assign_task: (ctx, args) => assignTask(ctx, args as { taskId?: unknown; agentDefinitionId?: unknown; agentVersion?: unknown; instanceId?: unknown; model?: unknown }),
    read_job_board: (ctx, args) => readJobBoard(ctx, args as { jobId?: unknown }),
    request_verification: (ctx, args) => requestVerification(ctx, args as { jobId?: unknown; note?: unknown }),
    deliver_job: (ctx, args) => deliverJob(ctx, args as { jobId?: unknown; verification?: unknown }),
    escalate_to_human: (ctx, args) => escalateToHuman(ctx, args as { jobId?: unknown; reason?: unknown }),
  };
}