import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInitialState } from '../../packages/utils/src/conversation-state.js';
import { runAgentChatLoop } from '../../apps/gateway/src/routes/agent-chat-loop.js';

// Only external boundaries are replaced: the actual loop, state and stop conditions run.
const boundary = vi.hoisted(() => ({ execute: vi.fn(), evaluation: vi.fn() }));
vi.mock('@dmr-x/core', () => ({ ProviderUnavailableError: class extends Error {} }));
vi.mock('@dmr-x/router', () => ({
 isMetaModel: () => false, isInferenceSettlementError: () => false,
 isTrustedExternalAccounting: () => false, markTrustedExternalAccounting: (r: any) => r,
}));
vi.mock('@dmr-x/agent-registry', () => ({ agentRegistryService: { createEvaluation: boundary.evaluation } }));
vi.mock('../../apps/gateway/src/routes/tools.routes.js', () => ({ executeToolCall: boundary.execute }));

function response(content: string | null, finishReason = 'stop', calls: any[] = []) {
 return { modality: 'llm', requestId: 'fixture', providerId: 'fixture', modelId: 'fixture', latencyMs: 1,
 message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) },
 usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.01 }, finishReason };
}
function call(id: string) { return { id, type: 'function', function: { name: 'write_file', arguments: '{"path":"proof.txt","content":"partial"}' } }; }
function args(route: any, overrides: any = {}) {
 const conversation = createInitialState('terminal-truth');
 conversation.messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'write then read and run' }];
 return { conversation, maxSteps: 3, model: 'fixture', agentTools: [], agentToolDefs: undefined,
 body: { messages: [{ role: 'user', content: 'write then read and run' }] }, requestId: 'fixture',
 tenant: { id: 'fixture', name: 'fixture' }, router: { route },
 context: { instanceId: 'fixture', tenantId: 'fixture', definition: { id: 'fixture', name: 'fixture', allowedTools: [] } },
 runtime: { evaluateExecution: vi.fn().mockResolvedValue({ score: 0 }) }, executionId: 'execution-fixture',
 stream: false, onStreamEvent: vi.fn(), buildSystemPrompt: async () => 'system',
 agentDefinition: { id: 'fixture', name: 'fixture', tenantId: 'fixture', allowedTools: [] }, loadedSkillIds: [], ...overrides } as any;
}

beforeEach(() => {
 vi.clearAllMocks();
 boundary.execute.mockImplementation(async (tc: any) => ({ tool_call_id: tc.id, tool_name: tc.function.name, result: { written: true, path: 'proof.txt' } }));
});
afterEach(() => vi.restoreAllMocks());


describe('Receptionist evidence-owned final receipt',()=>{
 it('does not publish model success prose after real coordination tool error',async()=>{
  const tc={id:'plan',type:'function',function:{name:'job_decompose',arguments:'{"jobId":"job-fixture"}'}};
  boundary.execute.mockResolvedValue({tool_call_id:'plan',tool_name:'job_decompose',result:{error:'empty JSON'}});
  const route=vi.fn().mockResolvedValueOnce({response:response('', 'tool_calls',[tc])}).mockResolvedValueOnce({response:response('All tasks successfully assigned and completed.')});
  const a=args(route,{agentDefinition:{id:'fixture',name:'__receptionist',tenantId:'fixture',allowedTools:[]}});
  const r=await runAgentChatLoop(a);
  expect(r.lastResponseText).not.toContain('All tasks successfully assigned');
  expect(r.lastResponseText).toContain('job_decompose: failed');
  expect(a.conversation.status).toBe('interrupted');
  expect(r.allSteps[1].message.content).toContain('All tasks successfully assigned');
  expect(route).toHaveBeenCalledTimes(2);expect(r.totalTokensUsed).toBe(16);
  expect(a.runtime.evaluateExecution.mock.calls[0][1].status).toBe('error');
 });
});

