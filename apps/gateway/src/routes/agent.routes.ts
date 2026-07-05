import { agentRegistryService, AgentDefinitionCreateSchema, AgentDefinitionUpdateSchema, AgentInstanceCreateSchema, AgentListQuerySchema, AgentRatingCreateSchema, MarketplaceQuerySchema } from '@dmr-x/agent-registry';
import { getDb } from '@dmr-x/db';
import type { FastifyInstance } from 'fastify';

import { agentPermissions } from '../middleware/agent-rbac.middleware.js';

// ---------------------------------------------------------------------------
// Agent Platform Routes
// ---------------------------------------------------------------------------

export async function agentRoutes(server: FastifyInstance): Promise<void> {
  // ── Agent Definitions ─────────────────────────────────────────────────────

  server.post('/agents', { preHandler: [agentPermissions.create()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const parsed = AgentDefinitionCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }

    const agent = await agentRegistryService.createDefinition(tenant.id, parsed.data);
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
    return reply.send(agent);
  });

  server.delete('/agents/:id', { preHandler: [agentPermissions.delete()] }, async (request, reply) => {
    const tenant = (request as any).tenant;

    const { id } = request.params as { id: string };
    const deleted = await agentRegistryService.deleteDefinition(id, tenant.id);
    if (!deleted) return reply.code(404).send({ error: { message: 'Agent not found' } });
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
}
