import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInitialState, updateState } from '../../packages/utils/src/conversation-state.js';
import { runAgentChatLoop } from '../../apps/gateway/src/routes/agent-chat-loop.js';
import { agentResponseContract, agentExecutionTelemetry } from '../../apps/gateway/src/lib/agent-response-contract.js';
const boundary = vi.hoisted(() => ({ execute: vi.fn(), evaluation: vi.fn() }));
vi.mock('@dmr-x/core', () => ({ ProviderUnavailableError: class extends Error { retryAfter = 0; } }));
vi.mock('@dmr-x/router', () => ({ isMetaModel: () => false,
  isInferenceSettlementError: (e: any) => e?.code === 'SETTLEMENT',
  isTrustedExternalAccounting: () => false, markTrustedExternalAccounting: (r: any) => r }));
vi.mock('@dmr-x/agent-registry', () => ({ agentRegistryService: { createEvaluation: boundary.evaluation } }));
vi.mock('../../apps/gateway/src/routes/tools.routes.js', () => ({ executeToolCall: boundary.execute }));
function call(id = 'plan', name = 'job_decompose') { return { id, type: 'function', function: { name, arguments: '{"jobId":"job-review"}' } }; }
function turn(content = '', calls: any[] = [call()]) { return { response: {
  modality: 'llm', requestId: 'review', providerId: 'review', modelId: 'review', latencyMs: 1,
  message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) },
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.01 },
  finishReason: calls.length ? 'tool_calls' : 'stop' } }; }
