import { logger } from '@dmr-x/utils';
import {
  agentRegistryService,
  AgentDefinitionCreateSchema,
  AgentDefinitionUpdateSchema,
  AgentInstanceCreateSchema,
  AgentListQuerySchema,
  AgentRatingCreateSchema,
  MarketplaceQuerySchema,
  AgentImportRequestSchema,
  parseAgentMdFromString,
  parseAgentMdBatch,
  fetchGitHubRepoMdFiles,
  extractZipMdFiles,
  importAgentsWithSkills,
  type AgentDefinitionCreate,
} from '@dmr-x/agent-registry';
import { getDb } from '@dmr-x/db';
import type { FastifyInstance } from 'fastify';
import { agentScheduler } from '@dmr-x/agent-runtime';

import { agentPermissions } from '../middleware/agent-rbac.middleware.js';

// ---------------------------------------------------------------------------
// Agent Platform Routes
// ---------------------------------------------------------------------------

/**
 * Sync an agent definition's `schedule` trigger to the scheduler's job table.
 * - A `schedule` trigger with a `cron` creates (or leaves) a recurring job.
 * - Absence of a `schedule` trigger removes any existing job for the agent.
 * Best-effort and non-fatal: scheduler errors are logged, not thrown.
 */
function syncScheduleTrigger(agentId: string, tenantId: string, triggers?: unknown): void {
  if (!agentScheduler) return;
  const list = Array.isArray(triggers) ? (triggers as Array<{ type?: string; cron?: string }>) : [];
  const schedule = list.find((t) => t?.type === 'schedule' && typeof t?.cron === 'string');

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM agent_scheduled_jobs WHERE agent_definition_id = ? AND trigger_type = 'schedule' LIMIT 1")
    .get(agentId) as { id: string } | undefined;

  if (schedule?.cron) {
    if (!existing) {
      try {
        agentScheduler.registerJob(agentId, tenantId, schedule.cron);
      } catch (err) {
        logger.warn({ err, agentId }, 'Failed to register scheduled job from trigger');
      }
    }
  } else if (existing) {
    try {
      agentScheduler.unregisterJob(existing.id);
    } catch (err) {
      logger.warn({ err, agentId }, 'Failed to unregister scheduled job');
    }
  }
}

