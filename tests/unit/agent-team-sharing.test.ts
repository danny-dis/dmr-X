import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { initDb, closeDb, getDb } from '../../packages/db/src/client.js';
import { AgentRegistryService } from '../../services/agent-registry/src/agent-registry.service.js';
import { AgentRuntimeService } from '../../services/agent-runtime/src/agent-runtime.js';
import Fastify from 'fastify';
import { agentRoutes } from '../../apps/gateway/src/routes/agent.routes.js';

async function httpFixture() {
  const app = Fastify();
  // Fixture principal injection only; production auth is covered separately.
  app.addHook('onRequest', async (req, reply) => {
    const principals: Record<string, { id: string; role: string }> = {
      'Bearer team-a': { id: 'team-a', role: 'admin' },
      'Bearer team-b': { id: 'team-b', role: 'admin' },
      'Bearer viewer-a': { id: 'team-a', role: 'viewer' },
    };
    const tenant = principals[String(req.headers.authorization)];
    if (!tenant) return reply.code(401).send();
    (req as any).tenant = tenant;
  });
  await app.register(agentRoutes, { prefix: '/v1' });
  await app.ready();
  return app;
}

let dir: string;
let registry: AgentRegistryService;
let definitionId: string;
const oldDataDir = process.env.DMRX_DATA_DIR;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmrx-sharing-'));
  process.env.DMRX_DATA_DIR = dir;
  await closeDb().catch(() => {});
  await initDb();
  for (const id of ['team-a', 'team-b', 'team-c']) getDb().prepare('INSERT OR IGNORE INTO tenants (id,name) VALUES (?,?)').run(id,id);
  registry = new AgentRegistryService();
  definitionId = (await registry.createDefinition('team-a', { name: 'private-team-agent', systemPrompt: 'Only explicitly shared', visibility: 'private', allowedTools: [] })).id;
});
afterEach(async () => {
  await closeDb();
  if (oldDataDir === undefined) delete process.env.DMRX_DATA_DIR; else process.env.DMRX_DATA_DIR = oldDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('explicit cross-workspace definition sharing', () => {
  it('allows a read grant without allowing deployment or modification', async () => {
    expect(typeof registry.shareDefinition).toBe('function');
    expect(await registry.shareDefinition(definitionId, 'team-a', 'team-b', 'read')).toBe(true);
    expect(await registry.canAccessDefinition(definitionId, 'team-b', 'read')).toBe(true);
    expect(await registry.createInstance('team-b', { agentDefinitionId: definitionId })).toBeNull();
    expect(await registry.updateDefinition(definitionId, 'team-b', { name: 'stolen' })).toBeNull();
    expect(await registry.deleteDefinition(definitionId, 'team-b')).toBe(false);
  });
  it('allows a run grant with a recipient-owned instance and context', async () => {
    expect(typeof registry.shareDefinition).toBe('function');
    expect(await registry.createInstance('team-b', { agentDefinitionId: definitionId })).toBeNull();
    await registry.shareDefinition(definitionId, 'team-a', 'team-b', 'run');
    const instance = await registry.createInstance('team-b', { agentDefinitionId: definitionId });
    expect(instance?.tenantId).toBe('team-b');
    const runtime = new AgentRuntimeService();
    expect((await runtime.loadContext(instance!.id, 'team-b'))?.tenantId).toBe('team-b');
    expect(await runtime.loadContext(instance!.id, 'team-a')).toBeNull();
    expect(await runtime.loadContext(instance!.id, 'team-c')).toBeNull();
  });
  it('denies escalation, resharing and grants to nonexistent workspaces', async () => {
    expect(typeof registry.shareDefinition).toBe('function');
    expect(await registry.shareDefinition(definitionId, 'team-b', 'team-c', 'run')).toBe(false);
    expect(await registry.shareDefinition(definitionId, 'team-a', 'missing-team', 'run')).toBe(false);
    await registry.shareDefinition(definitionId, 'team-a', 'team-b', 'run');
    expect(await registry.shareDefinition(definitionId, 'team-b', 'team-c', 'run')).toBe(false);
    expect(await registry.canAccessDefinition(definitionId, 'team-c', 'read')).toBe(false);
  });
  it('enforces revocation and downgrade on already-deployed recipient instances', async () => {
    expect(typeof registry.shareDefinition).toBe('function');
    await registry.shareDefinition(definitionId, 'team-a', 'team-b', 'run');
    const instance = (await registry.createInstance('team-b', { agentDefinitionId: definitionId }))!;
    await registry.shareDefinition(definitionId, 'team-a', 'team-b', 'read');
    expect(await new AgentRuntimeService().loadContext(instance.id, 'team-b')).toBeNull();
    await registry.shareDefinition(definitionId, 'team-a', 'team-b', 'run');
    expect(await registry.revokeDefinitionShare(definitionId, 'team-c', 'team-b')).toBe(false);
    expect(await registry.revokeDefinitionShare(definitionId, 'team-a', 'team-b')).toBe(true);
    expect(await new AgentRuntimeService().loadContext(instance.id, 'team-b')).toBeNull();
    expect(await registry.createInstance('team-b', { agentDefinitionId: definitionId })).toBeNull();
  });
  it('persists grants across DB close/reopen and scopes discovery', async () => {
    expect(typeof registry.shareDefinition).toBe('function');
    await registry.shareDefinition(definitionId, 'team-a', 'team-b', 'run');
    await closeDb(); await initDb();
    const reopened = new AgentRegistryService();
    expect((await reopened.listSharedDefinitions('team-b')).map(d => d.id)).toEqual([definitionId]);
    expect(await reopened.listSharedDefinitions('team-c')).toEqual([]);
    expect(await reopened.canAccessDefinition(definitionId, 'team-b', 'run')).toBe(true);
  });
});
