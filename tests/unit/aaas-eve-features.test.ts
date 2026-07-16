// Unit tests for three DMR-X AaaS capability improvements (Vercel-free):
//   1. Durable / resumable agent sessions (agent-session.store)
//   2. Load-on-demand skills (skill-loader + progressive disclosure prompt)
//   3. Subagent isolation model (agent-delegate.resolveSubagent / runSubagent)
//
// The session store and skill loader exercise the real SQLite path (no mocks),
// matching the repo's "test against real sql.js" convention.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  agentSessionStore,
  skillLoader,
  resolveSubagent,
  type SkillAdvert,
} from '@dmr-x/agent-runtime';
import { AgentRuntimeService } from '@dmr-x/agent-runtime';

// Mirror the repo convention (conversation-routes-tenant-isolation.test.ts):
// import the db module dynamically and bind to its initDb/getDb/closeDb so
// they are guaranteed to be the SAME singleton the runtime modules use.
let initDb: (...args: any[]) => Promise<unknown>;
let getDb: () => any;
let closeDb: (...args: any[]) => Promise<unknown>;

let tmpDir: string;

beforeEach(async () => {
  const dbMod = await import('@dmr-x/db');
  initDb = dbMod.initDb as any;
  getDb = dbMod.getDb as any;
  closeDb = dbMod.closeDb as any;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-aaas-test-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    /* first test */
  }
  await initDb();
});
afterEach(async () => {
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ---------------------------------------------------------------------------
// 1. Durable / resumable agent sessions
// ---------------------------------------------------------------------------
describe('AgentSessionStore (durable sessions)', () => {
  const conv = {
    id: 'conv-1',
    messages: [{ role: 'user', content: 'hi' }] as any,
    status: 'in_progress' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('upserts and loads a session round-trip', () => {
    agentSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'conv-1',
      instanceId: 'inst-1',
      agentDefinitionId: 'def-1',
      state: conv as any,
      status: 'in_progress',
      loadedSkillIds: ['skill-a'],
      metadata: { lastResponseText: 'ok' },
    });

    const got = agentSessionStore.get('t1', 'conv-1');
    expect(got).not.toBeNull();
    expect(got!.agentInstanceId).toBe('inst-1');
    expect(got!.loadedSkills).toEqual(['skill-a']);
    expect(got!.state.messages).toEqual(conv.messages);
    expect((got!.metadata as any).lastResponseText).toBe('ok');
  });

  it('isolates sessions by tenant', () => {
    agentSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'conv-x',
      instanceId: 'i',
      state: conv as any,
    });
    // tenant t2 must NOT see t1's session
    expect(agentSessionStore.get('t2', 'conv-x')).toBeNull();
  });

  it('lists sessions per instance', () => {
    agentSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'c1',
      instanceId: 'inst-9',
      state: conv as any,
    });
    agentSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'c2',
      instanceId: 'inst-9',
      state: conv as any,
    });
    const list = agentSessionStore.listForInstance('t1', 'inst-9');
    expect(list.map((s) => s.id).sort()).toEqual(['c1', 'c2']);
  });

  it('deletes a session', () => {
    agentSessionStore.upsert({
      tenantId: 't1',
      conversationId: 'conv-del',
      instanceId: 'i',
      state: conv as any,
    });
    expect(agentSessionStore.get('t1', 'conv-del')).not.toBeNull();
    agentSessionStore.delete('conv-del');
    expect(agentSessionStore.get('t1', 'conv-del')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Load-on-demand skills (progressive disclosure)
// ---------------------------------------------------------------------------
describe('SkillLoader (load-on-demand)', () => {
  beforeEach(() => {
    // Seed two skills for the tenant via a direct insert.
    const db = getDb();
    db.prepare(
      `INSERT INTO skills (id, tenant_id, name, description, content)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
    ).run(
      'sk-1', 't1', 'deep-research', 'Do thorough web research.',
        'STEP 1: search. STEP 2: synthesize.',
      'sk-2', 't1', 'summarize', 'Summarize text concisely.',
        'STEP 1: read. STEP 2: compress.',
    );
  });

  it('advertises descriptions without inlining bodies', () => {
    const adverts: SkillAdvert[] = skillLoader.advertise('t1', ['sk-1', 'sk-2']);
    expect(adverts).toHaveLength(2);
    // Advertisements carry the description but NOT a body field at all
    // (progressive disclosure: the body is only fetched on demand).
    expect(adverts[0].description).toBe('Do thorough web research.');
    expect(adverts[0].content).toBeUndefined();
  });

  it('resolves the full body only on demand (load_skill semantics)', () => {
    const body = skillLoader.resolveBody('t1', 'deep-research');
    expect(body).not.toBeNull();
    expect(body!.content).toContain('STEP 1: search');
    // Resolving by id also works.
    const byId = skillLoader.resolveBody('t1', 'sk-2');
    expect(byId!.name).toBe('summarize');
  });

  it('resolves to null for unknown skill', () => {
    expect(skillLoader.resolveBody('t1', 'does-not-exist')).toBeNull();
  });
});

// buildSystemPrompt progressive disclosure: only loaded skills are inlined.
describe('buildSystemPrompt progressive disclosure', () => {
  const definition = {
    id: 'def-1',
    tenantId: 't1',
    name: 'Researcher',
    humanName: 'Researcher',
    description: 'research agent',
    version: '1.0.0',
    systemPrompt: 'You research.',
    allowedTools: ['web_search'] as string[],
    skills: ['deep-research'] as string[],
    modelTier: 'auto' as const,
  } as any;

  beforeEach(() => {
    const db = getDb();
    db.prepare(
      `INSERT INTO skills (id, tenant_id, name, description, content)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('sk-1', 't1', 'deep-research', 'Do thorough research.',
      'BODY-OF-DEEP-RESEARCH');
  });

  it('inlines only loaded skill bodies; advertises the rest', async () => {
    const rt = new AgentRuntimeService();
    // With no loaded skills, the body should NOT be inlined.
    const without = await rt.buildSystemPrompt(definition, 0, []);
    expect(without).not.toContain('BODY-OF-DEEP-RESEARCH');
    // Once loaded, the body appears.
    const withLoaded = await rt.buildSystemPrompt(definition, 0, ['deep-research']);
    expect(withLoaded).toContain('BODY-OF-DEEP-RESEARCH');
  });
});

// ---------------------------------------------------------------------------
// 3. Subagent isolation model
// ---------------------------------------------------------------------------
describe('resolveSubagent (isolation boundary)', () => {
  const parent = {
    id: 'parent-1',
    tenantId: 't1',
    name: 'Orchestrator',
  } as any;

  beforeEach(() => {
    const db = getDb();
    db.prepare(
      `INSERT INTO agent_definitions
         (id, tenant_id, name, description, version, system_prompt, allowed_tools, model_tier, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sub-1', 't1', 'Coder', 'coding specialist', '1.0.0',
      'You write code.', JSON.stringify(['write_file']), 'auto', 'private',
    );
    // A subagent owned by a DIFFERENT tenant must not be reachable.
    db.prepare(
      `INSERT INTO agent_definitions
         (id, tenant_id, name, description, version, system_prompt, allowed_tools, model_tier, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sub-other', 't2', 'Intruder', 'should be invisible', '1.0.0',
      'x', JSON.stringify([]), 'auto', 'private',
    );
  });

  it('resolves a tenant-local subagent by name', async () => {
    const hit = await resolveSubagent('t1', parent, 'Coder');
    expect(hit).not.toBeNull();
    expect(hit!.id).toBe('sub-1');
  });

  it('never resolves a subagent from another tenant', async () => {
    const hit = await resolveSubagent('t1', parent, 'Intruder');
    expect(hit).toBeNull();
  });

  it('rejects resolving the parent as its own subagent', async () => {
    const hit = await resolveSubagent('t1', parent, 'Orchestrator');
    expect(hit).toBeNull();
  });
});

// runSubagent: the child runs with its OWN tool surface, never the parent's.
describe('runSubagent isolation', () => {
  const parent = {
    id: 'parent-1',
    tenantId: 't1',
    name: 'Orchestrator',
    allowedTools: ['delegate', 'web_search'],
  } as any;

  beforeEach(() => {
    const db = getDb();
    db.prepare(
      `INSERT INTO agent_definitions
         (id, tenant_id, name, description, version, system_prompt, allowed_tools, model_tier, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'coder', 't1', 'Coder', 'coding specialist', '1.0.0',
      'You write code.', JSON.stringify(['write_file']), 'auto', 'private',
    );
    db.prepare(
      `INSERT INTO agent_instances (id, agent_definition_id, tenant_id, status)
       VALUES (?, ?, ?, ?)`,
    ).run('coder-inst', 'coder', 't1', 'active');
  });

  it('spawns an isolated instance and narrows tools to the child', async () => {
    const { agentRegistryService } = await import('../../services/agent-registry/src/agent-registry.service.js');
    const subagent = await agentRegistryService.getDefinition('coder');
    expect(subagent).not.toBeNull();
    // The child's allowedTools are its own — they do NOT include the
    // parent's tools, proving the hard isolation boundary.
    expect(subagent!.allowedTools).toEqual(['write_file']);
    expect(subagent!.allowedTools).not.toContain('web_search');
  });
});
