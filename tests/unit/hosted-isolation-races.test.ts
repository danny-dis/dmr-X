import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, closeDb, getDb } from '@dmr-x/db';
import { agentRegistryService as registry } from '@dmr-x/agent-registry';
import { AgenticSessionStore } from '../../services/agent-runtime/src/agentic-session.store.js';
import { AgentRuntimeService } from '../../services/agent-runtime/src/agent-runtime.js';
import { AgentScheduler } from '../../services/agent-runtime/src/agent-scheduler.js';
let tmp: string;
const runtime = new AgentRuntimeService();
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dmrx-hosted-isolation-'));
  process.env.DMRX_DATA_DIR = tmp;
  await closeDb().catch(() => {});
  await initDb();
  for (const id of ['owner-a', 'owner-b']) getDb().prepare('INSERT OR IGNORE INTO tenants (id,name) VALUES (?,?)').run(id,id);
});
afterEach(async () => { await closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });
describe('hosted ownership and lifecycle race regressions', () => {
  it('does not resurrect a retired instance during concurrent transitions', async () => {
    const definition = await registry.createDefinition('owner-a', { name: 'race-agent' });
    const instance = await registry.createInstance('owner-a', { agentDefinitionId: definition.id });
    await Promise.allSettled([
      registry.transitionInstanceLifecycle(instance!.id, 'owner-a', 'retired'),
      registry.transitionInstanceLifecycle(instance!.id, 'owner-a', 'running'),
    ]);
    expect((await registry.getInstance(instance!.id))?.lifecycleState).toBe('retired');
  });
  it('restores finite defaults when converting a persistent instance to ephemeral', async () => {
    const definition = await registry.createDefinition('owner-a', { name: 'mode-agent' });
    const instance = await registry.createInstance('owner-a', { agentDefinitionId: definition.id });
    const converted = await registry.updateInstanceRuntime(instance!.id, 'owner-a', { runtimeMode: 'ephemeral' });
    expect(converted!.lifecyclePolicy.maxTtlMs).toBeGreaterThan(0);
    expect(converted!.lifecyclePolicy.idleTimeoutMs).toBeGreaterThan(0);
    expect(converted!.lifecyclePolicy.maxBudgetCents).toBeGreaterThan(0);
  });
  it('wakes legacy paused rows whose lifecycle state defaulted to ready', async () => {
    const definition = await registry.createDefinition('owner-a', { name: 'legacy-agent' });
    const instance = await registry.createInstance('owner-a', { agentDefinitionId: definition.id });
    getDb().prepare("UPDATE agent_instances SET status = 'paused', lifecycle_state = 'ready' WHERE id = ?").run(instance!.id);
    expect((await runtime.wakeInstance(instance!.id, 'owner-a'))?.status).toBe('active');
    expect(await runtime.loadContext(instance!.id, 'owner-a')).not.toBeNull();
  });
  it('rejects an ephemeral instance with no remaining budget', async () => {
    const definition = await registry.createDefinition('owner-a', { name: 'budget-agent' });
    const instance = await registry.createInstance('owner-a', { agentDefinitionId: definition.id, runtimeMode: 'ephemeral', lifecyclePolicy: { maxBudgetCents: 0 } });
    expect(await runtime.loadContext(instance!.id, 'owner-a')).toBeNull();
  });
  it('run sharing never advertises unrelated owner-private skills', async () => {
    const definition = await registry.createDefinition('owner-a', { name: 'share-agent' });
    getDb().prepare('INSERT INTO skills (id, tenant_id, name, description, content, source) VALUES (?, ?, ?, ?, ?, ?)')
      .run('private-skill', 'owner-a', 'private-skill', 'OWNER-PRIVATE-DESCRIPTION', 'private body', 'manual');
    await registry.shareDefinition(definition.id, 'owner-a', 'owner-b', 'run');
    const instance = await registry.createInstance('owner-b', { agentDefinitionId: definition.id });
    const context = await runtime.loadContext(instance!.id, 'owner-b');
    const prompt = await runtime.buildSystemPrompt(context!.definition, 0, [], context!.tenantId);
    expect(prompt).not.toContain('OWNER-PRIVATE-DESCRIPTION');
  });
  it('refreshes scheduler identity and occurrence after another scheduler wins the claim', async () => {
    const definition = await registry.createDefinition('owner-a', { name: 'schedule-agent' });
    const instance = await registry.createInstance('owner-a', { agentDefinitionId: definition.id });
    const scheduler = new AgentScheduler();
    scheduler.registerJob(definition.id, 'owner-a', '* * * * *');
    const job = (scheduler as any).jobs.get(scheduler.getJobs()[0].id);
    const next = new Date(Date.now() + 180000).toISOString();
    getDb().prepare('UPDATE agent_scheduled_jobs SET next_run_at = ?, agent_instance_id = ?, last_occurrence_key = ? WHERE id = ?')
      .run(next, instance!.id, 'peer-occurrence', job.id);
    await (scheduler as any).executeJob(job);
    expect(job.nextRunAt.toISOString()).toBe(next);
    expect(job.agentInstanceId).toBe(instance!.id);
    expect(job.lastOccurrenceKey).toBe('peer-occurrence');
    scheduler.stop();
  });
  it('never transfers an existing conversation to another tenant', () => {
    const store = new AgenticSessionStore();
    store.upsert({ tenantId: 'owner-a', conversationId: 'known-id', state: { id: 'known-id', messages: [], status: 'in_progress' } as any });
    try { store.upsert({ tenantId: 'owner-b', conversationId: 'known-id', state: { id: 'known-id', messages: [], status: 'completed' } as any }); } catch { /* rejection is allowed */ }
    expect(store.get('owner-a', 'known-id')?.status).toBe('in_progress');
    expect(store.get('owner-b', 'known-id')).toBeNull();
  });
});
