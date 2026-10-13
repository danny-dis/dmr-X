import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  markReady: vi.fn(), loadContext: vi.fn(), claim: vi.fn(), preflight: vi.fn(),
  locks: new Map<string, Promise<void>>(), runLoop: vi.fn(), release: vi.fn(),
}));
vi.mock('@dmr-x/agent-runtime', () => ({
  agentRuntimeService: {
    loadContext: m.loadContext, markInstanceReady: m.markReady,
    resolveModel: () => 'fixture/free-model', recordExecution: vi.fn(),
  },
  agentSessionStore: { claim: m.claim, locks: m.locks, listForInstance: vi.fn() },
}));
vi.mock('@dmr-x/agent-registry', async (original) => ({
  ...(await original<Record<string, unknown>>()), agentRegistryService: {},
}));
vi.mock('@dmr-x/billing', () => ({ billingService: { getModelPricing: vi.fn() } }));
vi.mock('../../apps/gateway/src/routes/tools.routes.js', () => ({
  normalizeAllowedTools: (names: string[] | undefined) => names ?? [],
  getRegisteredToolDefinitions: () => [], cleanupSandboxDir: vi.fn(),
}));
vi.mock('../../apps/gateway/src/lib/agent-admission.js', async (original) => ({
  ...(await original<Record<string, unknown>>()), preflightModelRun: m.preflight, releaseAgentHold: m.release,
}));
vi.mock('../../apps/gateway/src/routes/agent-chat-loop.js', () => ({ runAgentChatLoop: m.runLoop }));
import { agentChatRoutes } from '../../apps/gateway/src/routes/agent-chat.routes.js';

let app: ReturnType<typeof Fastify>;
const context = {
  instanceId: 'instance-1', tenantId: 'tenant-1', instance: { id: 'instance-1' },
  definition: { id: 'definition-1', tenantId: 'tenant-1', name: 'Fixture', allowedTools: [] as string[] },
};
beforeEach(async () => {
  vi.clearAllMocks(); m.locks.clear(); context.definition.allowedTools = [];
  m.loadContext.mockResolvedValue(context); m.markReady.mockResolvedValue(undefined);
  m.claim.mockReturnValue({ outcome: 'claimed' });
  m.preflight.mockResolvedValue({ admitted: false, status: 402, reason: 'fixture budget refusal' });
  m.release.mockResolvedValue(undefined);
  app = Fastify({ logger: false });
  (app as any).router = {};
  app.addHook('preHandler', async (req) => { (req as any).tenant = { id: 'tenant-1' }; });
  await app.register(agentChatRoutes, { prefix: '/v1' }); await app.ready();
});
afterEach(async () => { await app.close(); });

async function post(extra: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url: '/v1/agents/instance-1/chat',
    payload: { messages: [{ role: 'user', content: 'test' }], maxSteps: 1, maxTokens: 20, ...extra } });
}
describe('Hosted runtime preflight lifecycle cleanup', () => {
  it('parks acquired context after model-policy rejection', async () => {
    const res = await post({ model: 'openai/unapproved' });
    expect(res.statusCode).toBe(403);
    expect(m.markReady).toHaveBeenCalledWith('instance-1', 'tenant-1');
    expect(m.runLoop).not.toHaveBeenCalled(); expect(m.locks.size).toBe(0);
  });
  it('parks acquired context after conversation conflict', async () => {
    m.claim.mockReturnValue({ outcome: 'conflict' });
    expect((await post({ conversationId: 'other-instance-thread' })).statusCode).toBe(404);
    expect(m.markReady).toHaveBeenCalledWith('instance-1', 'tenant-1');
  });
  it('parks acquired context after missing required tools', async () => {
    context.definition.allowedTools = ['missing-required-tool'];
    expect((await post()).statusCode).toBe(400);
    expect(m.markReady).toHaveBeenCalledWith('instance-1', 'tenant-1');
  });
  it('parks acquired context after admission refusal', async () => {
    expect((await post()).statusCode).toBe(402);
    expect(m.markReady).toHaveBeenCalledWith('instance-1', 'tenant-1');
  });
  it('does not park an instance when no execution context was acquired', async () => {
    m.loadContext.mockResolvedValue(null);
    expect((await post()).statusCode).toBe(404); expect(m.markReady).not.toHaveBeenCalled();
  });
});
