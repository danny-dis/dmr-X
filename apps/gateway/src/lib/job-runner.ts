import {
  jobStore,
  buildPlanPrompt,
  parsePlanResponse,
  materializePlan,
  runJobPass,
  type AgentSummary,
  type JobRunResult,
  type JobTask,
  type PlannedTask,
  type TaskExecutionResult,
  type TaskExecutor,
} from '@dmr-x/agent-runtime';
import { logger } from '@dmr-x/utils';

// ---------------------------------------------------------------------------
// Job runner
//
// Gateway-side glue between a stored job and the work that fulfils it:
//
//   planJob   brief -> LLM -> parsed plan -> real tasks
//   createTaskExecutor  a TaskExecutor that runs one task by calling an agent
//   driveJob  repeats runJobPass until the job stops making progress
//
// The orchestrator lives in services/ and may not import from apps/, so it
// takes an injected executor. This file supplies the real one. It reaches the
// gateway over HTTP rather than importing the chat loop directly, which is the
// pattern agent-scheduler.ts already uses for scheduled runs.
// ---------------------------------------------------------------------------

/** A hung agent call must not hang a job forever. */
const DEFAULT_CALL_TIMEOUT_MS = 300_000;

/** Upper bound on passes so a mis-planned job cannot loop indefinitely. */
const DEFAULT_MAX_PASSES = 20;

/**
 * Total time driveJob may spend *sleeping* on scheduled task retries within a
 * single run. Retries exist for transient upstream failures (provider 500s,
 * rate limits), which clear in seconds to a couple of minutes — so a bounded
 * wait recovers the job, while the bound stops one job holding a queue slot
 * forever when a provider is genuinely down.
 */
const DEFAULT_MAX_RETRY_WAIT_MS = 10 * 60_000;

/** How many agents may be offered to the planner in one prompt. */
const PLANNING_AGENT_LIMIT = 60;

/**
 * Models the planner will try, best first.
 *
 * Decomposition is the highest-leverage call in a job: a bad plan is paid for
 * by every agent that then executes it, so the coordinator gets the strongest
 * model rather than the cheapest. 'auto-smart' ranks candidates purely on
 * quality; the lower tiers exist because a planning failure blocks the job
 * entirely, and a plan from a weaker model beats no plan at all.
 *
 * DMRX_PLANNER_MODEL pins a specific model and disables the ladder.
 */
const PLANNER_MODEL_LADDER = ['auto-smart', 'auto-reasoning', 'auto'] as const;

