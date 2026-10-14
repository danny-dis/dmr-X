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
/** Outputs must contain content, not only executor/board bookkeeping. */
function hasSubstantiveOutput(output: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (typeof output === 'string') return output.trim().length > 0;
  if (Array.isArray(output)) return output.some(value => hasSubstantiveOutput(value, depth + 1));
  if (!output || typeof output !== 'object') return false;
  const metadata = new Set(['agent', 'agentName', 'taskId', 'taskTitle', 'status', 'error', 'retried', 'openQuestions', 'forNext']);
  return Object.entries(output).some(([key, value]) => !metadata.has(key) && hasSubstantiveOutput(value, depth + 1));
}

export function verifyAcceptanceCriteria(job: Job, tasks: JobTask[]): AcceptanceVerification {
  const criteria = normalizeCriteria(job.acceptanceCriteria);
  const allTasksCompleted = tasks.length > 0 && tasks.every(t => t.status === 'completed');
  const missingDeliverables = tasks.filter(t => t.status !== 'completed' || !hasSubstantiveOutput(t.output)).map(t => t.title);
  return {
    criteria: criteria.map(text => ({ text, status: 'unverified', evidence: 'requires explicit criterion-specific verification evidence' })),
    allTasksCompleted, missingDeliverables,
    passed: allTasksCompleted && missingDeliverables.length === 0 && criteria.length === 0,
    verifiedAt: new Date().toISOString(),
  };
}

function validateVerdict(expected: string[], supplied: unknown): CriterionVerdict[] | null {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) return null;
  const verdict = supplied as Record<string, unknown>;
  if (verdict.passed !== true || !Array.isArray(verdict.criteria) || verdict.criteria.length !== expected.length) return null;
  const remaining = new Set(expected.map(text => text.trim()));
  if (remaining.size !== expected.length) return null;
  const criteria: CriterionVerdict[] = [];
  for (const item of verdict.criteria) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.text !== 'string'
      || item.status !== 'met' || typeof item.evidence !== 'string' || !item.evidence.trim()
      || !remaining.delete(item.text.trim())) return null;
    criteria.push({ text: item.text.trim(), status: 'met', evidence: item.evidence.trim() });
  }
  return remaining.size === 0 ? criteria : null;
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
  if (['cancelled', 'delivered', 'failed'].includes(job.status)) return { error: `job is ${job.status}`, jobId };

  // Already planned: nothing to do, report the plan.
  const existingTasks = jobStore.listTasks(ctx.tenantId, jobId);
  if (existingTasks.length > 0) {
    return { jobId, taskCount: existingTasks.length, tasks: existingTasks, alreadyPlanned: true };
  }

  const gw = resolveGateway();
  const model = typeof args.model === 'string' ? args.model : undefined;
  const result = await callGateway(gw, 'POST', `/v1/jobs/${encodeURIComponent(jobId)}/plan`, model ? { model } : {});

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
/** Validate the exact durable staffing snapshot, including after registry awaits. */
export async function validateReceptionistRun(ctx: ReceptionistToolContext, jobId: string): Promise<{ error?: string; fingerprint?: string }> {
  const job = jobStore.getJob(ctx.tenantId, jobId);
  if (!job) return { error: 'job not found in this tenant' };
  if (!['intake', 'planning', 'running', 'blocked'].includes(job.status)) return { error: `job is ${job.status}` };
  const tasks = jobStore.listTasks(ctx.tenantId, jobId);
  if (tasks.length === 0) return { error: 'job has no tasks' };
  const fingerprint = JSON.stringify({ status: job.status, tasks });
  for (const task of tasks) {
    if (task.status === 'completed') continue;
    if (task.status !== 'pending' || !task.assignedAgentDefId || !task.assignedInstanceId) return { error: 'tasks must have runnable pinned assignments before enqueueing' };
    const definition = await agentRegistryService.getDefinition(task.assignedAgentDefId);
    const instance = await agentRegistryService.getInstance(task.assignedInstanceId);
    if (!definition || definition.tenantId !== ctx.tenantId || isSystemAgentName(definition.name)
      || !instance || instance.tenantId !== ctx.tenantId || instance.agentDefinitionId !== definition.id
      || instance.status !== 'active' || instance.lifecycleState !== 'ready') return { error: 'assigned agent is not eligible' };
  }
  const current = jobStore.getJob(ctx.tenantId, jobId);
  if (!current || JSON.stringify({ status: current.status, tasks: jobStore.listTasks(ctx.tenantId, jobId) }) !== fingerprint) return { error: 'job staffing or state changed during eligibility checks' };
  return { fingerprint };
}

