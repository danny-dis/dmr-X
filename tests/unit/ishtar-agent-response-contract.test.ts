import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  loop: vi.fn(), upsert: vi.fn(), persisted: null as any,
  definition: { id: 'definition-1', tenantId: 'tenant-1', name: 'API Tester', allowedTools: [] },
}));
vi.mock('@dmr-x/router', () => ({ resolveMetaModel: vi.fn(), markTrustedExternalAccounting: vi.fn() }));
vi.mock('@dmr-x/utils', async () => ({
  ...await import('../../packages/utils/src/conversation-state.js'),
  generateRequestId: () => 'request-1',
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@dmr-x/agent-registry', async () => ({
  ...await import('../../services/agent-registry/src/agent-schema.js'),
  isSystemAgentName: (name: string) => name.startsWith('__'),
  agentRegistryService: {
    listInstances: vi.fn(async () => ({ items: [{ id: 'instance-1', agentDefinitionId: 'definition-1' }] })),
    getDefinition: vi.fn(async () => fixture.definition), listExecutions: vi.fn(async () => []),
  },
}));
vi.mock('@dmr-x/agent-runtime', () => ({
  agentRuntimeService: {
    loadContext: vi.fn(async () => ({ instanceId: 'instance-1', tenantId: 'tenant-1', definition: fixture.definition, instance: {} })),
    markInstanceReady: vi.fn(async () => {}), resolveModel: () => 'fixture/test-model',
    buildSystemPrompt: vi.fn(async () => 'system prompt'), createExecution: vi.fn(async () => ({ id: 'execution-1' })),
    evaluateExecution: vi.fn(async () => {}), recordExecution: vi.fn(async () => {}),
  },
  agentSessionStore: {
    locks: new Map(), claim: vi.fn(() => ({ outcome: 'claimed' })), get: vi.fn(() => fixture.persisted),
    upsert: (...args: unknown[]) => fixture.upsert(...args), persistRunSteps: vi.fn(),
  },
}));
vi.mock('@dmr-x/billing', () => ({ billingService: {
  getModelPricing: vi.fn(async () => ({ providerId: 'fixture', modelId: 'test-model', inputPricePer1kTokens: 0, outputPricePer1kTokens: 0 })),
  recordUsage: vi.fn(async () => {}),
} }));
vi.mock('../../apps/gateway/src/routes/tools.routes.js', () => ({
  getRegisteredToolDefinitions: () => [], normalizeAllowedTools: () => [], cleanupSandboxDir: vi.fn(),
}));
vi.mock('../../apps/gateway/src/routes/agent-chat-loop.js', () => ({
  runAgentChatLoop: (...args: unknown[]) => fixture.loop(...args),
}));
import { agentChatRoutes } from '../../apps/gateway/src/routes/agent-chat.routes.js';
import { agentDispatchRoutes } from '../../apps/gateway/src/routes/agent-dispatch.routes.js';
import { agentRuntimeService } from '@dmr-x/agent-runtime';

// Synthetic boundary fixtures, not claims of live model/tool execution.
const evidence = [
  { turn: 0, message: { role: 'assistant', content: 'checking' }, tool_calls: [{ id: 'call-1', function: { name: 'execute', arguments: '{}' } }], tool_results: [{ tool_call_id: 'call-1', output: { stdout: 'fixture stdout', exitCode: 0 } }] },
  { turn: 1, message: { role: 'assistant', content: 'done' }, tool_calls: [], tool_results: [] },
];
const pending = [{ id: 'call-2', name: 'execute', arguments: { command: 'fixture' } }];
const outcomes = [
  { label: 'completed', state: 'completed', expected: 'completed', reason: undefined, flags: {} },
  { label: 'budget', state: 'completed', expected: 'interrupted', reason: 'budget_exceeded', flags: { budgetExceeded: true } },
  { label: 'timeout', state: 'completed', expected: 'interrupted', reason: 'run_timeout', flags: { runTimedOut: true } },
  { label: 'budget/timeout override approval', state: 'awaiting_approval', expected: 'interrupted', reason: 'budget_exceeded', flags: { budgetExceeded: true, runTimedOut: true, awaitingApproval: true } },
  { label: 'interrupted state', state: 'interrupted', expected: 'interrupted', reason: 'interrupted', flags: {} },
  { label: 'approval', state: 'awaiting_approval', expected: 'awaiting_approval', reason: 'awaiting_approval', flags: { awaitingApproval: true } },
  { label: 'error state', state: 'error', expected: 'error', reason: 'error', flags: {} },
  { label: 'still in progress', state: 'in_progress', expected: 'in_progress', reason: 'in_progress', flags: {} },
];
function setOutcome(outcome = outcomes[0]) {
  fixture.loop.mockImplementation(async (input: any) => {
    input.conversation.status = outcome.state;
    input.conversation.pendingToolCalls = pending;
    return { lastResponseText: 'done', totalTokensUsed: 37, totalPromptTokens: 25, totalCompletionTokens: 12, totalCost: 0.125,
      finalUsage: { total_tokens: 7 }, allSteps: evidence, stepsCompleted: 2, budgetExceeded: false, ...outcome.flags };
  });
}
let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks(); fixture.persisted = null; setOutcome();
  app = Fastify({ logger: false }); (app as any).router = {};
  app.addHook('preHandler', async (request) => { (request as any).tenant = { id: 'tenant-1' }; });
  await app.register(agentChatRoutes, { prefix: '/v1' });
  await app.register(agentDispatchRoutes, { prefix: '/v1' }); await app.ready();
});
afterEach(async () => { await app.close(); });