describe('provider truncation preserves partial evidence', () => {
 it.each(['Partial Kiswahili: Nimeanza kueleza', ''])('interrupts a length-finished text reply (%s) without forced recovery', async (content) => {
  const route = vi.fn().mockResolvedValueOnce({ response: response(content, 'length') });
  const a = args(route);
  const result = await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('interrupted');
  expect(route).toHaveBeenCalledTimes(1);
  expect(result.allSteps).toHaveLength(1);
  expect(result.allSteps[0].message.content).toBe(content);
  expect(result.lastResponseText).toBe(content || '[dmr-x] No agent output produced: the model reply was truncated.');
  expect(result.totalTokensUsed).toBe(8);
  expect(a.runtime.evaluateExecution.mock.calls[0][1]).toMatchObject({ status: 'error', error: 'response_truncated' });
 });
 it('never executes potentially incomplete tool arguments from a length-finished reply', async () => {
  const tc = call('truncated');
  tc.function.arguments = '{"path":"proof';
  const route = vi.fn().mockResolvedValueOnce({ response: response('Partial tool plan.', 'length', [tc]) })
   .mockResolvedValueOnce({ response: response('Unexpected continued reply') });
  const a = args(route);
  const result = await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('interrupted');
  expect(boundary.execute).not.toHaveBeenCalled();
  expect(route).toHaveBeenCalledTimes(1);
  expect(result.allSteps[0].tool_calls).toEqual([tc]);
  expect(result.lastResponseText).toBe('Partial tool plan.');
 });
 it('does not promote a truncated empty-reply recovery to completion', async () => {
  const route = vi.fn().mockResolvedValueOnce({ response: response('<thought>hidden</thought>') })
   .mockResolvedValueOnce({ response: response('Useful but cut off', 'length') });
  const a = args(route);
  const result = await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('interrupted');
  expect(result.lastResponseText).toBe('Useful but cut off');
  expect(result.allSteps).toHaveLength(2);
  expect(result.totalTokensUsed).toBe(16);
  expect(a.runtime.evaluateExecution.mock.calls[0][1].error).toBe('response_truncated');
 });
});

describe('deadline and repeated-call progress', () => {
 it('does not spend a summary completion after the last tool-call response crosses the deadline', async () => {
  let now = 0;
  const route = vi.fn().mockImplementationOnce(async () => {
   now = 1_000_000_000;
   return { response: response('', 'tool_calls', [call('pending')]) };
  }).mockResolvedValueOnce({ response: response('Late summary') });
  const a = args(route, { maxSteps: 1 });
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const result = await runAgentChatLoop(a);
  expect(route).toHaveBeenCalledTimes(1);
  expect(result.runTimedOut).toBe(true);
  expect(a.conversation.status).toBe('interrupted');
  expect(result.allSteps).toHaveLength(1);
  expect(a.runtime.evaluateExecution.mock.calls[0][1].error).toBe('run_timeout');
 });
 it('adds one generic progress nudge for consecutive all-deduped turns without extra execution', async () => {
  const seen: any[] = [];
  const turns = [response('', 'tool_calls', [call('first')]), response('', 'tool_calls', [call('repeat')]), response('', 'tool_calls', [call('again')]), response('Partial findings only')];
  const route = vi.fn().mockImplementation(async (req: any) => {
   seen.push(structuredClone(req.messages));
   return { response: turns.shift() };
  });
  const a = args(route, { maxSteps: 5 });
  const result = await runAgentChatLoop(a);
  const nudges = (ms: any[]) => ms.filter(m => m.role === 'system' && m.content.includes('No new tool execution'));
  expect(nudges(seen[2])).toHaveLength(1);
  expect(nudges(seen[3])).toHaveLength(1);
  expect(nudges(seen[2])[0].content).toMatch(/unfinished/);
  expect(nudges(seen[2])[0].content).not.toContain('write_file');
  expect(seen[2].findIndex((m: any) => m.tool_call_id === 'repeat')).toBeLessThan(seen[2].findIndex((m: any) => m.content.includes('No new tool execution')));
  expect(boundary.execute).toHaveBeenCalledTimes(1);
  expect(result.allSteps[2].tool_results[0].deduped).toBe('cross_turn');
  expect(route).toHaveBeenCalledTimes(4);
 });
 it('retains direct completion, approval and budget precedence', async () => {
  for (const mode of ['direct', 'approval', 'budget']) {
   const route = vi.fn().mockResolvedValue({ response: mode === 'direct' ? response('Direct answer') : response('', 'tool_calls', [call('first')]) });
   const a = args(route, mode === 'approval' ? { approvalRequired: true } : mode === 'budget' ? { body: { messages: [], max_cost_budget: 0.005 } } : {});
   const result = await runAgentChatLoop(a);
   expect(route).toHaveBeenCalledTimes(1);
   if (mode === 'direct') { expect(a.conversation.status).toBe('completed'); expect(result.lastResponseText).toBe('Direct answer'); }
   if (mode === 'approval') { expect(a.conversation.status).toBe('awaiting_approval'); expect(result.awaitingApproval).toBe(true); }
   if (mode === 'budget') { expect(result.budgetExceeded).toBe(true); expect(a.runtime.evaluateExecution.mock.calls[0][1].error).toBe('budget_exceeded'); }
  }
 });
});

