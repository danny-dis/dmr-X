import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInitialState } from '../../../packages/utils/src/conversation-state.js';
import { runAgentChatLoop, processApprovalDecisions } from '../../../apps/gateway/src/routes/agent-chat-loop.js';
const boundary = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@dmr-x/core', () => ({ ProviderUnavailableError: class extends Error { retryAfter = 0; } }));
vi.mock('@dmr-x/router', () => ({ isMetaModel: () => false, isInferenceSettlementError: () => false,
 isTrustedExternalAccounting: () => false, markTrustedExternalAccounting: (r: any) => r }));
vi.mock('@dmr-x/agent-registry', () => ({ agentRegistryService: { createEvaluation: vi.fn() } }));
vi.mock('../../../apps/gateway/src/routes/tools.routes.js', () => ({ executeToolCall: boundary.execute }));
const call = (id: string, name = 'read_job_board', args = { jobId: 'edge-job' }) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
function turn(calls: any[] = [], content = 'done', finishReason = calls.length ? 'tool_calls' : 'stop') {
 return { response: { modality: 'llm', requestId: 'edge', providerId: 'edge', modelId: 'edge', latencyMs: 1,
 message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) },
 usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.01 }, finishReason } };
}
function args(route: any) {
 const conversation = createInitialState('edge-conversation');
 conversation.messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'Do the task' }];
 return { conversation, maxSteps: 5, model: 'free-agentic', agentTools: [], agentToolDefs: undefined,
 body: { messages: [{ role: 'user', content: 'Do the task' }] }, requestId: 'edge', tenant: { id: 'edge', name: 'edge' }, router: { route },
 context: { instanceId: 'edge', tenantId: 'edge', definition: { id: 'edge', name: 'ordinary', allowedTools: [] } },
 runtime: { evaluateExecution: vi.fn(), classifyProviderError: () => ({ retryable: false, reason: 'provider_failure' }), resolveFallbackModel: () => null },
 stream: false, onStreamEvent: vi.fn(), buildSystemPrompt: async () => 'system',
 agentDefinition: { id: 'edge', name: 'ordinary', tenantId: 'edge', allowedTools: [] }, loadedSkillIds: [] } as any;
}
// Protocol validator counts whole assistant/tool exchange groups; cannot bless orphan tool messages.
function protocolErrors(messages: any[]) {
 const errors: string[] = []; let pending: string[] = [];
 for (const m of messages) {
  if (m.role === 'tool') {
   if (!pending.includes(m.tool_call_id)) errors.push(`orphan:${m.tool_call_id}`);
   else pending.splice(pending.indexOf(m.tool_call_id), 1);
  } else {
   if (pending.length) errors.push(`unpaired:${pending.join(',')}`);
   pending = (m.tool_calls ?? []).map((tc: any) => tc.id);
  }
 }
 if (pending.length) errors.push(`unpaired:${pending.join(',')}`);
 return errors;
}
function paused(ids = ['a']) {
 const state = createInitialState('approval-edge'); const calls = ids.map(id => call(id, 'write_file'));
 state.status = 'awaiting_approval';
 state.messages = [{ role: 'assistant', content: '', tool_calls: calls }];
 state.pendingToolCalls = calls.map(tc => ({ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments) }));
 return state;
}
const approvalContext = { requestId: 'approval-edge', agentDefinition: { id: 'edge', name: 'ordinary', tenantId: 'edge', allowedTools: [] } };
beforeEach(() => {
 vi.clearAllMocks(); vi.stubEnv('DMRX_AGENT_TOOL_DEDUPE', 'true');
 boundary.execute.mockImplementation(async (tc: any) => ({ tool_call_id: tc.id, tool_name: tc.function.name, result: { ok: true } }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('mutable reads and bounded cross-turn dedupe', () => {
 it('executes a fresh board read after a recorded job mutation instead of replaying stale state', async () => {
  let status = 'ready';
  boundary.execute.mockImplementation(async (tc: any) => {
   if (tc.function.name === 'job_start') status = 'running';
   return { tool_call_id: tc.id, tool_name: tc.function.name, result: { status } };
  });
  const route = vi.fn().mockResolvedValueOnce(turn([call('before')], ''))
   .mockResolvedValueOnce(turn([call('start', 'job_start')], ''))
   .mockResolvedValueOnce(turn([call('after')], '')).mockResolvedValueOnce(turn());
  const r = await runAgentChatLoop(args(route));
  expect(r.allSteps[0].tool_results[0].result).toEqual({ status: 'ready' });
  expect(r.allSteps[2].tool_results[0].result).toEqual({ status: 'running' });
  expect(boundary.execute.mock.calls.filter(([tc]: any[]) => tc.function.name === 'read_job_board')).toHaveLength(2);
  expect(r.allSteps[2].tool_results[0].deduped).toBeUndefined();
 });
 it('control: identical writes within one run still execute once and pair every ID', async () => {
  const route = vi.fn().mockResolvedValueOnce(turn([call('w1','write_file')], ''))
   .mockResolvedValueOnce(turn([call('w2','write_file')], '')).mockResolvedValueOnce(turn());
  const a = args(route); const r = await runAgentChatLoop(a);
  expect(boundary.execute).toHaveBeenCalledTimes(1);
  expect(r.allSteps[1].tool_results[0]).toMatchObject({ deduped: 'cross_turn', deduped_from: 'w1' });
  expect(protocolErrors(a.conversation.messages)).toEqual([]);
 });
});
describe('history compaction exchange boundary', () => {
 it('keeps complete tool exchanges when the eight-message tail starts inside an assistant/tool pair', async () => {
  const chatRequests: any[][] = [];
  let chats = 0;
  const route = vi.fn(async (request: any, target: any) => {
   if (target.path === '/v1/agents/compact') return turn([], 'Factual summary');
   chatRequests.push(structuredClone(request.messages));
   return chats++ === 0 ? turn([call('new')], '') : turn();
  });
  const a = args(route); a.context.definition.historyCompaction = true;
  for (let i = 0; i < 11; i++) {
   a.conversation.messages.push(turn([call(`old-${i}`)], '').response.message);
   a.conversation.messages.push({ role: 'tool', tool_call_id: `old-${i}`, content: '{}'});
  }
  a.conversation.messages.push({ role: 'user', content: 'Continue' });
  expect(protocolErrors(a.conversation.messages)).toEqual([]);
  await runAgentChatLoop(a);
  expect(route.mock.calls.some(([,target]: any[]) => target.path === '/v1/agents/compact')).toBe(true);
  expect(chatRequests).toHaveLength(2);
  expect(protocolErrors(chatRequests[1])).toEqual([]);
 });
});
describe('approval decision idempotency and incomplete batches', () => {
 it('executes a duplicated approved decision only once for the same pending call ID', async () => {
  const state = paused();
  await processApprovalDecisions(state, [{ tool_call_id:'a',approved:true },{ tool_call_id:'a',approved:true }], approvalContext);
  expect(boundary.execute).toHaveBeenCalledTimes(1);
  expect(state.messages.filter(m => m.role === 'tool')).toHaveLength(1);
 });
 it('does not clear an undecided call or expose an unpaired transcript after partial approval', async () => {
  const state = paused(['a','b']);
  await processApprovalDecisions(state, [{ tool_call_id:'a',approved:true }], approvalContext);
  expect(state.status).toBe('awaiting_approval');
  expect(state.pendingToolCalls?.map(tc => tc.id)).toEqual(['b']);
 });
 it('does not reexecute a successful first approval when the second handler rejects and the batch resumes', async () => {
  const state = paused(['a','b']); let fail = true;
  boundary.execute.mockImplementation(async (tc: any) => {
   if (tc.id === 'b' && fail) throw new Error('handler connection lost');
   return { tool_call_id: tc.id, tool_name: tc.function.name, result: { ok:true } };
  });
  const decisions = [{tool_call_id:'a',approved:true},{tool_call_id:'b',approved:true}];
  await expect(processApprovalDecisions(state, decisions, approvalContext)).rejects.toThrow('handler connection lost');
  fail = false; await processApprovalDecisions(state, decisions, approvalContext);
  expect(boundary.execute.mock.calls.filter(([tc]: any[]) => tc.id === 'a')).toHaveLength(1);
  expect(protocolErrors(state.messages)).toEqual([]);
 });
 it('control: a settled batch is a no-op if the same decisions are delivered again', async () => {
  const state = paused(); const decisions = [{ tool_call_id:'a',approved:true }];
  await processApprovalDecisions(state, decisions, approvalContext);
  expect(await processApprovalDecisions(state, decisions, approvalContext)).toEqual({ processed:false });
  expect(boundary.execute).toHaveBeenCalledTimes(1);
 });
 it('pairs blocked IDs when resuming the allowed part of an approval-gated exchange', async () => {
  const route = vi.fn().mockResolvedValueOnce(turn([call('blocked','forbidden'),call('allowed','write_file')],''));
  const a = args(route); a.agentTools=['write_file']; a.approvalRequired=true;
  await runAgentChatLoop(a);
  await processApprovalDecisions(a.conversation,[{tool_call_id:'allowed',approved:true}],approvalContext);
  expect(protocolErrors(a.conversation.messages)).toEqual([]);
  expect(boundary.execute).toHaveBeenCalledTimes(1);
 });
});
describe('terminal caps preserve nonexecution and resumable protocol', () => {
 it('pairs calls stopped by a composable step_count limit without executing or claiming completion', async () => {
  const a=args(vi.fn().mockResolvedValueOnce(turn([call('stopped','write_file')],'')));
  a.stopWhen=[{type:'step_count',value:1}];
  const r=await runAgentChatLoop(a);
  expect(boundary.execute).not.toHaveBeenCalled();
  expect(protocolErrors(a.conversation.messages)).toEqual([]);
  expect(a.conversation.status).toBe('interrupted');
  expect(r.allSteps[0].tool_results).toEqual([]);
 });
 it('pairs calls withheld by a cost budget without fabricating execution evidence', async () => {
  const a=args(vi.fn().mockResolvedValueOnce(turn([call('budget','write_file')],'')));
  a.body.max_cost_budget=0.005;
  const r=await runAgentChatLoop(a);
  expect(r.budgetExceeded).toBe(true); expect(boundary.execute).not.toHaveBeenCalled();
  expect(protocolErrors(a.conversation.messages)).toEqual([]);
  expect(a.conversation.status).toBe('interrupted');
 });
 it('pairs tool IDs on a truncated tool-use response instead of leaving orphan pending calls', async () => {
  const a=args(vi.fn().mockResolvedValueOnce(turn([call('truncated','write_file')],'','length')));
  await runAgentChatLoop(a);
  expect(boundary.execute).not.toHaveBeenCalled();
  expect(protocolErrors(a.conversation.messages)).toEqual([]);
  expect(a.conversation.status).toBe('interrupted');
 });
 it('control: maxSteps=1 remains an interrupted zero-execution receipt with paired pending calls', async () => {
  const a=args(vi.fn().mockResolvedValueOnce(turn([call('cap','write_file')],''))); a.maxSteps=1;
  const r=await runAgentChatLoop(a);
  expect(boundary.execute).not.toHaveBeenCalled(); expect(a.conversation.status).toBe('interrupted');
  expect(protocolErrors(a.conversation.messages)).toEqual([]); expect(r.allSteps[0].tool_results).toEqual([]);
  expect(r.lastResponseText).toContain('not executed');
 });
});
