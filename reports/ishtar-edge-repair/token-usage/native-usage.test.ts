import { describe, it, expect, mock, spyOn } from 'bun:test';
const vi = { mock: mock.module, spyOn };
import { readFileSync, writeFileSync } from 'node:fs';
// Isolate transport/key-pool machinery, NOT the extraction under diagnosis.
// Every execute/executeStream/body/usage/finishReason statement belongs to real CohereAdapter.
vi.mock('../../../services/adapters/src/base.adapter.ts', () => ({ BaseAdapter: class {
 protected config: any = { baseUrl: '' }; protected initialized = false;
 async initialize(config: any) { this.config = config; this.initialized = true; }
 assertInitialized() { if (!this.initialized) throw new Error('uninitialized'); }
 nextKey(key: string) { return key; }
 async withKeyRotation(fn: () => any) { return fn(); }
 async fetchWithTimeout(url: string, options: any) { return fetch(url, options); }
} }));
vi.mock('@dmr-x/core', () => ({ ProviderError: class extends Error {} }));
vi.mock('@dmr-x/utils', () => ({ createHttpError: () => new Error('unexpected upstream failure') }));
const { CohereAdapter } = await import('../../../services/adapters/src/cohere/cohere.adapter.ts');
const native = JSON.parse(readFileSync('reports/ishtar-edge-repair/token-usage/native-upstream.json', 'utf8'));
const request: any = { modality: 'llm', model: 'command-a-03-2025', messages: [{ role: 'user', content: 'EDGE_PONG' }], max_tokens: 24, temperature: 0 };
async function replay(body: any) {
 const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
 const adapter = new CohereAdapter(); await adapter.initialize({ apiKey: 'fixture-not-a-credential', baseUrl: 'https://api.cohere.com/v2' });
 try { return await adapter.execute(request); } finally { transport.mockRestore(); }
}
describe('REAL captured native Cohere V2 response through actual execute seam', () => {
 it('replays real native response with unchanged content/model/finish reason', async () => {
  const result = await replay(native.body);
  expect(native.http).toBe(200); expect(result.message?.content).toBe('EDGE_PONG');
  expect(result.modelId).toBe(request.model); expect(result.finishReason).toBe('stop');
 });
 it('RED: preserves actual input_tokens/output_tokens rather than silently reporting zero', async () => {
  const result = await replay(native.body);
  const tokens = native.body.usage.tokens;
  const expected = { prompt_tokens: tokens.input_tokens, completion_tokens: tokens.output_tokens, total_tokens: tokens.input_tokens + tokens.output_tokens };
  writeFileSync('reports/ishtar-edge-repair/token-usage/extraction-receipt.json', JSON.stringify({ provenance: 'actual native HTTP200 replay through unmodified CohereAdapter.execute; no guessed usage', rawUsage: native.body.usage, actualAdapterUsage: result.usage, expectedActualTokenUsage: expected }, null, 2));
  expect(result.usage).toEqual(expected);
 });
 it('CONTROL: upstream omitted usage remains unknown, not invented', async () => {
  const { usage, ...body } = native.body;
  expect((await replay(body)).usage).toBeUndefined();
 });
 it('CONTROL: billed_units alone is not substituted for actual tokens', async () => {
  const body = { ...native.body, usage: { billed_units: native.body.usage.billed_units } };
  expect((await replay(body)).usage).toBeUndefined();
 });
 it('CONTROL: native explicitly reported zero tokens remains zero', async () => {
  const body = { ...native.body, usage: { tokens: { input_tokens: 0, output_tokens: 0 } } };
  expect((await replay(body)).usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
 });
});
describe('Documented Cohere V2 message-end envelope (synthetic protocol fixture, not a live stream)', () => {
 it('RED: consumes delta.usage alongside delta.finish_reason', async () => {
  const event = { type: 'message-end', delta: { finish_reason: native.body.finish_reason, usage: native.body.usage } };
  const transport = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(`event: message-end\ndata: ${JSON.stringify(event)}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  const adapter = new CohereAdapter(); await adapter.initialize({ apiKey: 'fixture-not-a-credential', baseUrl: 'https://api.cohere.com/v2' });
  try {
   const chunks = []; for await (const chunk of adapter.executeStream(request)) chunks.push(chunk);
   const done: any = chunks.find(c => c.type === 'done');
   expect(done.data).toMatchObject({ finishReason: 'stop', usage: { prompt_tokens: native.body.usage.tokens.input_tokens, completion_tokens: native.body.usage.tokens.output_tokens, total_tokens: native.body.usage.tokens.input_tokens + native.body.usage.tokens.output_tokens } });
  } finally { transport.mockRestore(); }
 });
});

describe('REAL captured native Cohere V2 tool stream', () => {
 it('preserves captured tool id, name, JSON arguments, finish and actual counts', async () => {
  const capture=JSON.parse(readFileSync('reports/ishtar-edge-repair/token-usage/native-stream-upstream.json','utf8'));
  const events=capture.body.sse.split('\n\n').map((s:string)=>s.split('\n').find(l=>l.startsWith('data: '))?.slice(6)).filter((s:string)=>s?.startsWith('{')).map((s:string)=>JSON.parse(s));
  const start=events.find((e:any)=>e.type==='tool-call-start').delta.message.tool_calls;
  const args=events.filter((e:any)=>e.type==='tool-call-delta').map((e:any)=>e.delta.message.tool_calls.function.arguments).join('');
  const usage=events.find((e:any)=>e.type==='message-end').delta.usage.tokens;
  const transport=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(capture.body.sse,{status:200}));
  const adapter=new CohereAdapter();await adapter.initialize({apiKey:'fixture-only',baseUrl:'https://api.cohere.com/v2'});
  try {
   const chunks=[];for await(const chunk of adapter.executeStream(request))chunks.push(chunk);
   const calls=chunks.flatMap((c:any)=>c.data?.tool_calls??[]);
   expect(capture.http).toBe(200);expect(calls).toHaveLength(1);
   expect(calls[0]).toMatchObject({id:start.id,type:'function',function:{name:start.function.name,arguments:args}});
   expect(chunks.find(c=>c.type==='done')?.data).toMatchObject({finishReason:'tool_calls',usage:{prompt_tokens:usage.input_tokens,completion_tokens:usage.output_tokens,total_tokens:usage.input_tokens+usage.output_tokens}});
  }finally{transport.mockRestore();}
 });
});
