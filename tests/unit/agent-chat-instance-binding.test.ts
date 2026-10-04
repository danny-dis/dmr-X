import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  persisted: null as any,
  loadContext: vi.fn(),
  runAgentChatLoop: vi.fn(),
  upsert: vi.fn(),
  persistRunSteps: vi.fn(),
}));

vi.mock('@dmr-x/agent-runtime', () => ({
  agentRuntimeService: {
    loadContext: (...args: unknown[]) => mocks.loadContext(...args),
    markInstanceReady: vi.fn().mockResolvedValue(undefined),
    resolveModel: () => 'fixture/test-model',
    buildSystemPrompt: vi.fn().mockResolvedValue('system prompt'),
    createExecution: vi.fn().mockResolvedValue({ id: 'execution-1' }),
    evaluateExecution: vi.fn().mockResolvedValue(undefined),
    recordExecution: vi.fn().mockResolvedValue(undefined),
  },
  agentSessionStore: {
    locks: new Map<string, Promise<void>>(),
    get: vi.fn(() => mocks.persisted),
    claim: vi.fn((input: any) => {
      const p = mocks.persisted;
      if (!p) {
        return {
          outcome: 'claimed',
          owner: {
            tenantId: input.tenantId,
            agentInstanceId: input.instanceId,
            agentDefinitionId: input.agentDefinitionId,
          },
        };
      }
      const owner = {
        tenantId: p.tenantId,
        agentInstanceId: p.agentInstanceId,
        agentDefinitionId: p.agentDefinitionId,
      };
      const same =
        owner.tenantId === input.tenantId &&
        owner.agentInstanceId === input.instanceId &&
        (owner.agentDefinitionId == null || owner.agentDefinitionId === input.agentDefinitionId);
      return { outcome: same ? 'owned' : 'conflict', owner };
    }),
    upsert: (...args: unknown[]) => mocks.upsert(...args),
    persistRunSteps: (...args: unknown[]) => mocks.persistRunSteps(...args),
    listForInstance: vi.fn(() => []),
    delete: vi.fn(),
  },
  analyzeTranscript: vi.fn(),
}));

vi.mock('@dmr-x/agent-registry', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    agentRegistryService: {
      listExecutions: vi.fn().mockResolvedValue([]),
      getExecutionStats: vi.fn().mockResolvedValue({}),
    },
  };
});

// This fixture exercises transcript binding, with explicit known-free pricing.
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

import { agentChatRoutes } from '../../apps/gateway/src/routes/agent-chat.routes.js';

const TENANT_ID = 'tenant-1';
const INSTANCE_ID = 'instance-1';
const DEFINITION_ID = 'definition-1';
const CONVERSATION_ID = 'conversation-1';

function context() {
  return {
    instanceId: INSTANCE_ID,
    tenantId: TENANT_ID,
    requestId: 'request-1',
    instance: { id: INSTANCE_ID, agentDefinitionId: DEFINITION_ID, configOverride: {} },
    definition: {
      id: DEFINITION_ID,
      tenantId: TENANT_ID,
      name: 'Agent One',
      allowedTools: [],
    },
  };
}

function persistedSession(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    tenantId: TENANT_ID,
    agentInstanceId: INSTANCE_ID,
    agentDefinitionId: DEFINITION_ID,
    state: {
      id: CONVERSATION_ID,
      messages: [{ role: 'system', content: 'original system prompt' }],
      status: 'interrupted',
      createdAt: 1,
      updatedAt: 1,
    },
    status: 'interrupted',
    lastTurn: 0,
    loadedSkills: [],
    metadata: { loadedSkillIds: '[]' },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  (app as any).router = {};
  app.addHook('preHandler', async (request) => {
    (request as any).tenant = { id: TENANT_ID, name: 'Tenant One' };
  });
  await app.register(agentChatRoutes, { prefix: '/v1' });
  await app.ready();
  return app;
}

function successfulLoopResult() {
  return {
    awaitingApproval: false,
    budgetExceeded: false,
    lastResponseText: 'resumed',
    totalTokensUsed: 1,
    totalCost: 0,
    allSteps: [],
    finalUsage: { total_tokens: 1 },
    stepsCompleted: 1,
  };
}

describe('agent chat durable-session instance binding', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.loadContext.mockResolvedValue(context());
    mocks.runAgentChatLoop.mockResolvedValue(successfulLoopResult());
    mocks.persisted = persistedSession();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    { stream: false, label: 'non-streaming' },
    { stream: true, label: 'streaming' },
  ])('returns 404 before $label chat can use another instance transcript', async ({ stream }) => {
    mocks.persisted = persistedSession({ agentInstanceId: 'instance-2' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_ID}/chat`,
      payload: {
        messages: [{ role: 'user', content: 'continue' }],
        conversationId: CONVERSATION_ID,
        stream,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { message: 'Conversation not found' } });
    expect(mocks.runAgentChatLoop).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('returns 404 before chat can use a transcript from another definition', async () => {
    mocks.persisted = persistedSession({ agentDefinitionId: 'definition-2' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_ID}/chat`,
      payload: {
        messages: [{ role: 'user', content: 'continue' }],
        conversationId: CONVERSATION_ID,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { message: 'Conversation not found' } });
    expect(mocks.runAgentChatLoop).not.toHaveBeenCalled();
  });

  it.each([
    { mismatch: { agentInstanceId: 'instance-2' }, label: 'instance' },
    { mismatch: { agentDefinitionId: 'definition-2' }, label: 'definition' },
  ])('returns the same 404 as an absent session for a resume $label mismatch', async ({ mismatch }) => {
    mocks.persisted = persistedSession(mismatch);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_ID}/chat/${CONVERSATION_ID}/resume`,
      payload: { messages: [{ role: 'user', content: 'resume' }] },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { message: 'No durable session to resume' } });
    expect(mocks.runAgentChatLoop).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('keeps a same-instance, same-definition resume valid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_ID}/chat/${CONVERSATION_ID}/resume`,
      payload: { messages: [{ role: 'user', content: 'resume' }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      agentInstanceId: INSTANCE_ID,
      conversationId: CONVERSATION_ID,
      resumed: true,
      content: 'resumed',
    });
    expect(mocks.runAgentChatLoop).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalled();
  });
});
