import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

import { initDb, closeDb, getDb } from '../../packages/db/src/client.js';
import { createInitialState } from '../../packages/utils/src/index.js';
import { runAgentChatLoop } from '../../apps/gateway/src/routes/agent-chat-loop.js';

/**
 * Regression: a step-limited agent run returned the GATEWAY's placeholder text
 * instead of the agent's own answer.
 *
 * The ReAct loop breaks the moment `turn === maxSteps - 1`. When that final turn
 * carries tool calls, those calls are discarded AND the model never gets a turn
 * to speak about the work it already did, so the run ends with no prose at all.
 * The previous fix papered over this by synthesising "Reached the N-step limit
 * after calling: ..." — which made an empty-reply benchmark report success while
 * every tool-using agent had in fact produced nothing.
 *
 * Measured on the real DMR-X agent fleet (24 agents, concurrency 6, maxSteps=2):
 * all 10 tool-using agents returned 128-144 characters — exactly the synthesised
 * placeholder — while the 7 agents that answered directly returned 972-7479
 * characters of real prose. "0 empty replies" was a measurement artifact.
 *
 * The fix issues ONE final summarisation turn with tools withheld, so the reply
 * is the model's own words. These tests pin that behaviour, and pin that the
 * placeholder is only ever a last resort — clearly marked as gateway output.
 */

const tmpRoot = process.env.TMPDIR || process.env.TEMP || 'C:\\Users\\pc\\AppData\\Local\\Temp';
const TENANT = { id: 'tenant-summary', name: 'tenant-summary' };

let dbPath: string;
let dataDir: string;

/** A pure tool-call turn with empty content — what providers really send. */
function toolCallTurn(id = 'call_1') {
  return {
    modality: 'llm',
    requestId: 'req-1',
    providerId: 'provider-1',
    modelId: 'model-1',
    latencyMs: 1,
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ id, type: 'function', function: { name: 'test_tool', arguments: '{}' } }],
    },
    usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    finishReason: 'tool_calls',
  };
}

function textTurn(content: string) {
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
    { role: 'user', content: 'do the thing' },
  ];
  return {
    conversation,
    maxSteps: 10,
    model: 'test-model',
    agentTools: [],
    agentToolDefs: undefined,
    body: { messages: [{ role: 'user', content: 'do the thing' }] },
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
  } as LoopArgs;
}

const PLACEHOLDER_PREFIX = '[dmr-x] No agent output produced';

describe('agent-chat-loop: final summary turn on step limit', () => {
  beforeAll(async () => {
    dbPath = `${tmpRoot}/dmrx-final-summary-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`;
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

  it('asks the model for a real answer instead of returning a placeholder', async () => {
    // Two pure tool-call turns exhaust maxSteps=2 with no prose ever produced.
    // The loop must then make a THIRD call — the summarisation turn — and return
    // its text as the reply.
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: toolCallTurn('call_0') })
      .mockResolvedValueOnce({ response: toolCallTurn('call_1') })
      .mockResolvedValueOnce({ response: textTurn('The endpoint rate-limits after 5 attempts.') });

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 2 }),
    );

    expect(route).toHaveBeenCalledTimes(3);
    expect(result.lastResponseText).toBe('The endpoint rate-limits after 5 attempts.');
    expect(result.lastResponseText).not.toContain(PLACEHOLDER_PREFIX);
  });

  it('withholds tools on the summary turn so the model cannot loop again', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: toolCallTurn('call_0') })
      .mockResolvedValueOnce({ response: toolCallTurn('call_1') })
      .mockResolvedValueOnce({ response: textTurn('Done.') });

    await runAgentChatLoop(
      buildLoopArgs({
        router: { route } as any,
        maxSteps: 2,
        // Give the loop real tool defs so "withheld" is meaningful.
        agentToolDefs: [
          { type: 'function', function: { name: 'test_tool', description: 't', parameters: {} } },
        ] as any,
      }),
    );

    const summaryCall = route.mock.calls[2][0];
    // Either absent or empty — what matters is that the summary request cannot
    // produce another tool-call turn.
    expect(summaryCall.tools == null || summaryCall.tools.length === 0).toBe(true);
  });

  it('counts the summary turn tokens toward the run total', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: toolCallTurn('call_0') })
      .mockResolvedValueOnce({ response: toolCallTurn('call_1') })
      .mockResolvedValueOnce({ response: textTurn('Summary.') });

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 2 }),
    );

    // 5 + 5 from the tool turns, plus 15 from the summary turn.
    expect(result.totalTokensUsed).toBe(25);
  });

  it('falls back to a clearly-marked gateway placeholder if the summary turn fails', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: toolCallTurn('call_0') })
      .mockResolvedValueOnce({ response: toolCallTurn('call_1') })
      .mockRejectedValueOnce(new Error('provider exhausted'));

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 2 }),
    );

    // Never an empty string, but never mistakable for the agent's own answer.
    expect(result.lastResponseText.trim()).not.toBe('');
    expect(result.lastResponseText).toContain(PLACEHOLDER_PREFIX);
  });

  it('does not fire a summary turn when the agent already produced prose', async () => {
    // Turn 0 has prose + tool calls, turn 1 is an empty tool-call turn at the
    // step limit. The earlier prose stands; no extra completion should be spent.
    const proseWithTools = {
      ...toolCallTurn('call_0'),
      message: {
        role: 'assistant',
        content: 'Here is my finding already.',
        tool_calls: [
          { id: 'call_0', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
        ],
      },
    };
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: proseWithTools })
      .mockResolvedValueOnce({ response: toolCallTurn('call_1') });

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 2 }),
    );

    expect(route).toHaveBeenCalledTimes(2);
    expect(result.lastResponseText).toContain('Here is my finding already.');
  });

  it('does not fire a summary turn when the run ended without tool calls', async () => {
    const route = vi.fn().mockResolvedValueOnce({ response: textTurn('Direct reply') });

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 2 }),
    );

    expect(route).toHaveBeenCalledTimes(1);
    expect(result.lastResponseText).toBe('Direct reply');
  });
});