const STEP_LIMIT_RECEIPT = '[dmr-x] Run interrupted: the tool-use step limit was reached. The final requested tool calls were not executed. Earlier model output and actual tool results remain in all_steps; pending calls are not proof of completed work.';
const STEP_LIMIT_REJECTION = { executed: false, error: 'Tool call was not executed because the run reached its step limit.' };

// Validate the durable transcript as the next provider request would see it.
function expectPairedToolCalls(messages: any[]) {
 for (let i = 0; i < messages.length; i++) {
  if (messages[i].role !== 'assistant' || !messages[i].tool_calls?.length) continue;
  const ids = messages[i].tool_calls.map((tc: any) => tc.id);
  const replies: string[] = [];
  for (let j = i + 1; j < messages.length && messages[j].role === 'tool'; j++) replies.push(messages[j].tool_call_id);
  expect(replies).toEqual(ids);
 }
}

describe('terminal truth at agent-loop step caps', () => {
 it('retains actual and cached evidence with exact pending calls, without auxiliary inference', async () => {
  const pending = call('pending');
  const route = vi.fn()
   .mockResolvedValueOnce({ response: response('', 'tool_calls', [call('first')]) })
   .mockResolvedValueOnce({ response: response('', 'tool_calls', [call('repeat')]) })
   .mockResolvedValueOnce({ response: response('', 'tool_calls', [pending]) })
   .mockResolvedValueOnce({ response: response('The file was written and read; stdout: success.') });
  const a = args(route);
  const result = await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('interrupted');
  expect(result.lastResponseText).toBe(STEP_LIMIT_RECEIPT);
  expect(result.allSteps).toHaveLength(3);
  expect(result.stepsCompleted).toBe(3);
  expect(result.allSteps[0].tool_results[0].result).toEqual({ written: true, path: 'proof.txt' });
  expect(result.allSteps[1].tool_results[0]).toEqual({ ...result.allSteps[0].tool_results[0], tool_call_id: 'repeat', deduped: 'cross_turn', deduped_from: 'first' });
  expect(result.allSteps[2].tool_calls).toEqual([pending]);
  expect(result.allSteps[2].tool_results).toEqual([]);
  expect(boundary.execute).toHaveBeenCalledTimes(1);
  expect(result.totalTokensUsed).toBe(24);
  expect(result.totalPromptTokens).toBe(15);
  expect(result.totalCompletionTokens).toBe(9);
  expect(result.totalCost).toBeCloseTo(0.03);
  expect(result.finalUsage).toEqual(response('').usage);
  expect(route).toHaveBeenCalledTimes(3);
  expect(a.conversation.messages.filter((m: any) => m.role === 'assistant')).toHaveLength(3);
  expect(a.conversation.messages.filter((m: any) => m.role === 'assistant').map((m: any) => m.tool_calls)).toEqual([[call('first')], [call('repeat')], [pending]]);
  expectPairedToolCalls(a.conversation.messages);
  expect(JSON.parse(a.conversation.messages.at(-1).content)).toEqual(STEP_LIMIT_REJECTION);
  expect(a.runtime.evaluateExecution.mock.calls[0][1]).toMatchObject({ status: 'error', error: 'step_limit', output: STEP_LIMIT_RECEIPT });
  expect(boundary.evaluation.mock.calls[0][1].status).toBe('error');
 });
 it('retains useful partial prose only as raw evidence, not the authoritative receipt', async () => {
  const content = 'Partial finding: write planned.';
  const pending = call('pending');
  const route = vi.fn().mockResolvedValueOnce({ response: response(content, 'tool_calls', [pending]) });
  const a = args(route, { maxSteps: 1 });
  const result = await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('interrupted');
  expect(result.lastResponseText).toBe(STEP_LIMIT_RECEIPT);
  expect(result.allSteps[0].message.content).toBe(content);
  expect(result.allSteps[0].tool_calls).toEqual([pending]);
  expect(result.allSteps[0].tool_results).toEqual([]);
  expect(a.conversation.messages.find((m: any) => m.role === 'assistant').content).toBe(content);
  expect(route).toHaveBeenCalledTimes(1);
  expect(boundary.execute).not.toHaveBeenCalled();
 });
 it('does not call an unavailable summary provider at the hard cap', async () => {
  const route = vi.fn().mockResolvedValueOnce({ response: response('', 'tool_calls', [call('pending')]) }).mockRejectedValueOnce(new Error('summary unavailable'));
  const a = args(route, { maxSteps: 1 });
  const result = await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('interrupted');
  expect(result.lastResponseText).toBe(STEP_LIMIT_RECEIPT);
  expect(result.allSteps[0].tool_calls).toEqual([call('pending')]);
  expect(route).toHaveBeenCalledTimes(1);
 });
 it.each(['', 'File created and read back. stdout: success, exitCode: 0.'])('never promotes unevidenced model success into final content (%s)', async (content) => {
  const pending = call('unexecuted');
  const route = vi.fn().mockResolvedValueOnce({ response: response(content, 'tool_calls', [pending]) })
   .mockResolvedValueOnce({ response: response('File written and read successfully. stdout: success.') });
  const a = args(route, { maxSteps: 1 });
  const result = await runAgentChatLoop(a);
  expect.soft(route).toHaveBeenCalledTimes(1);
  expect(result.lastResponseText).toBe(STEP_LIMIT_RECEIPT);
  expect(a.conversation.status).toBe('interrupted');
  expect(route).toHaveBeenCalledTimes(1);
  expect(boundary.execute).not.toHaveBeenCalled();
  expect(result.allSteps).toHaveLength(1);
  expect(result.allSteps[0].message.content).toBe(content);
  expect(result.allSteps[0].tool_calls).toEqual([pending]);
  expect(result.allSteps[0].tool_results).toEqual([]);
  expect(a.conversation.messages.find((m: any) => m.role === 'assistant').content).toBe(content);
  expect(result.totalTokensUsed).toBe(8);
  expect(result.totalCost).toBeCloseTo(0.01);
  expect(a.runtime.evaluateExecution.mock.calls[0][1]).toMatchObject({ status: 'error', error: 'step_limit', output: STEP_LIMIT_RECEIPT });
 });
 it('pairs every pending ID with explicit nonexecution so future requests have no orphan calls', async () => {
  const pending = [call('pending-one'), call('pending-two')];
  const route = vi.fn().mockResolvedValueOnce({ response: response('File created.', 'tool_calls', pending) });
  const a = args(route, { maxSteps: 1 });
  const result = await runAgentChatLoop(a);
  expectPairedToolCalls(a.conversation.messages);
  const rejections = a.conversation.messages.filter((m: any) => m.role === 'tool');
  expect(rejections.map((m: any) => m.tool_call_id)).toEqual(pending.map(tc => tc.id));
  for (const m of rejections) expect(JSON.parse(m.content)).toEqual(STEP_LIMIT_REJECTION);
  expect(result.allSteps).toHaveLength(1);
  expect(result.allSteps[0].tool_calls).toEqual(pending);
  expect(result.allSteps[0].tool_results).toEqual([]);
  expect(boundary.execute).not.toHaveBeenCalled();
  expect(a.conversation.status).toBe('interrupted');
  expect(route).toHaveBeenCalledTimes(1);
 });
 it('streams the deterministic receipt without a synthetic provider step or assistant message', async () => {
  const route = vi.fn().mockResolvedValueOnce({ response: response('', 'tool_calls', [call('pending')]) })
   .mockResolvedValueOnce({ response: response('Invented streaming success') });
  const a = args(route, { maxSteps: 1, stream: true });
  const result = await runAgentChatLoop(a);
  const summaries = a.onStreamEvent.mock.calls.filter(([event]: any[]) => event === 'final_summary');
  expect(summaries).toEqual([['final_summary', { resolvedConversationId: a.conversation.id, content: STEP_LIMIT_RECEIPT }]]);
  expect(result.lastResponseText).toBe(STEP_LIMIT_RECEIPT);
  expect(result.allSteps).toHaveLength(1);
  expect(result.stepsCompleted).toBe(1);
  expect(result.allSteps[0].tool_results).toEqual([]);
  expect(a.conversation.messages.filter((m: any) => m.role === 'assistant')).toHaveLength(1);
  expect(a.conversation.messages.some((m: any) => m.content === STEP_LIMIT_RECEIPT)).toBe(false);
  expectPairedToolCalls(a.conversation.messages);
  expect(result.totalTokensUsed).toBe(8);
  expect(result.totalPromptTokens).toBe(5);
  expect(result.totalCompletionTokens).toBe(3);
  expect(result.totalCost).toBeCloseTo(0.01);
  expect(route).toHaveBeenCalledTimes(1);
  expect(boundary.execute).not.toHaveBeenCalled();
 });
});
