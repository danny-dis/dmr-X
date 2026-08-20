import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

/**
 * Regression: the agent loop executed IDENTICAL tool calls twice, burning the
 * step budget re-asking a question it already had the answer to.
 *
 * Captured from live runs against the gateway:
 *   - 'Codebase Archaeologist' (maxSteps=4) produced the tool sequence
 *     `recall, recall, list_files, list_files, search_files, search_files` —
 *     every tool invoked twice with near-identical arguments.
 *   - 'Evidence Collector' called `recall` twice with only trivially different
 *     arguments.
 *
 * The fix dedupes on (tool name + NORMALIZED arguments):
 *   1. within-turn : execute once, fan the single result out to every
 *                    tool_call_id that requested it.
 *   2. cross-turn  : replay the cached earlier result instead of re-executing.
 *
 * The hard constraint these tests pin: the OpenAI tool protocol requires ONE
 * tool message per tool_call_id. Dedupe must never drop a result row, or the
 * transcript is corrupt and the provider rejects the next request.
 */

// The loop calls executeToolCall from tools.routes.js. Mock it so we can count
// REAL executions — the whole point of dedupe is that this counter stays low.
const execSpy = vi.fn();

vi.mock('../../apps/gateway/src/routes/tools.routes.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    executeToolCall: (tc: any, ctx: any) => execSpy(tc, ctx),
  };
});

const { initDb, closeDb, getDb } = await import('../../packages/db/src/client.js');
const { createInitialState } = await import('../../packages/utils/src/index.js');
const { runAgentChatLoop } = await import('../../apps/gateway/src/routes/agent-chat-loop.js');

const tmpRoot = process.env.TMPDIR || process.env.TEMP || 'C:\\Users\\pc\\AppData\\Local\\Temp';
const TENANT = { id: 'tenant-dedupe', name: 'tenant-dedupe' };

let dbPath: string;
let dataDir: string;

type Call = { id: string; name: string; args: string };

/** A pure tool-call turn carrying an arbitrary set of calls. */
function toolCallTurn(calls: Call[]) {
  return {
    modality: 'llm',
    requestId: 'req-1',
    providerId: 'provider-1',
    modelId: 'model-1',
    latencyMs: 1,
    message: {
      role: 'assistant',
      content: '',
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.args },
      })),
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

/** Tool result rows for the turn at index `turn` of the loop's allSteps. */
function resultsOfTurn(result: Awaited<ReturnType<typeof runAgentChatLoop>>, turn: number) {
  return result.allSteps.find((s: any) => s.turn === turn)?.tool_results ?? [];
}

