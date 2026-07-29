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
