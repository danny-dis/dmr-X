import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

import { initDb, closeDb, getDb } from '../../packages/db/src/client.js';
import { createInitialState, isStopConditionMet } from '../../packages/utils/src/index.js';
import { agentSessionStore } from '../../services/agent-runtime/src/agent-session.store.js';
import type { UnifiedRequest } from '../../packages/core/src/types/request.js';
import {
  runAgentChatLoop,
  routeWithTimeout,
  buildStopConditions,
  processApprovalDecisions,
} from '../../apps/gateway/src/routes/agent-chat-loop.js';

/**
 * Remediation #13: the durable /agents/:id/chat loop gains the four /agentic/chat
 * features. Tests exercise the real loop engine + real SQLite store (mirroring
 * auth-lookup-hash.test.ts), with a mocked router feeding scripted model turns.
 */

const tmpRoot = process.env.TMPDIR || process.env.TEMP || 'C:\\Users\\pc\\AppData\\Local\\Temp';
const TENANT = { id: 'tenant-1', name: 'tenant-1' };

let dbPath: string;
let dataDir: string;

function unifiedRequest(): UnifiedRequest {
  return {
    modality: 'llm',
    model: 'test-model',
    messages: [],
    stream: false,
    metadata: {},
  };
}

function toolCallResponse(toolCalls: Array<{ id: string; name: string }> = [{ id: 'call_1', name: 'test_tool' }]) {
  return {
    modality: 'llm',
    requestId: 'req-1',
    providerId: 'provider-1',
    modelId: 'model-1',
    latencyMs: 1,
    message: {
      role: 'assistant',
      content: 'I will use a tool',
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: '{}' },
      })),
    },
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    finishReason: 'tool_calls',
  };
}

function textResponse(content = 'Final answer') {
  return {
    modality: 'llm',
    requestId: 'req-1',
    providerId: 'provider-1',
    modelId: 'model-1',
    latencyMs: 1,
    message: { role: 'assistant', content },
    usage: { prompt_tokens: 8, completion_tokens: 7, total_tokens: 15 },
    finishReason: 'stop',
  };
}

type LoopArgs = Parameters<typeof runAgentChatLoop>[0];

function buildLoopArgs(overrides: Partial<LoopArgs> = {}): LoopArgs {
  const conversation = createInitialState('conv-' + Math.random().toString(36).slice(2, 8));
  conversation.messages = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'hello' },
  ];
  const args: LoopArgs = {
    conversation,
    maxSteps: 10,
    model: 'test-model',
    agentTools: [],
    agentToolDefs: undefined,
    body: { messages: [{ role: 'user', content: 'hello' }] },
    requestId: 'req-1',
    tenant: TENANT,
    router: { route: vi.fn() } as any,
    context: {
      instanceId: 'instance-1',
      definition: { id: 'def-1', name: 'def-1', tenantId: TENANT.id, allowedTools: [] },
      instance: { id: 'instance-1', agentDefinitionId: 'def-1', configOverride: {} },
      requestId: 'req-1',
      tenantId: TENANT.id,
    } as any,
    runtime: {} as any,
    stream: false,
    onStreamEvent: vi.fn(),
    buildSystemPrompt: async () => 'system prompt',
    agentDefinition: { id: 'def-1', name: 'def-1', tenantId: TENANT.id, allowedTools: [] },
    loadedSkillIds: [],
    ...overrides,
  };
  return args;
}

