import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { agentPermissions } from '../middleware/agent-rbac.middleware.js';
import {
  jobStore,
  scoreAgentForTask,
  readBoard,
  type JobStatus,
  type ListJobsOptions,
} from '@dmr-x/agent-runtime';
import { agentRegistryService, isSystemAgentName } from '@dmr-x/agent-registry';

import { planJob } from '../lib/job-runner.js';
import { jobQueue } from '../lib/job-queue.js';
import { subscribeToJobEvents, type JobEvent } from '@dmr-x/agent-runtime';
import { writeSSE } from '../lib/sse.js';

// ---------------------------------------------------------------------------
// Job intake routes
//
// A job is a delivered outcome (e.g. "build me a 2D platformer") that is
// later decomposed into tasks run by different agents. This module is the
// HTTP intake surface only — submission and inspection. It does NOT build
// or run the orchestration that drives a job through its lifecycle.
//
// Every handler is tenant-scoped: jobStore methods take tenantId as their
// first argument, and we always pass the caller's real tenant id from
// (request as any).tenant. Ids, tenantId, spentUsd and spentTokens are
// server-controlled — never accepted from the client.
// ---------------------------------------------------------------------------

const JobStatusSchema = z.enum([
  'intake',
  'planning',
  'running',
  'blocked',
  'verifying',
  'delivered',
  'failed',
  'cancelled',
]);

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateJobRequestSchema = z.object({
  brief: z.string().min(1).max(10000),
  source: z.enum(['api', 'ui', 'mcp']).default('api'),
  acceptanceCriteria: z.array(z.unknown()).optional(),
  budgetUsd: z.number().positive().optional(),
  budgetTokens: z.number().int().positive().optional(),
  budgetDurationMs: z.number().int().positive().optional(),
  deadlineAt: z.string().datetime().optional(),
  maxDepth: z.number().int().min(1).max(10).optional().default(3),
  pinAgents: z.boolean().optional().default(false),
});

const ListJobsQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const MatchAgentsBodySchema = z.object({
  task: z.string().min(1),
  language: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const AssignTaskBodySchema = z.object({
  assignedAgentDefId: z.string().min(1),
  assignedAgentVersion: z.string().optional(),
  assignedInstanceId: z.string().optional(),
  assignedModel: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerJobRoutes(server: FastifyInstance): void {
  // ── Create job ────────────────────────────────────────────────────────
  server.post('/jobs', {
    preHandler: [agentPermissions.create()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const parsed = CreateJobRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }

    // id / tenantId / spentUsd / spentTokens are server-controlled. The
    // Zod schema above strips any client-supplied keys, and we generate the
    // job id here — never from the request body.
    const job = jobStore.createJob({
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      source: parsed.data.source,
      brief: parsed.data.brief,
      acceptanceCriteria: parsed.data.acceptanceCriteria,
      budgetUsd: parsed.data.budgetUsd,
      budgetTokens: parsed.data.budgetTokens,
      budgetDurationMs: parsed.data.budgetDurationMs,
      deadlineAt: parsed.data.deadlineAt,
      maxDepth: parsed.data.maxDepth,
      pinAgents: parsed.data.pinAgents,
    });

    return reply.code(201).send(job);
  });

  // ── List jobs ─────────────────────────────────────────────────────────
  server.get('/jobs', {
    preHandler: [agentPermissions.read()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const q = request.query as Record<string, unknown>;
    // Query params arrive as strings — coerce numerics explicitly before
    // validation, or a string reaches jobStore where a number is expected.
    const coerced = {
      ...q,
      status: q.status != null ? String(q.status) : undefined,
      limit: q.limit != null ? Number(q.limit) : undefined,
      offset: q.offset != null ? Number(q.offset) : undefined,
    };
    const query = ListJobsQuerySchema.safeParse(coerced);
    if (!query.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: query.error.issues } });
    }

    const options: ListJobsOptions = {
      status: query.data.status as JobStatus | undefined,
      limit: query.data.limit,
      offset: query.data.offset,
    };
    const jobs = jobStore.listJobs(tenant.id, options);
    return reply.send(jobs);
  });

  // ── Get job ───────────────────────────────────────────────────────────
  server.get('/jobs/:id', {
    preHandler: [agentPermissions.read()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    // getJob is tenant-scoped in SQL — null means absent OR owned by
    // another tenant, so we never return a job on id match alone.
    const job = jobStore.getJob(tenant.id, id);
    if (!job) {
      return reply.code(404).send({ error: { message: 'Job not found' } });
    }
    return reply.send(job);
  });

  // ── Cancel job ────────────────────────────────────────────────────────
  server.post('/jobs/:id/cancel', {
    preHandler: [agentPermissions.update()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    // cancelJob updates WHERE id = ? AND tenant_id = ? and reads back via
    // the tenant-scoped getJob — null means not found or not owned.
    // Drop it from the queue too, or a cancelled job still waiting for a slot
    // would start anyway. A job already in flight stops at its next pass,
    // since runJobPass refuses to start work for a cancelled job.
    jobQueue.dequeue(id);

    const job = jobStore.cancelJob(tenant.id, id);
    if (!job) {
      return reply.code(404).send({ error: { message: 'Job not found' } });
    }
    return reply.send(job);
  });

  // ── List job tasks ────────────────────────────────────────────────────
  server.get('/jobs/:id/tasks', {
    preHandler: [agentPermissions.read()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    // 404 up-front on a job that doesn't exist or isn't owned, so a task
    // list is never served for another tenant's job.
    const job = jobStore.getJob(tenant.id, id);
    if (!job) {
      return reply.code(404).send({ error: { message: 'Job not found' } });
    }
    // listTasks joins on jobs.tenant_id — only tasks of this tenant's job,
    // ordered by seq ascending.
    const tasks = jobStore.listTasks(tenant.id, id);
    return reply.send(tasks);
  });

  // ── Plan job ───────────────────────────────────────────────────────────
  // Decompose the brief into tasks. Separate from creation so a caller can
  // inspect (or replace) the plan before any agent is paid to act on it.
  server.post('/jobs/:id/plan', {
    preHandler: [agentPermissions.update()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    if (!jobStore.getJob(tenant.id, id)) {
      return reply.code(404).send({ error: { message: 'Job not found' } });
    }

    const body = (request.body ?? {}) as { model?: string };
    const result = await planJob(tenant.id, id, { model: body.model });
    if (!result.ok) {
      // 'already planned' is a conflict, not a server fault.
      const code = /already planned/i.test(result.error) ? 409 : 422;
      return reply.code(code).send({ error: { message: result.error } });
    }

    return reply.send({ jobId: id, taskCount: result.taskCount, tasks: jobStore.listTasks(tenant.id, id) });
  });

  // ── Run job ────────────────────────────────────────────────────────────
  // Enqueue and return. A job runs for minutes, so holding the connection open
  // means clients time out on work that is progressing fine, and a client that
  // gives up leaves the run orphaned mid-task. Poll GET /jobs/:id for progress.
  //
  // `coordinator: 'receptionist'` pre-staffs the plan before enqueueing: each
  // pending task is pinned to the best capability-matched active agent (the
  // Receptionist's own matcher), so the run uses real assignments instead of
  // the executor's per-task keyword dispatch. Unmatched tasks stay unassigned
  // and fall back to dispatch as usual.
  server.post('/jobs/:id/run', {
    preHandler: [agentPermissions.update()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { coordinator?: string };
    const job = jobStore.getJob(tenant.id, id);
    if (!job) {
      return reply.code(404).send({ error: { message: 'Job not found' } });
    }
    if (jobStore.listTasks(tenant.id, id).length === 0) {
      return reply.code(422).send({
        error: { message: 'Job has no tasks — call POST /jobs/:id/plan first' },
      });
    }
    if (job.status === 'cancelled' || job.status === 'delivered') {
      return reply.code(409).send({
        error: { message: `Job is ${job.status} and cannot be run` },
      });
    }

    let assignedCount = 0;
    if (body.coordinator === 'receptionist') {
      assignedCount = await staffJobWithReceptionist(tenant.id, id);
    }

    const enqueued = jobQueue.enqueue(tenant.id, id);
    if (!enqueued.accepted) {
      // Already queued or running is a conflict, not a failure: the caller's
      // intent is already satisfied, but silently returning 202 would suggest
      // a second run was scheduled.
      return reply.code(409).send({
        error: { message: enqueued.reason ?? 'Job could not be queued' },
        jobId: id,
        queuePosition: enqueued.position,
      });
    }

    return reply.code(202).send({
      jobId: id,
      status: 'queued',
      queuePosition: enqueued.position,
      coordinator: body.coordinator === 'receptionist' ? 'receptionist' : 'default',
      assignedTasks: assignedCount,
      poll: `/v1/jobs/${id}`,
    });
  });

  /**
   * Pin every pending task to the best capability-matched active agent.
   *
   * Uses updateTask rather than jobStore.assignTask: assignTask moves the task
   * to 'assigned', which readyTasks does not treat as pending — pre-staffing
   * through it would deadlock every task it touched. The assignment columns
   * are what the task executor reads; status stays 'pending'.
   */
  async function staffJobWithReceptionist(tenantId: string, jobId: string): Promise<number> {
    const tasks = jobStore.listTasks(tenantId, jobId);
    const pending = tasks.filter((t) => t.status === 'pending');
    if (pending.length === 0) return 0;

    const { items } = await agentRegistryService.listInstances(tenantId, { status: 'active' });
    const pool = items.filter((i) => !isSystemAgentName(i.definitionName));

    let assigned = 0;
    for (const task of pending) {
      const taskText = [task.title, task.description].filter(Boolean).join('\n');
      let best: { instance: (typeof pool)[number]; score: number } | null = null;
      for (const instance of pool) {
        const { score } = scoreAgentForTask(instance, taskText);
        if (score > 0 && (!best || score > best.score)) best = { instance, score };
      }
      if (!best) continue;
      jobStore.updateTask(tenantId, task.id, {
        assignedAgentDefId: best.instance.agentDefinitionId,
        assignedInstanceId: best.instance.id,
      });
      assigned++;
    }

    if (assigned > 0 || pending.length > 0) {
      const log = Array.isArray(jobStore.getJob(tenantId, jobId)?.decisionLog)
        ? (jobStore.getJob(tenantId, jobId)?.decisionLog as unknown[])
        : [];
      jobStore.updateJob(tenantId, jobId, {
        decisionLog: [
          ...log,
          {
            at: new Date().toISOString(),
            by: '__receptionist',
            action: 'staff_job',
            matched: assigned,
            pending: pending.length,
          },
        ],
      });
    }
    return assigned;
  }

  // ── Queue status ───────────────────────────────────────────────────────
  // Depth and in-flight jobs, so a caller polling a job can tell "waiting for
  // a slot" apart from "running slowly".
  server.get('/jobs/queue/status', {
    preHandler: [agentPermissions.read()],
  }, async (_request, reply) => {
    return reply.send(jobQueue.stats());
  });

  // ── Verify job ─────────────────────────────────────────────────────────
  // Move a job to 'verifying' status. The actual acceptance-criteria check
  // happens client-side (via dmrx_deliver_job) or automatically on completion.
  server.post('/jobs/:id/verify', {
    preHandler: [agentPermissions.update()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    const job = jobStore.getJob(tenant.id, id);
    if (!job) {
      return reply.code(404).send({ error: { message: 'Job not found' } });
    }
    const updated = jobStore.updateJobStatus(tenant.id, id, 'verifying');
    return reply.send({ jobId: id, status: updated?.status ?? 'verifying' });
  });

  // ── Deliver job ─────────────────────────────────────────────────────────
  // Mark a job 'delivered' with a result payload. Called after verification
  // passes (acceptance criteria met). The result is stored verbatim.
  server.post('/jobs/:id/deliver', {
    preHandler: [agentPermissions.update()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    const job = jobStore.getJob(tenant.id, id);
    if (!job) {
      return reply.code(404).send({ error: { message: 'Job not found' } });
    }
    const result = (request.body ?? {}) as Record<string, unknown>;
    const updated = jobStore.updateJob(tenant.id, id, { status: 'delivered', result });
    return reply.send({ jobId: id, status: updated?.status ?? 'delivered', result });
  });

  // ── Escalate job ────────────────────────────────────────────────────────
  // Move a job to 'blocked' with a reason. Used when no agent matches, a
  // task fails repeatedly, or the job is stuck and needs human intervention.
  server.post('/jobs/:id/escalate', {
    preHandler: [agentPermissions.update()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    const { reason } = (request.body ?? {}) as { reason?: string };
    const job = jobStore.getJob(tenant.id, id);
    if (!job) {
      return reply.code(404).send({ error: { message: 'Job not found' } });
    }
    const escalationReason = reason ?? 'escalated by receptionist';
    const updated = jobStore.updateJobStatus(tenant.id, id, 'blocked');
    const log = Array.isArray(job.decisionLog) ? (job.decisionLog as unknown[]) : [];
    jobStore.updateJob(tenant.id, id, {
      decisionLog: [
        ...log,
        { at: new Date().toISOString(), by: '__receptionist', action: 'escalate_to_human', reason: escalationReason },
      ],
    });
    return reply.send({ jobId: id, status: updated?.status ?? 'blocked', reason: escalationReason });
  });

  // ── Job events (SSE) ───────────────────────────────────────────────────
  // Stream real-time progress of a job's tasks as server-sent events.
  // Connect with EventSource('/v1/jobs/:id/events') to receive task:started,
  // task:completed, task:failed, pass:completed, job:completed, etc.
  server.get('/jobs/:id/events', {
    preHandler: [agentPermissions.read()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };

    const job = jobStore.getJob(tenant.id, id);
    if (!job) {
      return reply.code(404).send({ error: { message: 'Job not found' } });
    }

    // SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ jobId: id, status: job.status })}\n\n`);

    const unsubscribe = subscribeToJobEvents(id, (event: JobEvent) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    // Heartbeat every 15s to keep the connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 15_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // ── Match agents to task ──────────────────────────────────────────────
  // Score all active, non-system agents against a task and return the top N
  // matches. Used for agent discovery and manual assignment before a run.
  server.post('/agents/match', {
    preHandler: [agentPermissions.read()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const parsed = MatchAgentsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }

    const { task, language, limit } = parsed.data;
    if (task.trim().length === 0) {
      return reply.code(400).send({ error: { message: 'Task cannot be empty' } });
    }

    const { items } = await agentRegistryService.listInstances(tenant.id, { status: 'active', limit: 50 });
    const pool = items.filter((i) => !isSystemAgentName(i.definitionName));

    const scored = pool.map((instance) => {
      const { score, matchedOn } = scoreAgentForTask(instance, task, language);
      return {
        instanceId: instance.id,
        definitionId: instance.agentDefinitionId,
        name: instance.definitionName,
        score,
        matchedOn,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const candidates = scored.slice(0, limit);

    return reply.send({
      task,
      candidates,
      totalScoped: pool.length,
    });
  });

  // ── Assign task to agent ──────────────────────────────────────────────
  // Pin a task to a specific agent. Unlike staffJobWithReceptionist, this
  // uses assignTask which moves the task to 'assigned' status — intended for
  // explicit single-task assignment.
  server.patch('/jobs/:id/tasks/:taskId', {
    preHandler: [agentPermissions.update()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id, taskId } = request.params as { id: string; taskId: string };
    const parsed = AssignTaskBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }

    const input = {
      assignedAgentDefId: parsed.data.assignedAgentDefId,
      assignedAgentVersion: parsed.data.assignedAgentVersion,
      assignedInstanceId: parsed.data.assignedInstanceId,
      assignedModel: parsed.data.assignedModel,
    };

    const task = jobStore.assignTask(tenant.id, taskId, input);
    if (!task) {
      return reply.code(404).send({ error: { message: 'Task not found' } });
    }

    return reply.send(task);
  });

  // ── Job board ─────────────────────────────────────────────────────────
  // Read the current state of a job's task board — all tasks with their
  // assignments, statuses, and progress.
  server.get('/jobs/:id/board', {
    preHandler: [agentPermissions.read()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };

    const job = jobStore.getJob(tenant.id, id);
    if (!job) {
      return reply.code(404).send({ error: { message: 'Job not found' } });
    }

    const board = readBoard(tenant.id, id);
    return reply.send({ jobId: id, board });
  });
}
