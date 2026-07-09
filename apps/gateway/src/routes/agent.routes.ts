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

  server.get('/agents/:id/instances', { preHandler: [agentPermissions.read()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const instances = await agentRegistryService.listInstances(tenant.id);
    return reply.send(instances);
  });

  server.delete('/instances/:id', { preHandler: [agentPermissions.delete()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const deleted = await agentRegistryService.deleteInstance(id, tenant.id);
    if (!deleted) return reply.code(404).send({ error: { message: 'Instance not found' } });
    return reply.code(204).send();
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

  // ── Marketplace ───────────────────────────────────────────────────────────

  server.get('/marketplace', async (request, reply) => {
    const query = MarketplaceQuerySchema.parse(request.query);
    const result = await agentRegistryService.browseMarketplace(query);
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

    let definitions: AgentDefinitionCreate[] = [];

    try {
      if (contentType.includes('multipart/form-data')) {
        // ZIP upload: single file field named "file"
        const data = await (request as any).file();
        if (!data) {
          return reply.code(400).send({ error: { message: 'No file uploaded' } });
        }
        const buffer: Buffer = await data.toBuffer();
        const files = await extractZipMdFiles(buffer);
        definitions = parseAgentMdBatch(files, categoryOverride).map((a) => a.definition);
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
          const files = await fetchGitHubRepoMdFiles(body.githubUrl);
          definitions = parseAgentMdBatch(files, categoryOverride ?? body.category).map((a) => a.definition);
        } else if (body.source === 'text') {
          if (!body.content) {
            return reply.code(400).send({ error: { message: 'content is required for text source' } });
          }
          const agent = parseAgentMdFromString(body.content, {
            filePath: body.filename,
            categoryOverride: categoryOverride ?? body.category,
          });
          if (!agent) {
            return reply.code(400).send({ error: { message: 'Failed to parse agent definition from content' } });
          }
          definitions = [agent.definition];
        } else {
          return reply.code(400).send({ error: { message: `Unsupported source: ${body.source}` } });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Agent import failed');
      return reply.code(502).send({ error: { message: `Import failed: ${message}` } });
    }

    if (definitions.length === 0) {
      return reply.code(200).send({ imported: 0, skipped: 0, errors: [], agents: [] });
    }

    const result = await agentRegistryService.importAgents(tenant.id, definitions, { modelTier });
    return reply.code(201).send(result);
  });
}
