import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInitialState } from '../../packages/utils/src/conversation-state.js';
import { runAgentChatLoop } from '../../apps/gateway/src/routes/agent-chat-loop.js';
const boundary = vi.hoisted(() => ({ execute: vi.fn(), evaluation: vi.fn() }));
vi.mock('@dmr-x/core', () => ({ ProviderUnavailableError: class extends Error {} }));
vi.mock('@dmr-x/router', () => ({ isMetaModel: () => false,
 isInferenceSettlementError: (e: any) => e?.code === 'SETTLEMENT',
 isTrustedExternalAccounting: () => false, markTrustedExternalAccounting: (r: any) => r }));
vi.mock('@dmr-x/agent-registry', () => ({ agentRegistryService: { createEvaluation: boundary.evaluation } }));
vi.mock('../../apps/gateway/src/routes/tools.routes.js', () => ({ executeToolCall: boundary.execute }));
const tc = { id: 'plan', type: 'function', function: { name: 'job_decompose', arguments: '{"jobId":"job-proof"}' } };
const toolTurn = { response: { modality: 'llm', requestId: 'proof', providerId: 'proof', modelId: 'proof', latencyMs: 1,
 message: { role: 'assistant', content: '', tool_calls: [tc] },
 usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, cost: 0.01 }, finishReason: 'tool_calls' } };
function args(route: any, stream = false, name = '__receptionist', retry = false) {
 const conversation = createInitialState('provider-proof');
 conversation.messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'Plan only' }];
 return { conversation, maxSteps: 4, model: 'free-agentic', agentTools: [], agentToolDefs: undefined,
 body: { messages: [{ role: 'user', content: 'Plan only' }] }, requestId: 'proof', tenant: { id: 'proof', name: 'proof' }, router: { route },
 context: { instanceId: 'proof', tenantId: 'proof', definition: { id: 'proof', name, allowedTools: [] } },
 runtime: { evaluateExecution: vi.fn().mockResolvedValue({ score: 0 }), classifyProviderError: () => ({ retryable: retry, reason: 'provider_failure' }), resolveFallbackModel: () => 'free-agentic' },
 executionId: 'execution-proof', stream, onStreamEvent: vi.fn(), buildSystemPrompt: async () => 'system',
 agentDefinition: { id: 'proof', name, tenantId: 'proof', allowedTools: [] }, loadedSkillIds: [] } as any;
}
beforeEach(() => { vi.clearAllMocks(); boundary.execute.mockResolvedValue({ tool_call_id: 'plan', tool_name: 'job_decompose', result: { jobId: 'job-proof', taskCount: 2 } }); });


describe('provider-valid tool transcript regression', () => {
 it('pairs blocked calls without executing them or reporting fabricated execution rows', async()=>{
  const blocked={id:'blocked',type:'function',function:{name:'forbidden',arguments:'{}'}};
  const route=vi.fn().mockResolvedValueOnce({response:{...toolTurn.response,message:{role:'assistant',content:'',tool_calls:[blocked,tc]}}}).mockImplementationOnce(async(request:any)=>{
   const assistant=request.messages.findIndex((m:any)=>m.role==='assistant');
   expect(request.messages[assistant].tool_calls).toEqual([blocked,tc]);
   expect(request.messages.slice(assistant+1,assistant+3).map((m:any)=>m.tool_call_id)).toEqual(['blocked','plan']);
   expect(JSON.parse(request.messages[assistant+1].content)).toMatchObject({executed:false});
   return {response:{...toolTurn.response,message:{role:'assistant',content:'Only allowed action recorded'},finishReason:'stop'}};
  });
  const a=args(route);a.agentTools=['job_decompose'];const result=await runAgentChatLoop(a);
  expect(boundary.execute).toHaveBeenCalledTimes(1);expect(result.allSteps[0].tool_results).toHaveLength(1);
  expect(result.allSteps[0].tool_results[0].tool_name).toBe('job_decompose');
 });
 it('pairs a rejected handler with an unknown-outcome error, never a successful result',async()=>{
  boundary.execute.mockRejectedValue(new Error('handler dropped connection'));
  const route=vi.fn().mockResolvedValueOnce(toolTurn).mockImplementationOnce(async(request:any)=>{
   const index=request.messages.findIndex((m:any)=>m.role==='tool');
   expect(request.messages[index-1].tool_calls).toEqual([tc]);
   expect(JSON.parse(request.messages[index].content).error).toContain('Outcome is unknown');
   return {response:{...toolTurn.response,message:{role:'assistant',content:'Everything delivered successfully'},finishReason:'stop'}};
  });
  const a=args(route);const result=await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('interrupted');expect(result.lastResponseText).toContain('job_decompose: failed');
  expect(result.allSteps[0].tool_results[0]).toMatchObject({tool_call_id:'plan',result:null,error:{message:expect.stringContaining('unknown')}});
 });

 it('retains the assistant function call before its result on the next provider request and checkpoint', async () => {
  const route=vi.fn().mockResolvedValueOnce(toolTurn).mockImplementationOnce(async (request: any) => {
   const toolIndex=request.messages.findIndex((m: any)=>m.role==='tool');
   expect(toolIndex).toBeGreaterThan(0);
   expect(request.messages[toolIndex-1]).toMatchObject({role:'assistant',tool_calls:[tc]});
   return {response:{...toolTurn.response,message:{role:'assistant',content:'Done'},finishReason:'stop'}};
  });
  const a=args(route,false,'ordinary-agent');a.onCheckpoint=vi.fn();
  const result=await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('completed');expect(result.lastResponseText).toBe('Done');
  const first=a.onCheckpoint.mock.calls[0][1].messages;
  const index=first.findIndex((m:any)=>m.role==='tool');expect(first[index-1].tool_calls).toEqual([tc]);
  expect(boundary.execute).toHaveBeenCalledTimes(1);
 });
 it('keeps error reflection after the paired assistant/tool exchange', async()=>{
  boundary.execute.mockResolvedValue({tool_call_id:'plan',tool_name:'job_decompose',error:{message:'bad fixture'}});
  const route=vi.fn().mockResolvedValueOnce(toolTurn).mockImplementationOnce(async(request:any)=>{
   const index=request.messages.findIndex((m:any)=>m.role==='tool');
   expect(request.messages[index-1]).toMatchObject({role:'assistant',tool_calls:[tc]});
   const reflection=request.messages.findIndex((m:any)=>m.role==='system'&&m.content.includes('TOOL EXECUTION ERROR'));
   expect(reflection).toBeGreaterThan(index);
   return {response:{...toolTurn.response,message:{role:'assistant',content:'Tool failed'},finishReason:'stop'}};
  });
  const a=args(route,false,'ordinary-agent');await runAgentChatLoop(a);expect(route).toHaveBeenCalledTimes(2);
 });
});