function args(route: any, retry = false) {
  const conversation = createInitialState('review');
  conversation.messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'Plan only' }];
  return { conversation, maxSteps: 4, model: 'free-agentic', agentTools: [], agentToolDefs: undefined,
    body: { messages: [{ role: 'user', content: 'Plan only' }] }, requestId: 'review', tenant: { id: 'review', name: 'review' }, router: { route },
    context: { instanceId: 'review', tenantId: 'review', definition: { id: 'review', name: '__receptionist', allowedTools: [] } },
    runtime: { evaluateExecution: vi.fn().mockResolvedValue({ score: 0 }), classifyProviderError: () => ({ retryable: retry, reason: 'provider_failure' }), resolveFallbackModel: () => 'free-agentic' },
    executionId: 'review-execution', stream: true, onStreamEvent: vi.fn(), buildSystemPrompt: async () => 'system',
    agentDefinition: { id: 'review', name: '__receptionist', tenantId: 'review', allowedTools: [] }, loadedSkillIds: [] } as any;
}
beforeEach(() => { vi.clearAllMocks(); boundary.execute.mockImplementation(async (tc: any) => ({ tool_call_id: tc.id, tool_name: tc.function.name, result: { jobId: 'job-review', taskCount: 2 } })); });
afterEach(() => vi.restoreAllMocks());
describe('Independent Receptionist follow-up review', () => {
  it('retains raw unevidenced provider prose only as evidence, exact prompt/completion sums, and one final stream receipt', async () => {
    const content = 'All workers finished and delivery succeeded.';
    const route = vi.fn().mockResolvedValueOnce(turn(content)).mockRejectedValue(new Error('All providers failed'));
    const a = args(route); const r = await runAgentChatLoop(a);
    expect(r.lastResponseText).not.toContain(content);
    expect(r.allSteps[0].message.content).toBe(content);
    expect(r.totalPromptTokens).toBe(5); expect(r.totalCompletionTokens).toBe(3);
    expect(r.finalUsage).toEqual(turn().response.usage);
    expect(a.onStreamEvent.mock.calls.filter(([e]: any[]) => e === 'turn')).toHaveLength(1);
    expect(a.onStreamEvent.mock.calls.filter(([e]: any[]) => e === 'tool_results')).toHaveLength(1);
    expect(a.onStreamEvent.mock.calls.filter(([e]: any[]) => e === 'final_summary')).toEqual([['final_summary', { resolvedConversationId: a.conversation.id, content: r.lastResponseText, runtimeOwned: true }]]);
    expect(agentResponseContract(r, a.conversation).status).toBe('interrupted');
    // Route-level telemetry currently preserves error status but not the specific reason.
    expect(agentExecutionTelemetry(agentResponseContract(r, a.conversation))).toEqual({ status: 'error', error: 'interrupted' });
  });
  it('preserves the original fallback settlement rejection instead of creating a partial-success receipt', async () => {
    const error = Object.assign(new Error('ledger rejected'), { code: 'SETTLEMENT' });
    const route = vi.fn().mockResolvedValueOnce(turn()).mockRejectedValueOnce(new Error('provider unavailable')).mockRejectedValueOnce(error);
    await expect(runAgentChatLoop(args(route, true))).rejects.toBe(error);
    expect(route).toHaveBeenCalledTimes(3);
  });
  it('allows successful runtime fallback to complete normally and counts its usage', async () => {
    const route = vi.fn().mockResolvedValueOnce(turn()).mockRejectedValueOnce(new Error('provider unavailable')).mockResolvedValueOnce(turn('done', []));
    const a = args(route, true); const r = await runAgentChatLoop(a);
    expect(a.conversation.status).toBe('completed');
    expect(r.lastResponseText).not.toContain('model/provider request failed');
    expect(r.totalTokensUsed).toBe(16); expect(r.allSteps).toHaveLength(2);
    expect(boundary.execute).toHaveBeenCalledTimes(1);
  });
  it('does not turn a non-coordination tool result into a Receptionist receipt', async () => {
    const error = new Error('provider unavailable');
    const route = vi.fn().mockResolvedValueOnce(turn('', [call('other', 'read_file')])).mockRejectedValueOnce(error);
    await expect(runAgentChatLoop(args(route))).rejects.toBe(error);
  });
  it('resumes the same transcript without automatically replaying previously completed coordination actions', async () => {
    const first = args(vi.fn().mockResolvedValueOnce(turn()).mockRejectedValue(new Error('provider unavailable')));
    const old = await runAgentChatLoop(first);
    const originalToolMessage = first.conversation.messages.find((m: any) => m.role === 'tool');
    const route = vi.fn().mockResolvedValueOnce(turn('Continuing without further tools.', []));
    const next = args(route);
    next.conversation = updateState(first.conversation, { status: 'in_progress', messages: [...first.conversation.messages, { role: 'user', content: 'Continue, do not repeat planning' }] });
    const r = await runAgentChatLoop(next);
    expect(boundary.execute).toHaveBeenCalledTimes(1);
    expect(route.mock.calls[0][0].messages).toContainEqual(originalToolMessage);
    expect(route.mock.calls[0][0].messages.some((m: any) => m.content === old.lastResponseText)).toBe(true);
    expect(r.totalTokensUsed).toBe(8); expect(r.allSteps).toHaveLength(1);
    expect(next.conversation.status).toBe('completed');
  });
  it('reports a timeout-owned interruption rather than stale model success when the provider failure crosses the deadline', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const falseSuccess = 'All workers finished and delivery succeeded.';
    const route = vi.fn().mockResolvedValueOnce(turn(falseSuccess)).mockImplementationOnce(async () => {
      now = 1_000_000_000;
      throw new Error('provider unavailable');
    });
    const a = args(route); const r = await runAgentChatLoop(a);
    expect(r.runTimedOut).toBe(true); expect(a.conversation.status).toBe('interrupted');
    expect(a.runtime.evaluateExecution.mock.calls[0][1].error).toBe('run_timeout');
    expect(r.allSteps[0].message.content).toBe(falseSuccess);
    expect(r.allSteps[0].tool_results[0].result).toEqual({ jobId: 'job-review', taskCount: 2 });
    expect(r.totalTokensUsed).toBe(8);
    // Regression: the timeout precedence gate currently suppresses the receipt,
    // leaving the unevidenced earlier provider success as final content.
    expect(r.lastResponseText).not.toBe(falseSuccess);
    expect(r.lastResponseText).toMatch(/interrupted|timed out/i);
  });
});
