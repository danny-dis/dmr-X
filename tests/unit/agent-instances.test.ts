import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDb, closeDb, getDb } from '../../packages/db/src/client.js';
import { AgentRegistryService } from '../../services/agent-registry/src/agent-registry.service.js';

let tmpDir: string;
let service: AgentRegistryService;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-instances-test-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    // first run
  }
  await initDb();
  service = new AgentRegistryService();
});

afterEach(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function deployAgent(tenantId: string, name: string) {
  const def = await service.createDefinition(tenantId, { name });
  const instance = await service.createInstance(tenantId, { agentDefinitionId: def.id, configOverride: {} });
  if (!instance) throw new Error('createInstance returned null');
  return { def, instance };
}

describe('AgentRegistryService.listInstances', () => {
  it('returns an { items, total } envelope, matching listDefinitions', async () => {
    await deployAgent('tenant-1', 'alpha');

    const result = await service.listInstances('tenant-1');

    // The bare array this used to return was the shape the UI could not
    // consume, and was inconsistent with every other list endpoint.
    expect(Array.isArray(result)).toBe(false);
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('joins the parent definition so a list view needs no follow-up request', async () => {
    const { def } = await deployAgent('tenant-1', 'billing-agent');
    getDb()
      .prepare('UPDATE agent_definitions SET category = ?, icon = ?, human_name = ? WHERE id = ?')
      .run('finance', 'receipt', 'Billing Bot', def.id);

    const { items } = await service.listInstances('tenant-1');

    expect(items[0].definitionName).toBe('billing-agent');
    expect(items[0].definitionHumanName).toBe('Billing Bot');
    expect(items[0].definitionCategory).toBe('finance');
    expect(items[0].definitionIcon).toBe('receipt');
  });

  it('scopes to the tenant', async () => {
    await deployAgent('tenant-1', 'mine');
    await deployAgent('tenant-2', 'theirs');

    const { items, total } = await service.listInstances('tenant-1');

    expect(total).toBe(1);
    expect(items[0].definitionName).toBe('mine');
  });

  it('rolls up execution count, last run and 24h spend', async () => {
    const { instance } = await deployAgent('tenant-1', 'alpha');

    await service.recordExecution({
      agentInstanceId: instance.id,
      tenantId: 'tenant-1',
      costCents: 250,
      inputTokens: 100,
      outputTokens: 50,
    });
    await service.recordExecution({
      agentInstanceId: instance.id,
      tenantId: 'tenant-1',
      costCents: 150,
    });

    const { items } = await service.listInstances('tenant-1');

    expect(items[0].executionCount).toBe(2);
    expect(items[0].costCents24h).toBe(400);
    expect(items[0].lastExecutionAt).toBeTruthy();
  });

  it('excludes spend older than 24h from the 24h rollup', async () => {
    const { instance } = await deployAgent('tenant-1', 'alpha');

    const exec = await service.recordExecution({
      agentInstanceId: instance.id,
      tenantId: 'tenant-1',
      costCents: 999,
    });
    getDb()
      .prepare("UPDATE agent_executions SET created_at = datetime('now', '-3 days') WHERE id = ?")
      .run(exec.id);

    const { items } = await service.listInstances('tenant-1');

    expect(items[0].executionCount).toBe(1);
    expect(items[0].costCents24h).toBe(0);
  });

  it('reports zeroes rather than nulls for an instance that has never run', async () => {
    await deployAgent('tenant-1', 'never-run');

    const { items } = await service.listInstances('tenant-1');

    expect(items[0].executionCount).toBe(0);
    expect(items[0].costCents24h).toBe(0);
    expect(items[0].lastExecutionAt).toBeNull();
  });
});

describe('AgentRegistryService.setInstanceStatus', () => {
  it('pauses and resumes an instance', async () => {
    const { instance } = await deployAgent('tenant-1', 'alpha');
    expect(instance.status).toBe('active');

    const paused = await service.setInstanceStatus(instance.id, 'tenant-1', 'paused');
    expect(paused?.status).toBe('paused');

    const resumed = await service.setInstanceStatus(instance.id, 'tenant-1', 'active');
    expect(resumed?.status).toBe('active');
  });

  it('filters by status, so a paused instance is not a dispatch candidate', async () => {
    const { instance: a } = await deployAgent('tenant-1', 'alpha');
    await deployAgent('tenant-1', 'beta');

    await service.setInstanceStatus(a.id, 'tenant-1', 'paused');

    const active = await service.listInstances('tenant-1', { status: 'active' });
    const paused = await service.listInstances('tenant-1', { status: 'paused' });

    expect(active.total).toBe(1);
    expect(active.items[0].definitionName).toBe('beta');
    expect(paused.total).toBe(1);
    expect(paused.items[0].definitionName).toBe('alpha');
  });

  it('returns null for another tenant’s instance rather than mutating it', async () => {
    const { instance } = await deployAgent('tenant-1', 'alpha');

    const result = await service.setInstanceStatus(instance.id, 'tenant-2', 'paused');

    expect(result).toBeNull();
    expect((await service.getInstance(instance.id))?.status).toBe('active');
  });
});

describe('AgentRegistryService.getCostAnalytics', () => {
  it('aggregates executions up to the parent definition', async () => {
    const { def, instance } = await deployAgent('tenant-1', 'alpha');
    // A second instance of the same definition must fold into one row.
    const second = await service.createInstance('tenant-1', { agentDefinitionId: def.id, configOverride: {} });

    await service.recordExecution({
      agentInstanceId: instance.id,
      tenantId: 'tenant-1',
      costCents: 100,
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 1000,
    });
    await service.recordExecution({
      agentInstanceId: second!.id,
      tenantId: 'tenant-1',
      costCents: 300,
      inputTokens: 5,
      outputTokens: 5,
      durationMs: 3000,
      status: 'error',
    });

    const analytics = await service.getCostAnalytics('tenant-1');

    expect(analytics.items).toHaveLength(1);
    const row = analytics.items[0];
    expect(row.agentName).toBe('alpha');
    expect(row.instanceCount).toBe(2);
    expect(row.executions).toBe(2);
    expect(row.successCount).toBe(1);
    expect(row.errorCount).toBe(1);
    expect(row.totalTokens).toBe(40);
    // Cents are converted to dollars for display.
    expect(row.costUsd).toBeCloseTo(4);
    expect(row.avgDurationMs).toBe(2000);
  });

  it('honours the from/to window', async () => {
    const { instance } = await deployAgent('tenant-1', 'alpha');
    const old = await service.recordExecution({
      agentInstanceId: instance.id,
      tenantId: 'tenant-1',
      costCents: 500,
    });
    getDb()
      .prepare("UPDATE agent_executions SET created_at = datetime('now', '-90 days') WHERE id = ?")
      .run(old.id);

    // Default window is 30 days, so the 90-day-old row is out of range.
    const recent = await service.getCostAnalytics('tenant-1');
    expect(recent.items).toHaveLength(0);
    expect(recent.totals.costUsd).toBe(0);

    const wide = await service.getCostAnalytics('tenant-1', {
      from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(wide.items).toHaveLength(1);
    expect(wide.totals.costUsd).toBeCloseTo(5);
  });

  it('scopes to the tenant', async () => {
    const { instance: mine } = await deployAgent('tenant-1', 'mine');
    const { instance: theirs } = await deployAgent('tenant-2', 'theirs');

    await service.recordExecution({ agentInstanceId: mine.id, tenantId: 'tenant-1', costCents: 100 });
    await service.recordExecution({ agentInstanceId: theirs.id, tenantId: 'tenant-2', costCents: 900 });

    const analytics = await service.getCostAnalytics('tenant-1');

    expect(analytics.items).toHaveLength(1);
    expect(analytics.items[0].agentName).toBe('mine');
    expect(analytics.totals.costUsd).toBeCloseTo(1);
  });
});

describe('AgentRegistryService.listSessionSteps', () => {
  /**
   * agent_sessions has no `conversation_id` column — its primary key *is* the
   * conversation id. Seeding through raw SQL here mirrors what
   * agent-session.store.ts writes, so the join under test is exercised
   * against the real column layout rather than an assumed one.
   */
  function seedSession(conversationId: string, tenantId: string, instanceId: string) {
    const db = getDb();
    db.prepare(
      `INSERT INTO agent_sessions (id, tenant_id, agent_instance_id, state, status, last_turn)
       VALUES (?, ?, ?, '{}', 'completed', 1)`,
    ).run(conversationId, tenantId, instanceId);
  }

  function seedStep(conversationId: string, tenantId: string, turn: number, tokenDelta: number) {
    const db = getDb();
    db.prepare(
      `INSERT INTO session_steps
         (id, tenant_id, conversation_id, turn, status, budget_status,
          allowed_tool_calls, blocked_tool_calls, tool_results, token_delta, cost_delta)
       VALUES (?, ?, ?, ?, 'completed', 'within', ?, ?, '[]', ?, 0.5)`,
    ).run(
      crypto.randomUUID(),
      tenantId,
      conversationId,
      turn,
      JSON.stringify(['read_file']),
      JSON.stringify(['bash']),
      tokenDelta,
    );
  }

  it('returns steps for an instance, ordered by turn', async () => {
    const { instance } = await deployAgent('tenant-1', 'alpha');
    seedSession('conv-1', 'tenant-1', instance.id);
    seedStep('conv-1', 'tenant-1', 2, 200);
    seedStep('conv-1', 'tenant-1', 1, 100);

    const steps = await service.listSessionSteps(instance.id, 'tenant-1');

    expect(steps).toHaveLength(2);
    expect(steps[0].turn).toBe(1);
    expect(steps[1].turn).toBe(2);
    expect(steps[0].allowedToolCalls).toEqual(['read_file']);
    expect(steps[0].blockedToolCalls).toEqual(['bash']);
    expect(steps[0].tokenDelta).toBe(100);
  });

  it('filters by conversationId', async () => {
    const { instance } = await deployAgent('tenant-1', 'alpha');
    seedSession('conv-1', 'tenant-1', instance.id);
    seedSession('conv-2', 'tenant-1', instance.id);
    seedStep('conv-1', 'tenant-1', 1, 100);
    seedStep('conv-2', 'tenant-1', 1, 999);

    const steps = await service.listSessionSteps(instance.id, 'tenant-1', { conversationId: 'conv-2' });

    expect(steps).toHaveLength(1);
    expect(steps[0].tokenDelta).toBe(999);
  });

  it("does not leak another tenant's steps", async () => {
    const { instance } = await deployAgent('tenant-1', 'alpha');
    seedSession('conv-1', 'tenant-1', instance.id);
    seedStep('conv-1', 'tenant-1', 1, 100);

    const steps = await service.listSessionSteps(instance.id, 'tenant-2');

    expect(steps).toHaveLength(0);
  });

  it('degrades a corrupt JSON column instead of throwing', async () => {
    const { instance } = await deployAgent('tenant-1', 'alpha');
    seedSession('conv-1', 'tenant-1', instance.id);
    seedStep('conv-1', 'tenant-1', 1, 100);
    getDb()
      .prepare("UPDATE session_steps SET allowed_tool_calls = 'not json' WHERE conversation_id = 'conv-1'")
      .run();

    const steps = await service.listSessionSteps(instance.id, 'tenant-1');

    // The trace an operator opened the page to read must still render.
    expect(steps).toHaveLength(1);
    expect(steps[0].allowedToolCalls).toEqual([]);
    expect(steps[0].blockedToolCalls).toEqual(['bash']);
  });
});

describe('AgentRegistryService.createInstance tenant isolation', () => {
  it('refuses to deploy another tenant’s private definition and writes no row', async () => {
    const def = await service.createDefinition('tenant-A', {
      name: 'tenant-a-secret',
      visibility: 'private',
    });

    // Tenant B knows the UUID — that must not be enough to deploy it.
    const attempt = await service.createInstance('tenant-B', {
      agentDefinitionId: def.id,
      configOverride: {},
    });

    expect(attempt).toBeNull();
    const rows = getDb()
      .prepare('SELECT id, tenant_id FROM agent_instances WHERE agent_definition_id = ?')
      .all(def.id) as Array<{ id: string; tenant_id: string }>;
    expect(rows).toHaveLength(0);
  });

  it('returns null when the definition does not exist', async () => {
    const attempt = await service.createInstance('tenant-B', {
      agentDefinitionId: crypto.randomUUID(),
      configOverride: {},
    });

    expect(attempt).toBeNull();
  });

  it('still deploys for the owning tenant', async () => {
    const def = await service.createDefinition('tenant-A', {
      name: 'tenant-a-own',
      visibility: 'private',
    });

    const instance = await service.createInstance('tenant-A', {
      agentDefinitionId: def.id,
      configOverride: {},
    });

    expect(instance).not.toBeNull();
    expect(instance!.tenantId).toBe('tenant-A');
    expect(instance!.agentDefinitionId).toBe(def.id);
  });
});

describe('AgentRegistryService.installFromMarketplace', () => {
  /** Publisher-side fixture: definition + published listing under `tenantId`. */
  async function publishAgent(tenantId: string, name: string) {
    const source = await service.createDefinition(tenantId, {
      name,
      description: `${name} description`,
      systemPrompt: `DISTINCTIVE_PROMPT_${name}`,
      personality: 'cheerful',
      preferredModel: 'gpt-4.1',
      modelTier: 'premium',
      allowedTools: ['web_search', 'calculator'],
      customTools: [{ name: `tool_${name}`, description: `custom tool for ${name}` }],
      tags: ['fixture', name],
      category: 'Engineering',
      icon: 'robot',
      visibility: 'private',
    });
    const listing = await service.createListing(tenantId, {
      agentDefinitionId: source.id,
      title: `${name} listing`,
      description: 'listed by publisher',
      category: 'Engineering',
      tags: ['fixture'],
    });
    if (!listing) throw new Error('createListing returned null');
    const published = await service.publishListing(listing.id, tenantId);
    if (!published) throw new Error('publishListing returned null');
    return { source, listing: published };
  }

  it('cross-tenant install succeeds and the instance belongs to the installer', async () => {
    const { source, listing } = await publishAgent('tenant-A', 'pub-agent');

    const result = await service.installFromMarketplace(listing.id, 'tenant-B');

    expect(result).not.toBeNull();
    expect(result!.instance.tenantId).toBe('tenant-B');
    // The strict createInstance check forbids pointing at the publisher's row.
    expect(result!.instance.agentDefinitionId).not.toBe(source.id);
  });

  it('copies the definition into tenant B preserving safe functional fields', async () => {
    const { source, listing } = await publishAgent('tenant-A', 'pub-copy');

    const result = await service.installFromMarketplace(listing.id, 'tenant-B');
    expect(result).not.toBeNull();

    const copied = await service.getDefinition(result!.instance.agentDefinitionId);
    expect(copied).not.toBeNull();
    expect(copied!.tenantId).toBe('tenant-B');
    expect(copied!.id).not.toBe(source.id);

    // Functional fields survive the copy.
    expect(copied!.name).toBe(source.name);
    expect(copied!.description).toBe(source.description);
    expect(copied!.systemPrompt).toBe(`DISTINCTIVE_PROMPT_pub-copy`);
    expect(copied!.personality).toBe('cheerful');
    expect(copied!.preferredModel).toBe('gpt-4.1');
    expect(copied!.modelTier).toBe('premium');
    expect(copied!.allowedTools).toEqual(['web_search', 'calculator']);
    expect(copied!.customTools).toEqual([{ name: 'tool_pub-copy', description: 'custom tool for pub-copy' }]);
    expect(copied!.tags).toEqual(['fixture', 'pub-copy']);
    expect(copied!.category).toBe('Engineering');
    expect(copied!.icon).toBe('robot');

    // The copy must never inherit the publisher's visibility (publishListing
    // flips the source to 'public'); the installer owns a private definition.
    const sourceAfter = await service.getDefinition(source.id);
    expect(sourceAfter!.visibility).toBe('public');
    expect(copied!.visibility).toBe('private');
  });

  it('leaves the publisher definition unchanged after a cross-tenant install', async () => {
    const { source, listing } = await publishAgent('tenant-A', 'pub-source');

    await service.installFromMarketplace(listing.id, 'tenant-B');

    const after = await service.getDefinition(source.id);
    expect(after).not.toBeNull();
    expect(after!.tenantId).toBe('tenant-A');
    expect(after!.name).toBe('pub-source');
    expect(after!.systemPrompt).toBe('DISTINCTIVE_PROMPT_pub-source');
    expect(after!.visibility).toBe('public'); // publishListing set it; install must not alter it
    // No extra instance rows point at the source definition from tenant B.
    const rows = getDb()
      .prepare("SELECT id FROM agent_instances WHERE agent_definition_id = ? AND tenant_id = 'tenant-B'")
      .all(source.id) as Array<{ id: string }>;
    expect(rows).toHaveLength(0);
  });

  it('is idempotent for a duplicate cross-tenant install', async () => {
    const { listing } = await publishAgent('tenant-A', 'pub-dupe');

    const first = await service.installFromMarketplace(listing.id, 'tenant-B');
    const second = await service.installFromMarketplace(listing.id, 'tenant-B');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.instance.id).toBe(first!.instance.id);

    const installs = getDb()
      .prepare('SELECT id FROM agent_installs WHERE listing_id = ? AND tenant_id = ?')
      .all(listing.id, 'tenant-B') as Array<{ id: string }>;
    expect(installs).toHaveLength(1);
  });

  it('reuses the source definition for a same-tenant install', async () => {
    const { source, listing } = await publishAgent('tenant-A', 'pub-same');

    const result = await service.installFromMarketplace(listing.id, 'tenant-A');

    expect(result).not.toBeNull();
    expect(result!.instance.tenantId).toBe('tenant-A');
    expect(result!.instance.agentDefinitionId).toBe(source.id);
  });

  it('returns null when the source definition is missing', async () => {
    const { source, listing } = await publishAgent('tenant-A', 'pub-gone');
    getDb().prepare('DELETE FROM agent_definitions WHERE id = ?').run(source.id);

    const result = await service.installFromMarketplace(listing.id, 'tenant-B');

    expect(result).toBeNull();
  });

  it('assigns a deterministic suffix when the installer already owns the name (case-insensitive)', async () => {
    const { listing } = await publishAgent('tenant-A', 'collide-name');
    // Installer already owns a definition with the same name in different case.
    await service.createDefinition('tenant-B', {
      name: 'Collide-Name',
      visibility: 'private',
    });

    const result = await service.installFromMarketplace(listing.id, 'tenant-B');

    expect(result).not.toBeNull();
    const copied = await service.getDefinition(result!.instance.agentDefinitionId);
    expect(copied).not.toBeNull();
    expect(copied!.tenantId).toBe('tenant-B');
    // Must not collide (case-insensitive) and must be deterministic suffix.
    expect(copied!.name.toLowerCase()).not.toBe('collide-name');
    expect(copied!.name).toMatch(/ \(2\)$/);
  });

  it('gives distinct suffixed names when two listings share the same source name', async () => {
    const first = await publishAgent('tenant-A', 'shared-name');
    const second = await publishAgent('tenant-A', 'shared-name');

    const r1 = await service.installFromMarketplace(first.listing.id, 'tenant-B');
    const r2 = await service.installFromMarketplace(second.listing.id, 'tenant-B');

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    const d1 = await service.getDefinition(r1!.instance.agentDefinitionId);
    const d2 = await service.getDefinition(r2!.instance.agentDefinitionId);
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    expect(d1!.id).not.toBe(d2!.id);
    // First keeps the base name, second gets a deterministic suffix; never equal case-insensitively.
    expect(d1!.name).toBe('shared-name');
    expect(d2!.name.toLowerCase()).not.toBe(d1!.name.toLowerCase());
    expect(d2!.name).toMatch(/ \(2\)$/);
  });

  it('rolls back definition and instance copies when the install INSERT fails', async () => {
    const { listing } = await publishAgent('tenant-A', 'rollback-agent');
    const db = getDb();
    const defsBefore = (db.prepare('SELECT COUNT(*) AS c FROM agent_definitions').get() as any).c as number;
    const instBefore = (db.prepare('SELECT COUNT(*) AS c FROM agent_instances').get() as any).c as number;

    // DB-level fault injection: applies to every connection/wrapper, so it
    // survives fresh getDb() calls inside the service. The transaction must
    // roll back the definition + instance copies when this fires.
    db.prepare(
      `CREATE TEMP TRIGGER fail_install BEFORE INSERT ON agent_installs BEGIN SELECT RAISE(ABORT, 'injected install INSERT failure'); END;`
    ).run();
    try {
      await expect(service.installFromMarketplace(listing.id, 'tenant-B')).rejects.toThrow(
        'injected install INSERT failure'
      );
    } finally {
      db.prepare('DROP TRIGGER IF EXISTS fail_install').run();
    }

    const defsAfter = (db.prepare('SELECT COUNT(*) AS c FROM agent_definitions').get() as any).c as number;
    const instAfter = (db.prepare('SELECT COUNT(*) AS c FROM agent_instances').get() as any).c as number;
    expect(defsAfter).toBe(defsBefore);
    expect(instAfter).toBe(instBefore);
    const installs = db
      .prepare('SELECT id FROM agent_installs WHERE listing_id = ? AND tenant_id = ?')
      .all(listing.id, 'tenant-B') as Array<{ id: string }>;
    expect(installs).toHaveLength(0);
  });

  it('is idempotent under concurrent Promise.all for the same listing', async () => {
    const { listing } = await publishAgent('tenant-A', 'concurrent-agent');

    const [a, b] = await Promise.all([
      service.installFromMarketplace(listing.id, 'tenant-B'),
      service.installFromMarketplace(listing.id, 'tenant-B'),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.instance.id).toBe(b!.instance.id);

    const db = getDb();
    const installs = db
      .prepare('SELECT id, agent_instance_id FROM agent_installs WHERE listing_id = ? AND tenant_id = ?')
      .all(listing.id, 'tenant-B') as Array<{ id: string; agent_instance_id: string }>;
    expect(installs).toHaveLength(1);
    expect(installs[0].agent_instance_id).toBe(a!.instance.id);
  });
});