/** Explicitly enqueue a verified staffing snapshot; HTTP revalidates at enqueue. */
export async function runJob(ctx: ReceptionistToolContext, args: { jobId?: unknown }): Promise<unknown> {
  const jobId = typeof args.jobId === 'string' ? args.jobId : '';
  if (!jobId) return { error: 'jobId is required' };
  const eligible = await validateReceptionistRun(ctx, jobId);
  if (eligible.error) return { error: eligible.error, jobId };
  const response = await callGateway(resolveGateway(), 'POST', `/v1/jobs/${encodeURIComponent(jobId)}/run`, { receptionistRun: true, staffingFingerprint: eligible.fingerprint });
  if (!response.ok) return { error: response.body?.error?.message ?? `run request failed with status ${response.status}`, jobId };
  if (response.body?.jobId !== jobId || response.body?.status !== 'queued') return { error: 'gateway did not confirm the requested job was queued', jobId };
  appendDecisionLog(ctx.tenantId, jobId, { at: new Date().toISOString(), by: RECEPTIONIST_AGENT_NAME, action: 'run_job' });
  return response.body;
}

export async function findAgents(
  ctx: ReceptionistToolContext,
  args: { task?: unknown; language?: unknown; limit?: unknown },
): Promise<unknown> {
  const task = typeof args.task === 'string' ? args.task.trim() : '';
  if (!task) return { error: 'task is required' };
  const language = typeof args.language === 'string' ? args.language : undefined;
  const limit = Math.min(Math.max(typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.floor(args.limit) : DEFAULT_AGENT_LIMIT, 1), MAX_AGENT_POOL);
  const items: Awaited<ReturnType<typeof agentRegistryService.listInstances>>['items'] = [];
  let offset = 0;
  for (;;) {
    const page = await agentRegistryService.listInstances(ctx.tenantId, { status: 'active', limit: MAX_AGENT_POOL, offset });
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total) break;
    if (page.items.length === 0 || offset >= 10000) return { error: 'agent pool enumeration was incomplete' };
  }
  const definitions = new Map<string, Awaited<ReturnType<typeof agentRegistryService.getDefinition>>>();

  const matches: AgentMatch[] = [];
  for (const instance of items) {
    if (isSystemAgentName(instance.definitionName) || instance.lifecycleState !== 'ready') continue;
    if (!definitions.has(instance.agentDefinitionId)) definitions.set(instance.agentDefinitionId, await agentRegistryService.getDefinition(instance.agentDefinitionId));
    const definition = definitions.get(instance.agentDefinitionId);
    if (!definition || definition.tenantId !== ctx.tenantId || isSystemAgentName(definition.name)) continue;
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
 * keeps pending work runnable so the job runner can pick it up.
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

  const job = jobStore.getJob(ctx.tenantId, task.jobId);
  if (!job || !['intake', 'planning', 'running', 'blocked'].includes(job.status)) return { error: 'job is not assignable' };
  if (!['pending', 'assigned'].includes(task.status)) return { error: 'task is not assignable' };
  const definition = await agentRegistryService.getDefinition(agentDefinitionId);
  if (!definition || definition.tenantId !== ctx.tenantId || isSystemAgentName(definition.name)
    || !(await agentRegistryService.canAccessDefinition(agentDefinitionId, ctx.tenantId, 'run'))) {
    return { error: 'agent definition is not eligible for this tenant' };
  }
  const instanceId = typeof args.instanceId === 'string' ? args.instanceId : undefined;
  if (instanceId) {
    const instance = await agentRegistryService.getInstance(instanceId);
    if (!instance || instance.tenantId !== ctx.tenantId || instance.agentDefinitionId !== agentDefinitionId
      || instance.status !== 'active' || instance.lifecycleState !== 'ready') return { error: 'agent instance is not eligible' };
  }
  // Registry reads await: recheck durable state before any write.
  const currentJob = jobStore.getJob(ctx.tenantId, task.jobId);
  const currentTask = jobStore.getTask(ctx.tenantId, taskId);
  if (!currentJob || !['intake', 'planning', 'running', 'blocked'].includes(currentJob.status)
    || !currentTask || !['pending', 'assigned'].includes(currentTask.status)) return { error: 'assignment state changed' };
  const updated = jobStore.updateTask(ctx.tenantId, taskId, {
    status: 'pending',
    assignedAgentDefId: agentDefinitionId,
    assignedAgentVersion: typeof args.agentVersion === 'string' ? args.agentVersion : definition.version,
    assignedInstanceId: instanceId ?? null,
    assignedModel: typeof args.model === 'string' ? args.model : null,
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
    tasks: jobStore.listTasks(ctx.tenantId, jobId),
    acceptanceCriteria: normalizeCriteria(job.acceptanceCriteria),
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
  if (['cancelled', 'delivered', 'failed'].includes(job.status)) return { error: `job is ${job.status}`, jobId };

  const structural = verifyAcceptanceCriteria(job, jobStore.listTasks(ctx.tenantId, jobId));
  if (!structural.allTasksCompleted || structural.missingDeliverables.length > 0) return { error: 'job has incomplete tasks or missing substantive outputs', jobId, structural };
  const note = typeof args.note === 'string' ? args.note : undefined;
  const updated = jobStore.updateJobStatus(ctx.tenantId, jobId, 'verifying');
  appendDecisionLog(ctx.tenantId, jobId, {
    at: new Date().toISOString(),
    by: RECEPTIONIST_AGENT_NAME,
    action: 'request_verification',
    note: note ?? null,
  });

  if (!updated || updated.status !== 'verifying') return { error: 'verification transition was not persisted', jobId, status: updated?.status ?? null };
  return { jobId, status: updated.status };
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

  if (['delivered', 'cancelled', 'failed'].includes(job.status)) return { error: `job is ${job.status}`, jobId };
  if (!structural.allTasksCompleted || structural.missingDeliverables.length > 0) return { error: 'job has incomplete tasks or missing substantive outputs', jobId, structural };
  const expected = normalizeCriteria(job.acceptanceCriteria);
  let criteria: CriterionVerdict[] = [];
  if (expected.length > 0 || args.verification !== undefined) {
    const validated = validateVerdict(expected, args.verification);
    if (!validated) return { error: 'verification must pass with exact criterion coverage and nonempty evidence', jobId };
    criteria = validated;
  }
  const result = { ...structural, criteria, passed: true, deliveredBy: RECEPTIONIST_AGENT_NAME };
  const log = Array.isArray(job.decisionLog) ? job.decisionLog : [];
  const updated = jobStore.updateJob(ctx.tenantId, jobId, {
    status: 'delivered', result,
    decisionLog: [...log, { at: new Date().toISOString(), by: RECEPTIONIST_AGENT_NAME, action: 'deliver_job', passed: true, criteriaCount: criteria.length }],
  });
  if (!updated || updated.status !== 'delivered') return { error: 'job delivery was not persisted', jobId, status: updated?.status ?? null };
  return { jobId, status: updated.status, result: updated.result };

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
  if (['cancelled', 'delivered', 'failed'].includes(job.status)) return { error: `job is ${job.status}`, jobId };

  const updated = jobStore.updateJobStatus(ctx.tenantId, jobId, 'blocked');
  appendDecisionLog(ctx.tenantId, jobId, {
    at: new Date().toISOString(),
    by: RECEPTIONIST_AGENT_NAME,
    action: 'escalate_to_human',
    reason,
  });

  if (!updated || updated.status !== 'blocked') return { error: 'escalation transition was not persisted', jobId, status: updated?.status ?? null };
  return { jobId, status: updated.status, reason };
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
    name: 'run_job',
    description: 'Enqueue this job for real worker execution, only when the user has requested execution and all pending tasks have eligible pinned assignments. Returns queued, not completed. Poll read_job_board in later turns; never invent completion.',
    parameters: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
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
      'Assign an agent to a task, pinning the worker while keeping the task pending and runnable. Use the agentDefinitionId returned by find_agents.',
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
          description: 'Required for semantic criteria: passed:true and one met verdict with nonempty evidence for every expected criterion. Cannot override structural completion/output gates.',
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
    run_job: (ctx, args) => runJob(ctx, args),
    job_decompose: (ctx, args) => jobDecompose(ctx, args as { jobId?: unknown; model?: unknown }),
    find_agents: (ctx, args) => findAgents(ctx, args as { task?: unknown; language?: unknown; limit?: unknown }),
    assign_task: (ctx, args) => assignTask(ctx, args as { taskId?: unknown; agentDefinitionId?: unknown; agentVersion?: unknown; instanceId?: unknown; model?: unknown }),
    read_job_board: (ctx, args) => readJobBoard(ctx, args as { jobId?: unknown }),
    request_verification: (ctx, args) => requestVerification(ctx, args as { jobId?: unknown; note?: unknown }),
    deliver_job: (ctx, args) => deliverJob(ctx, args as { jobId?: unknown; verification?: unknown }),
    escalate_to_human: (ctx, args) => escalateToHuman(ctx, args as { jobId?: unknown; reason?: unknown }),
  };
}