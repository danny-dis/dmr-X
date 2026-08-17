import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { agentPermissions } from '../middleware/agent-rbac.middleware.js';
import {
  jobStore,
  type JobStatus,
  type ListJobsOptions,
} from '@dmr-x/agent-runtime';

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
  server.post('/jobs/:id/run', {
    preHandler: [agentPermissions.update()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
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
      poll: `/v1/jobs/${id}`,
    });
  });

  // ── Queue status ───────────────────────────────────────────────────────
  // Depth and in-flight jobs, so a caller polling a job can tell "waiting for
  // a slot" apart from "running slowly".
  server.get('/jobs/queue/status', {
    preHandler: [agentPermissions.read()],
  }, async (_request, reply) => {
    return reply.send(jobQueue.stats());
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
}