export interface GatewayCallOptions {
  gatewayUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

interface ResolvedGateway {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

function resolveGateway(opts: GatewayCallOptions = {}): ResolvedGateway {
  const url = opts.gatewayUrl ?? process.env.DMRX_GATEWAY_URL ?? 'http://localhost:3000';
  const key = opts.apiKey ?? process.env.DMRX_INTERNAL_API_KEY;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers['authorization'] = `Bearer ${key}`;
  return { url, headers, timeoutMs: opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS };
}

interface GatewayResponse {
  ok: boolean;
  status: number;
  body: any;
}

/** Transport-level retries. See callGateway for why these happen at all. */
const TRANSPORT_RETRIES = 2;
const TRANSPORT_RETRY_DELAY_MS = 1_500;

/**
 * Call the gateway. Never throws — transport failures come back as ok:false.
 *
 * Connection-level failures are retried, HTTP errors are not. These calls go
 * to the gateway's own port, and sql.js is synchronous WebAssembly on the one
 * JS thread: while a query runs, nothing else is serviced, so a self-call can
 * have its socket closed under load. Retrying a dropped connection is safe;
 * retrying a 4xx or 5xx would just repeat work the server already rejected or
 * already performed.
 */
async function callGateway(
  gw: ResolvedGateway,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<GatewayResponse> {
  let lastMessage = 'request failed';

  for (let attempt = 0; attempt <= TRANSPORT_RETRIES; attempt++) {
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
      lastMessage = error instanceof Error ? error.message : String(error);
      // A timeout means the work may still be running server-side; repeating it
      // would double-charge the caller. Only reconnect on a dropped socket.
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      if (isTimeout || attempt === TRANSPORT_RETRIES) break;
      logger.warn({ path, attempt: attempt + 1, err: lastMessage }, 'job-runner: retrying gateway call');
      await new Promise((r) => setTimeout(r, TRANSPORT_RETRY_DELAY_MS * (attempt + 1)));
    }
  }

  return { ok: false, status: 0, body: { error: { message: lastMessage } } };
}

/** Pull assistant text out of whichever response shape the gateway returned. */
function extractText(body: any): string {
  return (
    body?.content ??
    body?.output ??
    body?.result ??
    body?.choices?.[0]?.message?.content ??
    ''
  );
}

function buildTaskMessage(task: JobTask, boardContext: string): string {
  const parts = [`Task: ${task.title}`];
  if (task.description) parts.push(`\nDescription:\n${task.description}`);
  if (task.deliverable) parts.push(`\nDeliverable:\n${task.deliverable}`);
  if (task.acceptance) parts.push(`\nAcceptance criteria:\n${task.acceptance}`);
  // boardContext is already a fenced untrusted-data block. Append it verbatim;
  // reformatting or unwrapping it would break the fence it relies on.
  if (boardContext) parts.push(`\n${boardContext}`);
  return parts.join('\n');
}

/**
 * Build the executor the orchestrator calls for each task. It resolves an
 * agent (using the task's assignment, or asking /agentic/dispatch to pick one),
 * sends the task plus its dependency context, and reports the outcome.
 *
 * It never throws: every failure is returned as ok:false so the orchestrator
 * can record a failed task rather than stranding it.
 */
export function createTaskExecutor(opts: GatewayCallOptions = {}): TaskExecutor {
  const gw = resolveGateway(opts);

  return async ({ task, boardContext }): Promise<TaskExecutionResult> => {
    const failure = (error: string, agentName = 'unassigned'): TaskExecutionResult => ({
      ok: false,
      agentName,
      summary: '',
      error,
    });

    try {
      let instanceId = task.assignedInstanceId ?? null;

      // No agent assigned at plan time: let DMR-X choose one for this task.
      if (!instanceId) {
        const dispatch = await callGateway(gw, 'POST', '/v1/agentic/dispatch', {
          task: [task.title, task.description].filter(Boolean).join('\n'),
          run: false,
        });
        if (!dispatch.ok) {
          return failure(`agent selection failed: ${dispatch.status} ${JSON.stringify(dispatch.body)}`);
        }
        instanceId =
          dispatch.body?.instanceId ??
          dispatch.body?.instance?.id ??
          dispatch.body?.selected?.instanceId ??
          dispatch.body?.selected?.id ??
          null;
      }

      if (!instanceId) return failure('no agent available for task');

      const chat = await callGateway(
        gw,
        'POST',
        `/v1/agents/${encodeURIComponent(instanceId)}/chat`,
        { messages: [{ role: 'user', content: buildTaskMessage(task, boardContext) }], stream: false },
      );

      if (!chat.ok) {
        return failure(`agent call failed: ${chat.status} ${JSON.stringify(chat.body)}`, instanceId);
      }

      const usage = chat.body?.usage ?? {};
      // Prefer the run totals the chat route reports. `usage` is the final
      // step only, so billing a multi-step run from it undercounts everything
      // before the last turn.
      return {
        ok: true,
        agentName: chat.body?.agentName ?? instanceId,
        summary: extractText(chat.body),
        artifacts: [],
        openQuestions: [],
        forNext: [],
        costUsd: Number(chat.body?.costUsd ?? usage.cost ?? usage.total_cost ?? 0) || 0,
        tokens:
          Number(chat.body?.totalTokens ?? usage.total_tokens ?? usage.totalTokens ?? 0) || 0,
      };
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  };
}

export type PlanJobResult = { ok: true; taskCount: number } | { ok: false; error: string };

/**
 * Turn a job's brief into tasks. Asks a model to decompose it, parses the
 * response, and persists the plan — but only if the plan is sound, since
 * materializePlan throws rather than writing a cyclic or dangling graph.
 *
 * A job is planned once. Planning twice would duplicate every task.
 */
export async function planJob(
  tenantId: string,
  jobId: string,
  opts: GatewayCallOptions & { model?: string } = {},
): Promise<PlanJobResult> {
  const gw = resolveGateway(opts);

  const job = jobStore.getJob(tenantId, jobId);
  if (!job) return { ok: false, error: 'job not found' };
  if (jobStore.listTasks(tenantId, jobId).length > 0) {
    return { ok: false, error: 'job already planned' };
  }

  // Cap the roster. Every agent listed here is serialised into the planning
  // prompt, so an unbounded tenant (a bulk import can create hundreds) would
  // send a vast prompt on every plan and pay for it in tokens each time.
  const instances = await callGateway(
    gw,
    'GET',
    `/v1/agents/instances?status=active&limit=${PLANNING_AGENT_LIMIT}`,
  );
  const agents: AgentSummary[] = (instances.body?.items ?? [])
    .slice(0, PLANNING_AGENT_LIMIT)
    .map((item: any) => ({
      instanceId: item.id,
      name: item.definitionHumanName ?? item.definitionName ?? item.id,
      description: item.definitionDescription ?? undefined,
      category: item.definitionCategory ?? undefined,
    }));

  const totalAgents = Number(instances.body?.total ?? agents.length);
  if (totalAgents > agents.length) {
    logger.warn(
      { tenantId, jobId, totalAgents, offered: agents.length },
      'job-runner: agent roster truncated for planning prompt',
    );
  }

  jobStore.updateJobStatus(tenantId, jobId, 'planning');

  const prompt = buildPlanPrompt(job, agents);

  // Try each tier in turn. A model can fail here by erroring, by returning
  // nothing, or by returning prose instead of JSON -- all three block the job
  // equally, so all three fall through to the next tier rather than only
  // transport errors doing so.
  const models = opts.model
    ? [opts.model]
    : process.env.DMRX_PLANNER_MODEL
      ? [process.env.DMRX_PLANNER_MODEL]
      : [...PLANNER_MODEL_LADDER];

  let plan: PlannedTask[] | null = null;
  let lastError = 'no planner model produced a usable plan';

  for (const model of models) {
    const completion = await callGateway(gw, 'POST', '/v1/chat/completions', {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      // Ask the router for its best candidates, not its cheapest.
      quality_target: 'frontier',
    });

    const resolved = completion.body?.model;
    const finish = completion.body?.choices?.[0]?.finish_reason;

    if (!completion.ok) {
      lastError = `planning call failed: ${completion.status}`;
      logger.warn({ tenantId, jobId, model, status: completion.status }, 'job-runner: planner call failed');
      continue;
    }

    const raw = extractText(completion.body);

    // An empty response and an unparseable one have different causes -- a
    // provider error or a truncated generation, versus a model ignoring the
    // requested format -- so they are reported separately rather than both
    // surfacing as "could not parse plan".
    if (!raw.trim()) {
      lastError = 'planner returned an empty response';
      logger.warn({ tenantId, jobId, model, resolved, finish }, 'job-runner: planner returned nothing');
      continue;
    }

    const attempt = parsePlanResponse(raw);
    if (attempt.ok) {
      plan = attempt.tasks;
      logger.info({ tenantId, jobId, model, resolved, tasks: plan.length }, 'job-runner: plan accepted');
      break;
    }

    // Carry a snippet of what came back; "unparseable" alone says nothing
    // about how to fix it.
    const snippet = raw.slice(0, 300).replace(/\s+/g, ' ');
    lastError = `could not parse plan: ${attempt.error} (model said: ${snippet})`;
    logger.warn(
      { tenantId, jobId, model, resolved, finish, length: raw.length, snippet },
      'job-runner: planner response could not be parsed, trying next tier',
    );
  }

  if (!plan) {
    jobStore.updateJobStatus(tenantId, jobId, 'failed');
    return { ok: false, error: lastError };
  }

  const parsed = { ok: true as const, tasks: plan };

  try {
    const created = materializePlan(tenantId, jobId, parsed.tasks);
    jobStore.updateJobStatus(tenantId, jobId, 'running');
    return { ok: true, taskCount: created.length };
  } catch (error) {
    jobStore.updateJobStatus(tenantId, jobId, 'failed');
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Run passes until the job stops progressing. Each pass runs every currently
 * unblocked task, so a chain of N dependent tasks needs N passes.
 *
 * Three stop conditions matter: a pass that reports 'running' while having run
 * nothing made no progress and would spin forever, maxPasses bounds a plan
 * that somehow keeps producing work, and a 'blocked' state that is only
 * waiting on a scheduled retry is slept through rather than returned.
 *
 * That last case is why a transient provider failure used to kill a job
 * outright: runTask parks a retryable failure as 'pending' with a future
 * `retryAfter`, readyTasks correctly skips it, so the scheduler reports
 * 'blocked' — and returning there stranded the job. Nothing re-queues a
 * blocked job, so its scheduled retry never fired even though the job had
 * budget, attempts remaining, and a healthy gateway. Waiting for the earliest
 * retryAfter and running another pass is what actually makes maxRetries mean
 * something.
 */
export async function driveJob(
  tenantId: string,
  jobId: string,
  executor: TaskExecutor,
  opts: { maxPasses?: number; maxRetryWaitMs?: number } = {},
): Promise<JobRunResult> {
  const maxPasses = opts.maxPasses ?? DEFAULT_MAX_PASSES;
  const maxRetryWaitMs = opts.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS;
  let retryWaitBudgetMs = maxRetryWaitMs;
  let last: JobRunResult = { state: 'empty', ranTaskIds: [] };

  for (let pass = 0; pass < maxPasses; pass++) {
    last = await runJobPass(tenantId, jobId, executor);

    if (last.state === 'blocked') {
      // Only a retry-scheduled block is recoverable. A real deadlock (cycle,
      // dangling dep, cancelled dependency) has no retryAfter to wait for and
      // must still be returned to the caller.
      const waitMs = msUntilNextRetry(tenantId, jobId);
      if (waitMs === null) return last;

      if (waitMs > retryWaitBudgetMs) {
        logger.warn(
          { jobId, waitMs, retryWaitBudgetMs },
          'job-runner: next retry is beyond the wait budget, leaving job blocked',
        );
        return { ...last, reason: `${last.reason ?? 'blocked'} (retry exceeds wait budget)` };
      }

      logger.info({ jobId, pass, waitMs }, 'job-runner: waiting for scheduled task retry');
      await new Promise((r) => setTimeout(r, waitMs));
      retryWaitBudgetMs -= waitMs;
      continue;
    }

    if (last.state !== 'running') return last;

    if (last.ranTaskIds.length === 0) {
      logger.warn({ jobId, pass }, 'job-runner: pass made no progress, stopping');
      return { ...last, reason: 'no progress' };
    }
  }

  logger.warn({ jobId, maxPasses }, 'job-runner: max passes reached');
  return { ...last, reason: 'max passes reached' };
}

/**
 * Milliseconds until the earliest scheduled retry among a job's pending
 * tasks, or null when no task is waiting on one (a genuine deadlock).
 *
 * A retryAfter already in the past returns 0 — the task is due now, so the
 * next pass should run immediately rather than sleeping.
 */
function msUntilNextRetry(tenantId: string, jobId: string): number | null {
  const now = Date.now();
  let earliest: number | null = null;

  for (const task of jobStore.listTasks(tenantId, jobId)) {
    if (task.status !== 'pending' || !task.retryAfter) continue;
    const at = new Date(task.retryAfter).getTime();
    if (Number.isNaN(at)) continue;
    if (earliest === null || at < earliest) earliest = at;
  }

  if (earliest === null) return null;
  // +250ms so the pass lands just after the backoff window, not exactly on it.
  return Math.max(0, earliest - now + 250);
}
