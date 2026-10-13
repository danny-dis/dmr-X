import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '../../services/mcp-server/node_modules/@modelcontextprotocol/server/dist/index.mjs';
import { createDMRXMcpServer } from '../../services/mcp-server/src/server.js';

// Keep real registration/handlers; only isolate the DB and upstream network.
vi.mock('@dmr-x/db', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  initDb: vi.fn(async () => undefined),
}));

const handlers = new Map<string, (...args: any[]) => Promise<any>>();
const servers: McpServer[] = [];
let upstream: Record<string, unknown>;

beforeEach(() => {
  handlers.clear();
  upstream = {};
  vi.stubEnv('DMRX_MCP_AGENT_API_KEY', 'runtime-regression-placeholder');
  const register = McpServer.prototype.registerTool;
  vi.spyOn(McpServer.prototype, 'registerTool').mockImplementation(function (this: McpServer, ...args: any[]) {
    handlers.set(args[0], args[2]);
    return register.apply(this, args as any);
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    String(url).includes('/v1/agents?') ? { items: [], total: 0 } : upstream,
  ), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function start() {
  const { server, ready } = createDMRXMcpServer({
    gatewayUrl: 'http://runtime-regression.invalid',
    allowedTools: ['dmrx_run_agent', 'dmrx_list_agents'],
  });
  servers.push(server);
  await ready;
}

describe('Live runtime MCP contract regression', () => {
  it('preserves whole-run execution evidence without forwarding arbitrary gateway fields', async () => {
    upstream = {
      content: 'actual sandbox output', conversationId: 'thread-1', agentName: 'API Tester',
      model: 'auto', usage: { total_tokens: 12 }, status: 'completed',
      all_steps: [{ step: 0, tool_calls: [{ function: { name: 'bash', arguments: '{"command":"pwd"}' } }], tool_results: [{ result: '/sandbox' }] }],
      steps_completed: 2, totalTokens: 345, costUsd: 0,
      pending_tool_calls: [], budget_exceeded: false,
      internalHeaders: { authorization: 'must-not-be-forwarded' },
    };
    await start();
    const reply = await handlers.get('dmrx_run_agent')!({ instanceId: 'test-agent', message: 'Execute pwd', maxSteps: 3 });
    expect(reply.isError).not.toBe(true);
    expect(reply.structuredContent).toMatchObject({
      content: upstream.content, conversationId: 'thread-1', usage: { total_tokens: 12 },
      status: 'completed', all_steps: upstream.all_steps, steps_completed: 2,
      totalTokens: 345, costUsd: 0, pending_tool_calls: [], budget_exceeded: false,
    });
    expect(reply.structuredContent).not.toHaveProperty('internalHeaders');
    expect(JSON.parse(reply.content[0].text)).toEqual(reply.structuredContent);
  });

  it('does not advertise orphan instances as callable agents', async () => {
    upstream = { total: 2, items: [
      { id: 'valid-agent', definitionName: 'API Tester', status: 'active', lifecycleState: 'ready' },
      { id: 'orphan-agent', definitionName: null, definitionHumanName: null, definitionCategory: null, status: 'active' },
    ] };
    await start();
    const reply = await handlers.get('dmrx_list_agents')!({});
    expect(reply.structuredContent.agents.map((a: any) => a.instanceId)).toEqual(['valid-agent']);
    expect(reply.structuredContent.total).toBe(reply.structuredContent.agents.length);
  });
});
