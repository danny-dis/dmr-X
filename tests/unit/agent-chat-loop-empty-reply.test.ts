import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

import { initDb, closeDb, getDb } from '../../packages/db/src/client.js';
import { createInitialState } from '../../packages/utils/src/index.js';
import { runAgentChatLoop } from '../../apps/gateway/src/routes/agent-chat-loop.js';

/**
 * Regression: the agentic loop returned an EMPTY reply whenever it stopped on a
 * turn that carried tool calls.
 *
 * `lastResponseText` was overwritten on every turn with that turn's
 * `message.content`. Real models emit `content: ''` (or null) when they emit
 * tool_calls, so the assignment wiped any earlier prose. The loop then breaks
 * when `turn === maxSteps - 1`, so a step-limited run ends on exactly such a
 * turn and the caller receives `content: ''` despite the agent having done work.
 *
 * Found by delegating real tasks to the DMR-X agent fleet: every agent that
 * invoked a tool returned reply_len=0, while agents that answered directly
 * returned full prose. 3 of 4 successful runs were silently empty.
 *
 * The pre-existing suite missed it because its `toolCallResponse()` helper set
 * `content: 'I will use a tool'` — non-empty, so the overwrite was harmless.
 * These fixtures use `''` and `null`, which is what providers actually send.
 */

const tmpRoot = process.env.TMPDIR || process.env.TEMP || 'C:\\Users\\pc\\AppData\\Local\\Temp';
const TENANT = { id: 'tenant-empty', name: 'tenant-empty' };

let dbPath: string;
let dataDir: string;

/** A tool-call turn with EMPTY content — what providers really return. */
function emptyToolCallResponse(content: string | null = '') {
  return {
    modality: 'llm',
    requestId: 'req-1',
    providerId: 'provider-1',
    modelId: 'model-1',
    latencyMs: 1,
    message: {
      role: 'assistant',
      content,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
      ],
    },
    usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
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

describe('agent-chat-loop: never return an empty reply after tool use', () => {
  beforeAll(async () => {
    dbPath = `${tmpRoot}/dmrx-empty-reply-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`;
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

  it('keeps earlier prose when the final turn is an empty tool-call turn', async () => {
    // Turn 0 says something useful, turn 1 emits tool calls with no content and
    // hits the step limit. The reply must not be blank.
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: textResponseWithToolCalls('Analysing the failure now.') })
      .mockResolvedValueOnce({ response: emptyToolCallResponse('') });

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 2 }),
    );

    expect(result.lastResponseText.trim()).not.toBe('');
    expect(result.lastResponseText).toContain('Analysing the failure now.');
  });

  it('does not blank the reply when content is null on the tool-call turn', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: textResponseWithToolCalls('Partial finding.') })
      .mockResolvedValueOnce({ response: emptyToolCallResponse(null) });

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 2 }),
    );

    expect(result.lastResponseText.trim()).not.toBe('');
  });

  it('single-turn step limit on a tool call still yields a non-empty reply', async () => {
    // maxSteps=1 means the FIRST turn is also the last. With empty content and
    // tool calls there is no earlier prose to fall back on, so the loop must
    // synthesise something rather than returning ''.
    const route = vi.fn().mockResolvedValueOnce({ response: emptyToolCallResponse('') });

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 1 }),
    );

    expect(result.lastResponseText.trim()).not.toBe('');
  });

  it('a normal final text turn still wins over earlier prose', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: textResponseWithToolCalls('First pass.') })
      .mockResolvedValueOnce({ response: textResponse('Final answer') });

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 5 }),
    );

    expect(result.lastResponseText).toBe('Final answer');
  });

  it('a plain single text turn is returned verbatim', async () => {
    const route = vi.fn().mockResolvedValueOnce({ response: textResponse('Direct reply') });

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 5 }),
    );

    expect(result.lastResponseText).toBe('Direct reply');
  });

  it('strips <thought> blocks but does not blank a thought-only reply', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: textResponseWithToolCalls('Useful prose.') })
      .mockResolvedValueOnce({
        response: emptyToolCallResponse('<thought>internal only</thought>'),
      });

    const result = await runAgentChatLoop(
      buildLoopArgs({ router: { route } as any, maxSteps: 2 }),
    );

    expect(result.lastResponseText).not.toContain('internal only');
    expect(result.lastResponseText.trim()).not.toBe('');
  });
});

/** A turn that has BOTH prose and tool calls (some models do this). */
function textResponseWithToolCalls(content: string) {
  return {
    modality: 'llm',
    requestId: 'req-1',
    providerId: 'provider-1',
    modelId: 'model-1',
    latencyMs: 1,
    message: {
      role: 'assistant',
      content,
      tool_calls: [
        { id: 'call_0', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
      ],
    },
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    finishReason: 'tool_calls',
  };
}