describe('Receptionist recorded actions survive a failed provider follow-up', () => {
 it.each([false, true])('returns an interrupted runtime receipt with exact prior usage/evidence (stream=%s)', async stream => {
  const route = vi.fn().mockResolvedValueOnce(toolTurn).mockRejectedValue(new Error('All providers failed'));
  const a = args(route, stream); const result = await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('interrupted');
  expect(result.lastResponseText).toContain('model/provider request failed');
  expect(result.lastResponseText).toContain('job_decompose: recorded (job job-proof, 2 tasks)');
  expect(result.lastResponseText).not.toContain('delivered successfully');
  expect(result.allSteps).toHaveLength(1); expect(result.stepsCompleted).toBe(1);
  expect(result.allSteps[0].tool_results[0].result).toEqual({ jobId: 'job-proof', taskCount: 2 });
  expect(result.totalTokensUsed).toBe(8); expect(result.totalCost).toBe(0.01);
  expect(route).toHaveBeenCalledTimes(2); expect(boundary.execute).toHaveBeenCalledTimes(1);
  expect(a.runtime.evaluateExecution.mock.calls[0][1]).toMatchObject({ status: 'error', error: 'provider_failure' });
  expect(boundary.evaluation.mock.calls[0][1].status).toBe('error');
  expect(a.conversation.messages.some((m: any) => m.role === 'tool' && m.tool_call_id === 'plan')).toBe(true);
  if(stream) expect(a.onStreamEvent).toHaveBeenCalledWith('final_summary', expect.objectContaining({ content: result.lastResponseText, runtimeOwned: true }));
 });
 it('handles failure of the permitted runtime fallback without losing successful tool evidence', async () => {
  const route = vi.fn().mockResolvedValueOnce(toolTurn).mockRejectedValue(new Error('All providers failed'));
  const a = args(route, false, '__receptionist', true); const result = await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('interrupted'); expect(result.lastResponseText).toContain('job_decompose: recorded');
  expect(route).toHaveBeenCalledTimes(3); expect(result.totalTokensUsed).toBe(8); expect(boundary.execute).toHaveBeenCalledTimes(1);
 });
 it('retains failed tool receipts as failures too', async () => {
  boundary.execute.mockResolvedValue({ tool_call_id: 'plan', tool_name: 'job_decompose', result: { error: 'planner unavailable', jobId: 'job-proof' } });
  const route=vi.fn().mockResolvedValueOnce(toolTurn).mockRejectedValue(new Error('All providers failed'));
  const a=args(route); const result=await runAgentChatLoop(a);
  expect(a.conversation.status).toBe('interrupted'); expect(result.lastResponseText).toContain('job_decompose: failed'); expect(result.totalTokensUsed).toBe(8);
 });
 it('does not reinterpret inference settlement errors as provider failure', async () => {
  const error=Object.assign(new Error('settlement rejected'), { code: 'SETTLEMENT' });
  const route=vi.fn().mockResolvedValueOnce(toolTurn).mockRejectedValue(error);
  await expect(runAgentChatLoop(args(route))).rejects.toBe(error);
 });
 it('leaves ordinary agent error semantics unchanged', async () => {
  const error=new Error('All providers failed'); const route=vi.fn().mockResolvedValueOnce(toolTurn).mockRejectedValue(error);
  await expect(runAgentChatLoop(args(route,false,'ordinary-agent'))).rejects.toBe(error);
 });
 it('does not manufacture prior actions when the first provider call fails', async () => {
  const error=new Error('All providers failed'); const route=vi.fn().mockRejectedValue(error);
  await expect(runAgentChatLoop(args(route))).rejects.toBe(error); expect(boundary.execute).not.toHaveBeenCalled();
 });
});