function assertState(body: any, outcome: typeof outcomes[number]) {
  expect(body.status).toBe(outcome.expected);
  if ('budgetExceeded' in outcome.flags) expect(body.budget_exceeded).toBe(true);
  if ('runTimedOut' in outcome.flags) expect(body.run_timed_out).toBe(true);
  if (outcome.expected === 'awaiting_approval') expect(body.pending_tool_calls).toEqual(pending);
  else expect(body).not.toHaveProperty('pending_tool_calls');
}

function assertTelemetry(outcome: typeof outcomes[number], evaluate: boolean) {
  const status = outcome.expected === 'completed' ? 'success' : 'error';
  expect.soft(agentRuntimeService.createExecution).toHaveBeenCalledTimes(1);
  const args = vi.mocked(agentRuntimeService.createExecution).mock.calls[0];
  expect.soft(args?.[0]).toMatchObject({ instanceId: 'instance-1', tenantId: 'tenant-1' });
  // Partial output and actual tool names/tokens survive non-completion.
  expect.soft(args?.slice(2, 7)).toEqual(['done', ['execute'], 'fixture/test-model', 25, 12]);
  expect.soft(args?.[7]).toEqual(expect.any(Number));
  expect.soft(args?.slice(8)).toEqual([status, outcome.reason]);
  if (evaluate) {
    expect.soft(agentRuntimeService.evaluateExecution).toHaveBeenCalledTimes(1);
    const evaluationArgs = vi.mocked(agentRuntimeService.evaluateExecution).mock.calls[0];
    expect.soft(evaluationArgs?.[1]).toMatchObject({
      id: 'execution-1', output: 'done', toolsUsed: ['execute'], inputTokens: 25,
      outputTokens: 12, durationMs: expect.any(Number), status, error: outcome.reason ?? null,
    });
    expect.soft(evaluationArgs?.[2]).toEqual(evidence);
  } else {
    expect.soft(agentRuntimeService.evaluateExecution).not.toHaveBeenCalled();
  }
}

describe('agent resume HTTP response contract', () => {
  it.each(outcomes)('returns $label status, flags and resumed segment evidence', async (outcome) => {
    fixture.persisted = { agentInstanceId: 'instance-1', agentDefinitionId: 'definition-1', metadata: { loadedSkillIds: '[]' }, state: { id: 'conversation-1', messages: [], status: 'interrupted', createdAt: 1, updatedAt: 1 } };
    setOutcome(outcome);
    const response = await app.inject({ method: 'POST', url: '/v1/agents/instance-1/chat/conversation-1/resume', payload: { messages: [{ role: 'user', content: 'continue' }] } });
    expect(response.statusCode).toBe(200); const body = response.json(); assertState(body, outcome);
    expect(body).toMatchObject({ resumed: true, conversationId: 'conversation-1', all_steps: evidence, totalTokens: 37, costUsd: 0.125, steps_completed: 2 });
    expect(fixture.upsert.mock.calls.at(-1)?.[0].status).toBe(outcome.expected);
    assertTelemetry(outcome, true);
  });
});

describe('agent dispatch HTTP response contract', () => {
  it.each(outcomes)('returns $label status with exact loop evidence and cumulative totals', async (outcome) => {
    setOutcome(outcome);
    const response = await app.inject({ method: 'POST', url: '/v1/agentic/dispatch', payload: { task: 'API testing', run: true } });
    expect(response.statusCode).toBe(200); const body = response.json(); assertState(body, outcome);
    expect(body).toMatchObject({ content: 'done', all_steps: evidence, totalTokens: 37, costUsd: 0.125, usage: { total_tokens: 7 }, steps_completed: 2 });
    expect(body.conversationId).toBe(fixture.loop.mock.calls[0][0].conversationId);
    expect(body.conversationId).toBe('dispatch:request-1');
    assertTelemetry(outcome, false);
  });
  it('run:false selects without execution or fabricated completion/evidence', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/agentic/dispatch', payload: { task: 'API testing', run: false } });
    expect(response.statusCode).toBe(200); expect(response.json().matched).toBe(true);
    expect(response.json()).not.toHaveProperty('status'); expect(response.json()).not.toHaveProperty('all_steps');
    expect(fixture.loop).not.toHaveBeenCalled();
    expect(agentRuntimeService.createExecution).not.toHaveBeenCalled();
    expect(agentRuntimeService.evaluateExecution).not.toHaveBeenCalled();
  });
});

describe('agent chat HTTP response contract', () => {
  it.each(outcomes)('returns explicit $label status and preserves existing evidence', async (outcome) => {
    setOutcome(outcome);
    const response = await app.inject({ method: 'POST', url: '/v1/agents/instance-1/chat', payload: { messages: [{ role: 'user', content: 'check' }] } });
    expect(response.statusCode).toBe(200); const body = response.json(); assertState(body, outcome);
    expect(body).toMatchObject({ content: 'done', conversationId: 'instance-1:request-1', totalTokens: 37, costUsd: 0.125, usage: { total_tokens: 7 }, all_steps: evidence, steps_completed: 2 });
    expect(fixture.upsert.mock.calls.at(-1)?.[0].status).toBe(outcome.expected);
    assertTelemetry(outcome, true);
  });
  it.each(outcomes)('SSE done reports $label without inventing completion', async (outcome) => {
    setOutcome(outcome);
    const response = await app.inject({ method: 'POST', url: '/v1/agents/instance-1/chat', payload: { stream: true, messages: [{ role: 'user', content: 'check' }] } });
    expect(response.statusCode).toBe(200);
    const match = response.body.match(/event: done\ndata: (.+)/); expect(match).not.toBeNull();
    const body = JSON.parse(match![1]); assertState(body, outcome);
    expect(body).toMatchObject({ conversationId: 'instance-1:request-1', totalTokensUsed: 37, totalCost: 0.125 });
    assertTelemetry(outcome, true);
  });
});