describe('agent-chat-loop feature ports (remediation #13)', () => {
  beforeAll(async () => {
    dbPath = `${tmpRoot}/dmrx-agent-loop-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`;
    dataDir = require('node:path').dirname(dbPath);
    process.env.DMRX_DATA_DIR = dataDir;
    process.env.DMRX_DB_PATH = dbPath;
    delete process.env.DMRX_ENCRYPTION_KEY;
    await initDb();
  });

  beforeEach(() => {
    try {
      getDb().prepare('DELETE FROM session_steps').run();
      getDb().prepare('DELETE FROM agent_sessions').run();
    } catch {
      /* ignore */
    }
  });

  afterAll(async () => {
    try {
      await closeDb();
    } catch {
      /* ignore */
    }
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dbFile = path.join(dataDir, 'data.db');
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`, `${dbFile}.lastgood`, `${dbFile}.enc`]) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('fires onCheckpoint once per completed turn with growing, persisted state', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: toolCallResponse() })
      .mockResolvedValueOnce({ response: textResponse('Final answer') });

    const convId = 'conv-checkpoint';
    const conversation = createInitialState(convId);
    conversation.messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ];

    const checkpoints: Array<{ turn: number; messageCount: number; persisted: boolean }> = [];
    const args = buildLoopArgs({
      conversation,
      router: { route } as any,
      conversationId: convId,
      onCheckpoint: (turn, conv) => {
        agentSessionStore.upsert({
          tenantId: TENANT.id,
          conversationId: convId,
          instanceId: 'instance-1',
          agentDefinitionId: 'def-1',
          state: conv,
          status: 'in_progress',
          lastTurn: turn,
          metadata: { loadedSkillIds: '[]', totalTokensUsed: 0 },
        });
        checkpoints.push({
          turn,
          messageCount: (conv.messages as any[]).length,
          persisted: agentSessionStore.get(TENANT.id, convId) !== null,
        });
      },
    });

    const result = await runAgentChatLoop(args);

    expect(route).toHaveBeenCalledTimes(2);
    expect(checkpoints.map((c) => c.turn)).toEqual([0, 1]);
    expect(checkpoints[0].messageCount).toBeGreaterThan(1);
    expect(checkpoints[1].messageCount).toBeGreaterThan(checkpoints[0].messageCount);
    expect(checkpoints[0].persisted).toBe(true);
    expect(checkpoints[1].persisted).toBe(true);

    // The durable store reflects the accumulated transcript from the LAST
    // checkpoint (crash between turns only loses the unfinished turn).
    const persisted = agentSessionStore.get(TENANT.id, convId);
    expect(persisted).not.toBeNull();
    expect((persisted!.state as any).messages.length).toBeGreaterThan(checkpoints[0].messageCount);
    expect((persisted!.state as any).status).toBe('in_progress');
    expect(result.stepsCompleted).toBe(2);
  });

  it('stops after N turns when stopWhen step_count is provided', async () => {
    const route = vi
      .fn()
      .mockResolvedValue({ response: toolCallResponse([{ id: 'call_1', name: 'test_tool' }]) });

    const convId = 'conv-stop';
    const conversation = createInitialState(convId);
    conversation.messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ];

    const args = buildLoopArgs({
      conversation,
      router: { route } as any,
      conversationId: convId,
      stopWhen: [{ type: 'step_count', value: 2 }],
    });

    const result = await runAgentChatLoop(args);

    // Two model responses, then the step_count(2) condition stops the loop
    // even though the model keeps asking for tools.
    expect(route).toHaveBeenCalledTimes(2);
    expect(result.stepsCompleted).toBe(2);
    expect(result.awaitingApproval).toBe(false);
  });

  it('pauses awaiting approval without executing tools when approvalRequired', async () => {
    const route = vi
      .fn()
      .mockResolvedValue({ response: toolCallResponse([{ id: 'call_1', name: 'test_tool' }]) });

    const convId = 'conv-approval';
    const conversation = createInitialState(convId);
    conversation.messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
    ];

    const args = buildLoopArgs({
      conversation,
      router: { route } as any,
      conversationId: convId,
      approvalRequired: true,
    });

    const result = await runAgentChatLoop(args);

    expect(result.awaitingApproval).toBe(true);
    expect(route).toHaveBeenCalledTimes(1); // paused after the first model call
    // No tool execution happened: the assistant tool-call message is present
    // but no tool-result message was injected.
    expect(conversation.messages.filter((m) => (m as any).role === 'tool')).toHaveLength(0);
    expect(conversation.status).toBe('awaiting_approval');
    expect(conversation.pendingToolCalls).toHaveLength(1);
    expect(conversation.pendingToolCalls![0]).toMatchObject({ id: 'call_1', name: 'test_tool' });
  });

  it('processes approval decisions on resume (approved executes, rejected refuses)', async () => {
    const conversation = createInitialState('conv-resume');
    conversation.messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
          { id: 'call_2', type: 'function', function: { name: 'other_tool', arguments: '{}' } },
        ],
      },
    ];
    conversation.pendingToolCalls = [
      { id: 'call_1', name: 'test_tool', arguments: {} },
      { id: 'call_2', name: 'other_tool', arguments: {} },
    ];
    conversation.status = 'awaiting_approval';

    const result = await processApprovalDecisions(conversation, [
      { tool_call_id: 'call_1', approved: true },
      { tool_call_id: 'call_2', approved: false },
    ], { requestId: 'req-1', tenant: TENANT });

    expect(result.processed).toBe(true);
    expect(conversation.status).toBe('in_progress');
    expect(conversation.pendingToolCalls).toBeUndefined();

    const toolMessages = conversation.messages.filter((m) => (m as any).role === 'tool');
    expect(toolMessages).toHaveLength(2);
    const call1 = toolMessages.find((m) => (m as any).tool_call_id === 'call_1');
    const call2 = toolMessages.find((m) => (m as any).tool_call_id === 'call_2');
    expect(call1).toBeDefined();
    expect(JSON.parse((call1 as any).content)).toHaveProperty('error');
    expect(call2).toBeDefined();
    expect(JSON.parse((call2 as any).content)).toEqual({ error: 'Tool call rejected by user' });
  });

  it('routeWithTimeout aborts a hung router.route call', async () => {
    const route = vi.fn((_req: any) => new Promise((_resolve, reject) => {
      const signal = (_req as any)?.signal as AbortSignal | undefined;
      signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    await expect(
      routeWithTimeout({ route } as any, unifiedRequest(), 'balanced', 50),
    ).rejects.toThrow('aborted');
    expect(route).toHaveBeenCalledTimes(1);
  });

  it('buildStopConditions maps request conditions to SDK stop conditions', async () => {
    const conditions = buildStopConditions(
      [{ type: 'step_count', value: 1 }],
      () => '',
      () => 0,
      () => 0,
    );
    expect(conditions).toHaveLength(1);
    const met = await isStopConditionMet({
      stopConditions: conditions,
      steps: [{ toolCalls: [], finishReason: 'stop' }],
    });
    expect(met).toBe(true);
  });
});
