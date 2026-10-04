/**
 * Hosted session-collision review regressions (free-session-ownership).
 *
 * 1. Cross-tenant conversationId steal (agent_sessions, NOT agentic_sessions):
 *    tenant B POST /agents/:instanceId/chat with conversationId owned by
 *    tenant A must NOT reassign the durable row's tenant_id/instance_id via
 *    AgentSessionStore.upsert's ON CONFLICT. Same-tenant different-instance
 *    must not overwrite either. Scoped own-tenant same-instance resumes keep
 *    working. Rejection is a uniform 404 (no enumeration) BEFORE
 *    provider/loop/admission, with the DB WHERE-guard as race defense.
 * 2. Scheduler timezone: triggerConfig.timezone must feed the cron parser.
 *    `0 9 * * *` in UTC vs Africa/Nairobi must NOT both fire at the same
 *    UTC instant; Nairobi 09:00 wall = 06:00Z.
 *
 * Store section drives the ACTUAL SQLite store (real initDb in a temp dir).
 * Route section drives the REAL Fastify route with the REAL store singleton
 * (only runtime/loop/admission/billing are mocked) so the collision seam is
 * exercised end-to-end. Timezone section uses fixed-clock registerJob.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  runAgentChatLoop: vi.fn(),
  preflightModelRun: vi.fn(),
  settleAgentRun: vi.fn(),
  releaseAgentHold: vi.fn(),
}));

// Keep the REAL agentSessionStore singleton + REAL AgentScheduler class;
// only the runtime service (context/prompt/execution) is stubbed.
vi.mock('@dmr-x/agent-runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    agentRuntimeService: {
      loadContext: (...args: unknown[]) => mocks.loadContext(...args),
      markInstanceReady: vi.fn().mockResolvedValue(undefined),
      resolveModel: () => 'fixture/test-model',
      buildSystemPrompt: vi.fn().mockResolvedValue('system prompt'),
      createExecution: vi.fn().mockResolvedValue({ id: 'execution-1' }),
      evaluateExecution: vi.fn().mockResolvedValue(undefined),
      recordExecution: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('@dmr-x/agent-registry', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    agentRegistryService: {
      ...(actual as any).agentRegistryService,
      listExecutions: vi.fn().mockResolvedValue([]),
      getExecutionStats: vi.fn().mockResolvedValue({}),
    },
  };
});

vi.mock('@dmr-x/billing', () => ({
  billingService: {
    getModelPricing: vi.fn().mockResolvedValue({
      providerId: 'fixture', modelId: 'test-model',
      inputPricePer1kTokens: 0, outputPricePer1kTokens: 0,
    }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../apps/gateway/src/routes/tools.routes.js', () => ({
  getRegisteredToolDefinitions: vi.fn(() => []),
  normalizeAllowedTools: vi.fn(() => []),
  cleanupSandboxDir: vi.fn(),
}));

vi.mock('../../apps/gateway/src/routes/agent-chat-loop.js', () => ({
  runAgentChatLoop: (...args: unknown[]) => mocks.runAgentChatLoop(...args),
}));

vi.mock('../../apps/gateway/src/lib/agent-admission.js', () => ({
  resolveAgentModel: vi.fn(() => ({ model: 'fixture/test-model' })),
  clampAgentSteps: vi.fn((v: unknown) => (typeof v === 'number' ? v : 5)),
  clampAgentTokens: vi.fn((v: unknown) => (typeof v === 'number' ? v : 100)),
  estimateAgentRunTokens: vi.fn(() => 10),
  aliasFreeEvidence: vi.fn(() => ({})),
  resolveAgentToolCatalog: vi.fn(() => ({ defs: [], resolved: [], missing: [], requiredMissing: [] })),
  preflightModelRun: (...args: unknown[]) => mocks.preflightModelRun(...args),
  releaseAgentHold: (...args: unknown[]) => mocks.releaseAgentHold(...args),
  settleAgentRun: (...args: unknown[]) => mocks.settleAgentRun(...args),
}));

import { initDb, closeDb, getDb } from '../../packages/db/src/client.js';
import { agentSessionStore } from '../../services/agent-runtime/src/agent-session.store.js';
import { AgentScheduler } from '../../services/agent-runtime/src/agent-scheduler.js';
import { agentChatRoutes } from '../../apps/gateway/src/routes/agent-chat.routes.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const INSTANCE_A = 'instance-a';
const INSTANCE_B = 'instance-b';
const DEFINITION_A = 'definition-a';
const CONV_ID = 'collision-conv-1';

let tmpDir: string;

function stateWith(text: string, id = CONV_ID): any {
  return {
    id,
    messages: [{ role: 'system', content: text }],
    status: 'in_progress',
    createdAt: 1,
    updatedAt: 1,
  };
}

function contextFor(tenantId: string, instanceId = INSTANCE_A) {
  return {
    instanceId,
    tenantId,
    requestId: 'request-1',
    instance: { id: instanceId, agentDefinitionId: DEFINITION_A, configOverride: {} },
    definition: {
      id: DEFINITION_A,
      tenantId,
      name: 'Agent A',
      allowedTools: [],
    },
  };
}

function successfulLoopResult() {
  return {
    awaitingApproval: false,
    budgetExceeded: false,
    lastResponseText: 'hello',
    totalTokensUsed: 1,
    totalPromptTokens: 1,
    totalCompletionTokens: 0,
    totalCost: 0,
    allSteps: [],
    finalUsage: { total_tokens: 1 },
    stepsCompleted: 1,
  };
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmrx-session-collision-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    // first run
  }
  await initDb();
  vi.clearAllMocks();
  mocks.runAgentChatLoop.mockResolvedValue(successfulLoopResult());
  mocks.preflightModelRun.mockResolvedValue({ admitted: true, holdId: 'hold-1' });
  mocks.settleAgentRun.mockResolvedValue({
    promptTokens: 1, completionTokens: 0, totalTokens: 1, cost: 0,
  });
  mocks.releaseAgentHold.mockResolvedValue(undefined);
  mocks.loadContext.mockImplementation(async (instanceId: string, tenantId: string) =>
    contextFor(tenantId, instanceId),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
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

describe('hosted agent-session collision: actual SQLite store', () => {
  it('a foreign-tenant upsert does not steal the durable owner', () => {
    agentSessionStore.upsert({
      tenantId: TENANT_A,
      conversationId: CONV_ID,
      instanceId: INSTANCE_A,
      agentDefinitionId: DEFINITION_A,
      state: stateWith('tenant-a original'),
    });

    // Tenant B claims the same conversationId (the steal vector).
    try {
      agentSessionStore.upsert({
        tenantId: TENANT_B,
        conversationId: CONV_ID,
        instanceId: INSTANCE_B,
        agentDefinitionId: DEFINITION_A,
        state: stateWith('tenant-b intruder'),
      });
    } catch {
      // Rejection is allowed; the invariant is the row is unchanged.
    }

    const ownerRow = agentSessionStore.get(TENANT_A, CONV_ID);
    expect(ownerRow).not.toBeNull();
    expect(ownerRow!.tenantId).toBe(TENANT_A);
    expect(ownerRow!.agentInstanceId).toBe(INSTANCE_A);
    expect(JSON.stringify(ownerRow!.state)).toContain('tenant-a original');
    // Foreign tenant still sees nothing (no enumeration oracle).
    expect(agentSessionStore.get(TENANT_B, CONV_ID)).toBeNull();
    const raw = getDb().prepare('SELECT tenant_id, agent_instance_id FROM agent_sessions WHERE id = ?').get(CONV_ID) as any;
    expect(raw.tenant_id).toBe(TENANT_A);
    expect(raw.agent_instance_id).toBe(INSTANCE_A);
  });

  it('same tenant but a different instance does not overwrite state', () => {
    agentSessionStore.upsert({
      tenantId: TENANT_A,
      conversationId: CONV_ID,
      instanceId: INSTANCE_A,
      agentDefinitionId: DEFINITION_A,
      state: stateWith('instance-a original'),
    });

    try {
      agentSessionStore.upsert({
        tenantId: TENANT_A,
        conversationId: CONV_ID,
        instanceId: INSTANCE_B,
        agentDefinitionId: DEFINITION_A,
        state: stateWith('instance-b intruder'),
      });
    } catch {
      // Rejection is allowed; the invariant is the row is unchanged.
    }

    const ownerRow = agentSessionStore.get(TENANT_A, CONV_ID);
    expect(ownerRow).not.toBeNull();
    expect(ownerRow!.agentInstanceId).toBe(INSTANCE_A);
    expect(JSON.stringify(ownerRow!.state)).toContain('instance-a original');
  });

  it('own-tenant same-instance upsert still resumes (updates state)', () => {
    agentSessionStore.upsert({
      tenantId: TENANT_A,
      conversationId: CONV_ID,
      instanceId: INSTANCE_A,
      agentDefinitionId: DEFINITION_A,
      state: stateWith('turn-1'),
    });
    agentSessionStore.upsert({
      tenantId: TENANT_A,
      conversationId: CONV_ID,
      instanceId: INSTANCE_A,
      agentDefinitionId: DEFINITION_A,
      state: stateWith('turn-2 resumed'),
    });

    const resumed = agentSessionStore.get(TENANT_A, CONV_ID);
    expect(resumed).not.toBeNull();
    expect(JSON.stringify(resumed!.state)).toContain('turn-2 resumed');
  });
});

describe('hosted agent-session collision: route rejects before provider/loop/admission', () => {
  let app: FastifyInstance;
  let currentTenant: { id: string; name: string };

  beforeEach(async () => {
    currentTenant = { id: TENANT_A, name: 'Tenant A' };
    // Seed the durable owner directly through the REAL store.
    agentSessionStore.upsert({
      tenantId: TENANT_A,
      conversationId: CONV_ID,
      instanceId: INSTANCE_A,
      agentDefinitionId: DEFINITION_A,
      state: stateWith('tenant-a durable transcript'),
    });

    app = Fastify({ logger: false });
    (app as any).router = {};
    (app as any).quotaService = {};
    app.addHook('preHandler', async (request) => {
      (request as any).tenant = currentTenant;
    });
    await app.register(agentChatRoutes, { prefix: '/v1' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('tenant B starting chat with tenant A conversationId gets uniform 404 and steals nothing', async () => {
    currentTenant = { id: TENANT_B, name: 'Tenant B' };
    mocks.loadContext.mockImplementation(async (instanceId: string, tenantId: string) =>
      contextFor(tenantId, instanceId),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_B}/chat`,
      payload: {
        messages: [{ role: 'user', content: 'hijack attempt' }],
        conversationId: CONV_ID,
      },
    });

    // Uniform 404 identical to the absent-session shape (no enumeration).
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { message: 'Conversation not found' } });
    // Rejected BEFORE provider/loop/admission side effects.
    expect(mocks.preflightModelRun).not.toHaveBeenCalled();
    expect(mocks.runAgentChatLoop).not.toHaveBeenCalled();
    // Durable owner is untouched.
    const ownerRow = agentSessionStore.get(TENANT_A, CONV_ID);
    expect(ownerRow).not.toBeNull();
    expect(ownerRow!.tenantId).toBe(TENANT_A);
    expect(JSON.stringify(ownerRow!.state)).toContain('tenant-a durable transcript');
    expect(agentSessionStore.get(TENANT_B, CONV_ID)).toBeNull();
  });

  it('same tenant different instance gets the same uniform 404 without running the loop', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_B}/chat`,
      payload: {
        messages: [{ role: 'user', content: 'sibling instance attempt' }],
        conversationId: CONV_ID,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { message: 'Conversation not found' } });
    expect(mocks.runAgentChatLoop).not.toHaveBeenCalled();
    const ownerRow = agentSessionStore.get(TENANT_A, CONV_ID);
    expect(ownerRow!.agentInstanceId).toBe(INSTANCE_A);
  });

  it('own-tenant same-instance chat on the durable id still runs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_A}/chat`,
      payload: {
        messages: [{ role: 'user', content: 'continue' }],
        conversationId: CONV_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.runAgentChatLoop).toHaveBeenCalledOnce();
  });
});

describe('scheduler timezone feeds the cron parser (fixed clock)', () => {
  it('UTC vs Africa/Nairobi 0 9 * * * fire at different UTC instants', () => {
    // Fixed Monday midnight UTC: both zones resolve to the same calendar
    // day, 3h apart in UTC. Nairobi has no DST so the offset is stable.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-05T00:00:00.000Z'));
      const utcScheduler = new AgentScheduler();
      const nairobiScheduler = new AgentScheduler();
      try {
        utcScheduler.registerJob('def-1', 'tenant-1', '0 9 * * *', { timezone: 'UTC' });
        nairobiScheduler.registerJob('def-1', 'tenant-1', '0 9 * * *', { timezone: 'Africa/Nairobi' });
        const utcNext = utcScheduler.getJobs()[0].nextRunAt;
        const nairobiNext = nairobiScheduler.getJobs()[0].nextRunAt;
        // The bug produced identical instants (timezone ignored).
        expect(nairobiNext).not.toBe(utcNext);
        expect(utcNext).toBe('2026-01-05T09:00:00.000Z');
        expect(nairobiNext).toBe('2026-01-05T06:00:00.000Z');
      } finally {
        utcScheduler.stop();
        nairobiScheduler.stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('omitted timezone keeps the UTC default', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-05T00:00:00.000Z'));
      const scheduler = new AgentScheduler();
      try {
        scheduler.registerJob('def-1', 'tenant-1', '0 9 * * *');
        expect(scheduler.getJobs()[0].nextRunAt).toBe('2026-01-05T09:00:00.000Z');
      } finally {
        scheduler.stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
