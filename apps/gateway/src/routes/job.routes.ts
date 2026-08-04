import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { agentPermissions } from '../middleware/agent-rbac.middleware.js';
import {
  jobStore,
  type JobStatus,
  type ListJobsOptions,
} from '@dmr-x/agent-runtime';

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
  brief: z.string().min(1).max(20000),
  source: z.enum(['api', 'ui', 'mcp']).default('api'),
  acceptanceCriteria: z.array(z.unknown()).optional(),
  budgetUsd: z.number().positive().optional(),
  budgetTokens: z.number().int().positive().optional(),
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
}
