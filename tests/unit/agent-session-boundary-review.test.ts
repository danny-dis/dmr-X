/**
 * Regression coverage for the hosted session-boundary review defects:
 *
 *  1. DELETE /agents/:instanceId/chat/:conversationId called the GLOBAL
 *     agentSessionStore.delete(conversationId): no tenant scoping, no
 *     instance/definition binding, and it reclaimed the sandbox workspace of a
 *     conversation the caller did not own. It now mirrors the resume seam
 *     (tenant.id-scoped load + instance/definition equality -> 404).
 *  2. parsedResumeBody() dropped body.model, so the resume handler could never
 *     reach the resolveAgentModel policy gate and a resume-time model override
 *     was silently ignored.
 *  3. The cancel seam only did a tenant-scoped get: any instance of the tenant
 *     could cancel a sibling instance's session. Bound the same way.
 *
 * The store mock is TENANT-AWARE (keyed tenantId::conversationId) so these
 * tests prove the route scopes its lookup, not just that it calls `get`.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  /** tenantId::conversationId -> persisted session */
  sessions: new Map<string, any>(),
  loadContext: vi.fn(),
  runAgentChatLoop: vi.fn(),
  upsert: vi.fn(),
  persistRunSteps: vi.fn(),
  deleteSession: vi.fn(),
  cleanupSandboxDir: vi.fn(),
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
    // Tenant-scoped lookup: a foreign tenantId simply misses.
    get: vi.fn((tenantId: string, conversationId: string) =>
      mocks.sessions.get(`${tenantId}::${conversationId}`) ?? null,
    ),
    upsert: (...args: unknown[]) => mocks.upsert(...args),
    persistRunSteps: (...args: unknown[]) => mocks.persistRunSteps(...args),
    listForInstance: vi.fn(() => []),
    // GLOBAL by conversationId — the pre-fix delete route called this directly.
    delete: (...args: unknown[]) => mocks.deleteSession(...args),
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
  cleanupSandboxDir: (...args: unknown[]) => mocks.cleanupSandboxDir(...args),
}));

vi.mock('../../apps/gateway/src/routes/agent-chat-loop.js', () => ({
  runAgentChatLoop: (...args: unknown[]) => mocks.runAgentChatLoop(...args),
}));

import { agentChatRoutes } from '../../apps/gateway/src/routes/agent-chat.routes.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const INSTANCE_A = 'instance-a';
const DEFINITION_A = 'definition-a';
const CONVERSATION_ID = 'conversation-a';

function context(instanceId = INSTANCE_A, definitionOverrides: Record<string, unknown> = {}) {
  return {
    instanceId,
    tenantId: TENANT_A,
    requestId: 'request-1',
    instance: { id: instanceId, agentDefinitionId: DEFINITION_A, configOverride: {} },
    definition: {
      id: DEFINITION_A,
      tenantId: TENANT_A,
      name: 'Agent A',
      allowedTools: [],
      ...definitionOverrides,
    },
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    tenantId: TENANT_A,
    agentInstanceId: INSTANCE_A,
    agentDefinitionId: DEFINITION_A,
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

function seedSession(ownerTenantId = TENANT_A, overrides: Record<string, unknown> = {}) {
  const row = session({ tenantId: ownerTenantId, ...overrides });
  mocks.sessions.set(`${ownerTenantId}::${CONVERSATION_ID}`, row);
  return row;
}

function successfulLoopResult() {
  return {
    awaitingApproval: false,
    budgetExceeded: false,
    lastResponseText: 'resumed',
    totalTokensUsed: 1,
    totalPromptTokens: 1,
    totalCompletionTokens: 0,
    totalCost: 0,
    allSteps: [],
    finalUsage: { total_tokens: 1 },
    stepsCompleted: 1,
  };
}

describe('hosted agent session boundary (tenant + instance binding)', () => {
  let app: FastifyInstance;
  let currentTenant: { id: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.sessions.clear();
    mocks.loadContext.mockImplementation(async (instanceId: string) => context(instanceId));
    mocks.runAgentChatLoop.mockResolvedValue(successfulLoopResult());
    seedSession();
    currentTenant = { id: TENANT_A, name: 'Tenant A' };

    app = Fastify({ logger: false });
    (app as any).router = {};
    app.addHook('preHandler', async (request) => {
      (request as any).tenant = currentTenant;
    });
    await app.register(agentChatRoutes, { prefix: '/v1' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // -- defect 1: DELETE had no tenant scoping and no instance binding --------

  it("does not delete another tenant's session or reclaim its sandbox", async () => {
    currentTenant = { id: TENANT_B, name: 'Tenant B' };

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/agents/${INSTANCE_A}/chat/${CONVERSATION_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { message: 'No durable session to delete' } });
    expect(mocks.deleteSession).not.toHaveBeenCalled();
    expect(mocks.cleanupSandboxDir).not.toHaveBeenCalled();
  });

  it.each([
    { mismatch: { agentInstanceId: 'instance-z' }, label: 'instance' },
    { mismatch: { agentDefinitionId: 'definition-z' }, label: 'definition' },
  ])('refuses to delete a session bound to another $label', async ({ mismatch }) => {
    seedSession(TENANT_A, mismatch);

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/agents/${INSTANCE_A}/chat/${CONVERSATION_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { message: 'No durable session to delete' } });
    expect(mocks.deleteSession).not.toHaveBeenCalled();
    expect(mocks.cleanupSandboxDir).not.toHaveBeenCalled();
  });

  it('deletes and reclaims the sandbox for an authorized session', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/agents/${INSTANCE_A}/chat/${CONVERSATION_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'deleted', conversationId: CONVERSATION_ID });
    expect(mocks.deleteSession).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(mocks.cleanupSandboxDir).toHaveBeenCalledWith(TENANT_A, CONVERSATION_ID);
  });

  // -- defect 3: cancel ignored :instanceId ---------------------------------

  it("does not cancel another tenant's session", async () => {
    currentTenant = { id: TENANT_B, name: 'Tenant B' };

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_A}/chat/${CONVERSATION_ID}/cancel`,
    });

    expect(response.statusCode).toBe(404);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('does not cancel a session bound to another instance', async () => {
    seedSession(TENANT_A, { agentInstanceId: 'instance-z' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_A}/chat/${CONVERSATION_ID}/cancel`,
    });

    expect(response.statusCode).toBe(404);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('cancels an authorized session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_A}/chat/${CONVERSATION_ID}/cancel`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'cancelled', conversationId: CONVERSATION_ID });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONVERSATION_ID, status: 'completed' }),
    );
  });

  // -- defect 2: parsedResumeBody dropped body.model -------------------------

  it('fails closed with 403 when resume overrides the model outside policy', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_A}/chat/${CONVERSATION_ID}/resume`,
      payload: {
        messages: [{ role: 'user', content: 'resume' }],
        model: 'fixture/premium-model',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toContain('model override not authorized by policy');
    expect(response.json().error.message).toContain('fixture/premium-model');
    expect(mocks.runAgentChatLoop).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('honors a policy-authorized preferredModel override on resume', async () => {
    mocks.loadContext.mockImplementation(async (instanceId: string) =>
      context(instanceId, { preferredModel: 'fixture/preferred-model' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agents/${INSTANCE_A}/chat/${CONVERSATION_ID}/resume`,
      payload: {
        messages: [{ role: 'user', content: 'resume' }],
        model: 'fixture/preferred-model',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.runAgentChatLoop).toHaveBeenCalledOnce();
    expect(mocks.runAgentChatLoop).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fixture/preferred-model' }),
    );
    expect(response.json().model).toBe('fixture/preferred-model');
  });
});