export async function agentRoutes(server: FastifyInstance): Promise<void> {
  // ── Agent Definitions ─────────────────────────────────────────────────────

  server.post('/agents', { preHandler: [agentPermissions.create()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const parsed = AgentDefinitionCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }

    const agent = await agentRegistryService.createDefinition(tenant.id, parsed.data);
    syncScheduleTrigger(agent.id, tenant.id, parsed.data.triggers);
    return reply.code(201).send(agent);
  });

  server.get('/agents', { preHandler: [agentPermissions.read()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const query = AgentListQuerySchema.parse(request.query);
    const result = await agentRegistryService.listDefinitions(tenant.id, query);
    return reply.send(result);
  });

  server.get('/agents/:id', { preHandler: [agentPermissions.read()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const agent = await agentRegistryService.getDefinition(id);
    if (!agent || agent.tenantId !== tenant.id) {
      return reply.code(404).send({ error: { message: 'Agent not found' } });
    }
    return reply.send(agent);
  });

  server.put('/agents/:id', { preHandler: [agentPermissions.update()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const parsed = AgentDefinitionUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }

    const agent = await agentRegistryService.updateDefinition(id, tenant.id, parsed.data);
    if (!agent) return reply.code(404).send({ error: { message: 'Agent not found' } });
    syncScheduleTrigger(id, tenant.id, parsed.data.triggers);
    return reply.send(agent);
  });

  server.delete('/agents/:id', { preHandler: [agentPermissions.delete()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const deleted = await agentRegistryService.deleteDefinition(id, tenant.id);
    if (!deleted) return reply.code(404).send({ error: { message: 'Agent not found' } });
    syncScheduleTrigger(id, tenant.id, []);
    return reply.code(204).send();
  });

  // ── Agent Instances (Deployment) ──────────────────────────────────────────

  server.post('/agents/:id/deploy', { preHandler: [agentPermissions.deploy()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const parsed = AgentInstanceCreateSchema.safeParse({ ...(request.body as Record<string, unknown>), agentDefinitionId: id });
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }

    const instance = await agentRegistryService.createInstance(tenant.id, parsed.data);
    if (!instance) return reply.code(404).send({ error: { message: 'Agent definition not found' } });
    return reply.code(201).send(instance);
  });

  /**
   * Tenant-wide instance list.
   *
   * Fastify's radix router scores a static segment above a parametric one, so
   * this wins over `/agents/:id` regardless of registration order — but it is
   * declared first anyway to make the precedence obvious to a reader.
   */
  server.get('/agents/instances', { preHandler: [agentPermissions.read()] }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { status, limit, offset } = request.query as {
      status?: string;
      limit?: string;
      offset?: string;
    };

    if (status && status !== 'active' && status !== 'paused') {
      return reply.code(400).send({ error: { message: "status must be 'active' or 'paused'" } });
    }

    // Query params arrive as strings; passing one straight through as a number
    // silently disables the limit it was meant to apply.
    let parsedLimit: number | undefined;
    if (limit !== undefined) {
      parsedLimit = Number(limit);
      if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
        return reply.code(400).send({ error: { message: 'limit must be a positive number' } });
      }
      parsedLimit = Math.min(Math.floor(parsedLimit), 500);
    }

    let parsedOffset: number | undefined;
    if (offset !== undefined) {
      parsedOffset = Number(offset);
      if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
        return reply.code(400).send({ error: { message: 'offset must be a non-negative number' } });
      }
      parsedOffset = Math.floor(parsedOffset);
    }

    const result = await agentRegistryService.listInstances(tenant.id, {
      status,
      limit: parsedLimit,
      offset: parsedOffset,
    });
    return reply.send(result);
  });

  /**
   * Per-definition cost/usage rollup. Declared before `/agents/:id` for the
   * same readability reason as above.
   */
  server.get('/agents/analytics/costs', { preHandler: [agentPermissions.analyticsRead()] }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { from, to } = request.query as { from?: string; to?: string };

    // Reject unparseable dates rather than silently substituting the default
    // window — a chart quietly showing the wrong period is worse than an error.
    for (const [label, value] of [['from', from], ['to', to]] as const) {
      if (value !== undefined && Number.isNaN(Date.parse(value))) {
        return reply.code(400).send({ error: { message: `Invalid ${label} date: ${value}` } });
      }
    }

    const analytics = await agentRegistryService.getCostAnalytics(tenant.id, { from, to });
    return reply.send(analytics);
  });

  server.get('/agents/:id/instances', { preHandler: [agentPermissions.read()] }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };

    // Scoped to the requested definition. This route previously ignored `:id`
    // and returned every instance the tenant owned, which made the nested path
    // silently identical to the tenant-wide one.
    const result = await agentRegistryService.listInstances(tenant.id);
    const items = result.items.filter((i) => i.agentDefinitionId === id);
    return reply.send({ items, total: items.length });
  });

  server.delete('/instances/:id', { preHandler: [agentPermissions.delete()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const deleted = await agentRegistryService.deleteInstance(id, tenant.id);
    if (!deleted) return reply.code(404).send({ error: { message: 'Instance not found' } });
    return reply.code(204).send();
  });

  /**
   * Pause / resume a deployed instance.
   *
   * Uses `agent:deploy` rather than `agent:update`: pausing changes what is
   * running, not what the agent is, which is the same class of action as
   * deploying it.
   */
  server.post('/instances/:id/pause', { preHandler: [agentPermissions.deploy()] }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };

    const instance = await agentRegistryService.setInstanceStatus(id, tenant.id, 'paused');
    if (!instance) return reply.code(404).send({ error: { message: 'Instance not found' } });
    return reply.send(instance);
  });

  server.post('/instances/:id/resume', { preHandler: [agentPermissions.deploy()] }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };

    const instance = await agentRegistryService.setInstanceStatus(id, tenant.id, 'active');
    if (!instance) return reply.code(404).send({ error: { message: 'Instance not found' } });
    return reply.send(instance);
  });

  /**
   * Per-turn step trace for an instance's runs — the "why did this run do
   * that" view. Reads `session_steps`, which was being written on every agent
   * turn with no way to read it back.
   */
  server.get('/instances/:id/steps', { preHandler: [agentPermissions.analyticsRead()] }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    const { conversationId, limit } = request.query as { conversationId?: string; limit?: string };

    const steps = await agentRegistryService.listSessionSteps(id, tenant.id, {
      conversationId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return reply.send({ items: steps, total: steps.length });
  });

  // ── Agent Executions ──────────────────────────────────────────────────────

  server.get('/instances/:id/executions', { preHandler: [agentPermissions.analyticsRead()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const executions = await agentRegistryService.listExecutions(id, tenant.id);
    return reply.send(executions);
  });

  server.get('/instances/:id/stats', { preHandler: [agentPermissions.analyticsRead()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const stats = await agentRegistryService.getExecutionStats(id, tenant.id);
    return reply.send(stats);
  });

  server.get('/instances/:id/evaluations', { preHandler: [agentPermissions.analyticsRead()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const evaluations = await agentRegistryService.listEvaluations(id, tenant.id);
    return reply.send(evaluations);
  });

  server.get('/evaluations/:id', { preHandler: [agentPermissions.analyticsRead()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const evaluation = await agentRegistryService.getEvaluation(id, tenant.id);
    if (!evaluation) return reply.code(404).send({ error: { message: 'Evaluation not found' } });
    return reply.send(evaluation);
  });

  server.delete('/evaluations/:id', { preHandler: [agentPermissions.analyticsRead()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const deleted = await agentRegistryService.deleteEvaluation(id, tenant.id);
    if (!deleted) return reply.code(404).send({ error: { message: 'Evaluation not found' } });
    return reply.code(204).send();
  });

  // ── Marketplace ───────────────────────────────────────────────────────────

  server.get('/marketplace', async (request, reply) => {
    const parsed = MarketplaceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid query', details: parsed.error.issues } });
    }
    const result = await agentRegistryService.browseMarketplace(parsed.data);
    return reply.send(result);
  });

  server.get('/marketplace/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const listing = await agentRegistryService.getListing(id);
    if (!listing || listing.status !== 'published') {
      return reply.code(404).send({ error: { message: 'Listing not found' } });
    }
    return reply.send(listing);
  });

  server.post('/marketplace/:id/install', { preHandler: [agentPermissions.install()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const result = await agentRegistryService.installFromMarketplace(id, tenant.id);
    if (!result) return reply.code(404).send({ error: { message: 'Listing not found or cannot be installed' } });
    return reply.code(201).send(result);
  });

  server.post('/marketplace/:id/rate', { preHandler: [agentPermissions.rate()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const parsed = AgentRatingCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }

    await agentRegistryService.rateListing(id, tenant.id, parsed.data);
    return reply.code(204).send();
  });

  // ── Publish / Deprecate ───────────────────────────────────────────────────

  server.post('/agents/:id/publish', { preHandler: [agentPermissions.publish()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };

    const definition = await agentRegistryService.getDefinition(id);
    if (!definition || definition.tenantId !== tenant.id) {
      return reply.code(404).send({ error: { message: 'Agent not found' } });
    }

    // Check if listing already exists
    const db = getDb();
    const existing = db.prepare(
      'SELECT * FROM agent_listings WHERE agent_definition_id = ? AND publisher_tenant_id = ?'
    ).get(id, tenant.id) as any;

    let listing;
    if (existing) {
      listing = await agentRegistryService.publishListing(existing.id, tenant.id);
    } else {
      listing = await agentRegistryService.createListing(tenant.id, {
        agentDefinitionId: id,
        title: definition.name,
        description: definition.description ?? undefined,
        category: definition.category ?? undefined,
        tags: definition.tags,
        icon: definition.icon ?? undefined,
        screenshots: [],
        priceCents: 0,
      });
      if (listing) {
        listing = await agentRegistryService.publishListing(listing.id, tenant.id);
      }
    }

    if (!listing) return reply.code(500).send({ error: { message: 'Failed to publish agent' } });
    return reply.send(listing);
  });

  // ── Import Agents (GitHub / ZIP / pasted .md) ──────────────────────────────

  server.post('/agents/import', { preHandler: [agentPermissions.create()] }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const contentType = String(request.headers['content-type'] ?? '');

    // Options may arrive as query params (used by the ZIP multipart upload)
    const query = request.query as Record<string, string | undefined>;
    const modelTier = (query.modelTier as 'auto' | 'premium' | 'budget') ?? 'auto';
    const categoryOverride = query.category;

    // Raw .md files keyed by their original path — fed to both the agent
    // import AND the skill import so a single link populates both stores.
    let files: Map<string, string> = new Map();
    let source: 'github' | 'zip' | 'md' = 'md';

    try {
      if (contentType.includes('multipart/form-data')) {
        // ZIP upload: single file field named "file"
        const data = await (request as any).file();
        if (!data) {
          return reply.code(400).send({ error: { message: 'No file uploaded' } });
        }
        const buffer: Buffer = await data.toBuffer();
        files = await extractZipMdFiles(buffer);
        source = 'zip';
      } else {
        const parsed = AgentImportRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
        }
        const body = parsed.data;

        if (body.source === 'github') {
          if (!body.githubUrl) {
            return reply.code(400).send({ error: { message: 'githubUrl is required for github source' } });
          }
          files = await fetchGitHubRepoMdFiles(body.githubUrl);
          source = 'github';
        } else if (body.source === 'text') {
          if (!body.content) {
            return reply.code(400).send({ error: { message: 'content is required for text source' } });
          }
          // A single pasted definition becomes a one-entry file map.
          files = new Map([[body.filename || 'pasted.md', body.content]]);
          source = 'md';
        } else {
          return reply.code(400).send({ error: { message: `Unsupported source: ${body.source}` } });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Agent import failed');
      return reply.code(502).send({ error: { message: `Import failed: ${message}` } });
    }

    if (files.size === 0) {
      return reply.code(200).send({
        agents: { imported: 0, skipped: 0, errors: [], agents: [] },
        skills: { imported: 0, errors: [], skills: [] },
        artifacts: null,
      });
    }

    // Single orchestration call: import agents + skills + write .md/.zip artifacts.
    const result = await importAgentsWithSkills(tenant.id, files, {
      modelTier,
      category: categoryOverride,
      source,
    });

    return reply.code(201).send({
      agents: result.agents,
      skills: result.skills,
      artifacts: {
        dir: result.artifactsDir,
        zip: result.zipPath,
      },
    });
  });
}