describe('agent-chat-loop: tool call dedupe', () => {
  beforeAll(async () => {
    dbPath = `${tmpRoot}/dmrx-tool-dedupe-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`;
    dataDir = require('node:path').dirname(dbPath);
    process.env.DMRX_DATA_DIR = dataDir;
    process.env.DMRX_DB_PATH = dbPath;
    delete process.env.DMRX_ENCRYPTION_KEY;
    await initDb();
  });

  beforeEach(() => {
    execSpy.mockReset();
    // Distinct payload per execution so a fanned-out copy is identifiable.
    let n = 0;
    execSpy.mockImplementation(async (tc: any) => ({
      tool_call_id: tc.id,
      tool_name: tc.function.name,
      result: { ok: true, execution: ++n },
    }));
    delete process.env.DMRX_AGENT_TOOL_DEDUPE;
    try {
      getDb().prepare('DELETE FROM session_steps').run();
      getDb().prepare('DELETE FROM agent_sessions').run();
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    delete process.env.DMRX_AGENT_TOOL_DEDUPE;
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

  // ------------------------------------------------------------ WITHIN A TURN

  it('executes an identical call once when a turn asks for it twice', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'recall', args: '{"query":"tests passing"}' },
          { id: 'c2', name: 'recall', args: '{"query":"tests passing"}' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('done') });

    const result = await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 4 }));

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(result.lastResponseText).toBe('done');
  });

  it('still emits one tool result per tool_call_id (transcript integrity)', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'list_files', args: '{"path":"."}' },
          { id: 'c2', name: 'list_files', args: '{"path":"."}' },
          { id: 'c3', name: 'search_files', args: '{"q":"TODO"}' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('done') });

    const result = await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 4 }));

    // Two unique calls executed, three result rows produced.
    expect(execSpy).toHaveBeenCalledTimes(2);
    const rows = resultsOfTurn(result, 0);
    expect(rows.map((r: any) => r.tool_call_id)).toEqual(['c1', 'c2', 'c3']);

    // And the provider-facing transcript has a tool message for every id.
    const toolMsgs = (route.mock.calls[1][0].messages as any[]).filter((m) => m.role === 'tool');
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('fans the single execution result out to the duplicate id', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'recall', args: '{"query":"x"}' },
          { id: 'c2', name: 'recall', args: '{"query":"x"}' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('done') });

    const result = await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 4 }));
    const [a, b] = resultsOfTurn(result, 0);

    expect(a.result).toEqual({ ok: true, execution: 1 });
    expect(b.result).toEqual({ ok: true, execution: 1 }); // same payload, not a 2nd run
    expect(b.deduped).toBe('within_turn');
    expect(b.deduped_from).toBe('c1');
    expect(a.deduped).toBeUndefined();
  });

  it('does not dedupe calls to the same tool with genuinely different arguments', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'recall', args: '{"query":"alpha"}' },
          { id: 'c2', name: 'recall', args: '{"query":"beta"}' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('done') });

    await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 4 }));
    expect(execSpy).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------- ARGUMENT NORMALIZE

  it('matches identical arguments written with a different key order', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'search_files', args: '{"a":1,"b":2}' },
          { id: 'c2', name: 'search_files', args: '{"b":2,"a":1}' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('done') });

    const result = await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 4 }));

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(resultsOfTurn(result, 0)).toHaveLength(2);
  });

  it('matches nested objects with reordered keys and ignores whitespace', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'recall', args: '{"filter":{"x":1,"y":2},"limit":3}' },
          { id: 'c2', name: 'recall', args: '{ "limit": 3, "filter": { "y": 2, "x": 1 } }' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('done') });

    await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 4 }));
    expect(execSpy).toHaveBeenCalledTimes(1);
  });

  it('treats empty-string and "{}" arguments as the same call', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'list_files', args: '' },
          { id: 'c2', name: 'list_files', args: '{}' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('done') });

    await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 4 }));
    expect(execSpy).toHaveBeenCalledTimes(1);
  });

  it('does not confuse two different tools that share arguments', async () => {
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'list_files', args: '{"path":"."}' },
          { id: 'c2', name: 'search_files', args: '{"path":"."}' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('done') });

    await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 4 }));
    expect(execSpy).toHaveBeenCalledTimes(2);
  });

  // ------------------------------------------------------------- ACROSS TURNS

  it('replays the cached result when a later turn repeats an executed call', async () => {
    const call = { id: 'c1', name: 'recall', args: '{"query":"same"}' };
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: toolCallTurn([call]) })
      .mockResolvedValueOnce({ response: toolCallTurn([{ ...call, id: 'c2' }]) })
      .mockResolvedValueOnce({ response: textTurn('done') });

    const result = await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 5 }));

    // Executed on turn 0 only.
    expect(execSpy).toHaveBeenCalledTimes(1);
    const turn1 = resultsOfTurn(result, 1);
    expect(turn1).toHaveLength(1);
    expect(turn1[0].tool_call_id).toBe('c2');
    expect(turn1[0].deduped).toBe('cross_turn');
    expect(turn1[0].result).toEqual({ ok: true, execution: 1 });
  });

  it('tells the model in-transcript that a cross-turn repeat was cached', async () => {
    const call = { id: 'c1', name: 'recall', args: '{"query":"same"}' };
    const route = vi
      .fn()
      .mockResolvedValueOnce({ response: toolCallTurn([call]) })
      .mockResolvedValueOnce({ response: toolCallTurn([{ ...call, id: 'c2' }]) })
      .mockResolvedValueOnce({ response: textTurn('done') });

    await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 5 }));

    const finalMessages = route.mock.calls[2][0].messages as any[];
    const repeatMsg = finalMessages.find((m) => m.role === 'tool' && m.tool_call_id === 'c2');
    expect(repeatMsg).toBeTruthy();
    expect(repeatMsg.content).toContain('_dmrx_note');
    // The original result is still carried, not replaced by the note.
    expect(repeatMsg.content).toContain('"ok":true');
  });

  it('reproduces the live Archaeologist pattern with 3 executions instead of 6', async () => {
    // recall,recall,list_files,list_files,search_files,search_files
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'recall', args: '{"query":"history"}' },
          { id: 'c2', name: 'recall', args: '{"query":"history"}' },
        ]),
      })
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c3', name: 'list_files', args: '{"path":"src"}' },
          { id: 'c4', name: 'list_files', args: '{"path":"src"}' },
        ]),
      })
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c5', name: 'search_files', args: '{"q":"init"}' },
          { id: 'c6', name: 'search_files', args: '{"q":"init"}' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('Findings.') });

    const result = await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 6 }));

    expect(execSpy).toHaveBeenCalledTimes(3);
    // All six ids still answered across the three tool turns.
    const ids = [0, 1, 2].flatMap((t) => resultsOfTurn(result, t).map((r: any) => r.tool_call_id));
    expect(ids).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect(result.lastResponseText).toBe('Findings.');
  });

  // ------------------------------------------------------------------ ENV GATE

  it('executes duplicates again when DMRX_AGENT_TOOL_DEDUPE=0', async () => {
    process.env.DMRX_AGENT_TOOL_DEDUPE = '0';
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'recall', args: '{"query":"x"}' },
          { id: 'c2', name: 'recall', args: '{"query":"x"}' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('done') });

    const result = await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 4 }));

    expect(execSpy).toHaveBeenCalledTimes(2);
    expect(resultsOfTurn(result, 0)).toHaveLength(2);
  });

  it('is on by default when the env var is unset', async () => {
    delete process.env.DMRX_AGENT_TOOL_DEDUPE;
    const route = vi
      .fn()
      .mockResolvedValueOnce({
        response: toolCallTurn([
          { id: 'c1', name: 'recall', args: '{"query":"x"}' },
          { id: 'c2', name: 'recall', args: '{"query":"x"}' },
        ]),
      })
      .mockResolvedValueOnce({ response: textTurn('done') });

    await runAgentChatLoop(buildLoopArgs({ router: { route } as any, maxSteps: 4 }));
    expect(execSpy).toHaveBeenCalledTimes(1);
  });
});
