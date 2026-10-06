/** Replay the tracked relay patches against a pristine copy of the pinned
 * Godmode checkout, then test real vendor functions with intercepted fetches.
 * No provider calls, database writes, or production restarts are performed.
 * Usage: bun scripts/verify-godmode-relay.ts [path-to-installed-godmode]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyGodmodePatches } from '../services/server-manager/src/patch-godmode';

const root = path.resolve(import.meta.dir, '..');
const source = path.resolve(process.argv[2] || path.join(root, '.dmrx-data/servers/g0dm0d3'));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dmrx-godmode-contract-'));
const savedFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const passed: string[] = [];
try {
  const archive = execFileSync('git', ['-C', source, 'archive', '--format=tar', 'HEAD'], { maxBuffer: 32 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', fixture], { input: archive });
  execFileSync('git', ['init', '--quiet'], { cwd: fixture });
  const first = applyGodmodePatches(fixture);
  assert.deepEqual(first.failed, [], 'all patches must apply to the pinned source');
  const second = applyGodmodePatches(fixture);
  assert.deepEqual(second.failed, []);
  assert.deepEqual(second.applied, [], 'second apply must be idempotent');
  passed.push('fresh-clone patch replay + idempotency');

  process.env.GODMODE_RELAY = '1';
  process.env.G0DM0D3_LLM_BASE_URL = 'http://dmrx-contract.invalid/v1/';
  process.env.G0DM0D3_LLM_API_KEY = '';
  process.env.OPENROUTER_API_KEY = 'test-provider-key-must-not-leak';
  // Link dependencies before importing vendor modules; Bun caches package
  // lookup roots on the first import of a temporary checkout.
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(fixture, 'node_modules'), 'junction');
  const lib = await import(pathToFileURL(path.join(fixture, 'src/lib/openrouter.ts')).href);
  const classifier = await import(pathToFileURL(path.join(fixture, 'src/lib/classify-llm.ts')).href);
  const race = await import(pathToFileURL(path.join(fixture, 'api/lib/ultraplinian.ts')).href);
  let requests: Array<{ url: string; headers: Headers; body: any }> = [];
  let streamError = false;
  globalThis.fetch = (async (url: any, options: any = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url: String(url), headers: new Headers(options.headers), body });
    if (!body) return Response.json({ data: [{ id: 'auto-fast' }] });
    if (body.stream) return new Response(streamError
      ? 'data: {"error":{"message":"contract-upstream-failure"}}\n\ndata: [DONE]\n\n'
      : 'data: {"choices":[{"delta":{"content":"test-text"}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_test","type":"function","function":{"name":"lookup","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n');
    const content = body.messages?.[0]?.content?.includes('classify user prompts') ? 'benign/coding|0.9|request' : 'test-text';
    return Response.json({ choices: [{ message: { content, tool_calls: body.tools ? [{ id: 'call_test', type: 'function', function: { name: 'lookup', arguments: '{}' } }] : undefined }, finish_reason: body.tools ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }) as typeof fetch;
  function check(label: string, endpoint = '/chat/completions') {
    assert.equal(requests.length, 1, label + ': expected exactly one upstream request');
    const request = requests[0];
    assert.equal(request.url, 'http://dmrx-contract.invalid/v1' + endpoint, label + ': must hit DMR-X');
    assert.equal(request.headers.get('authorization'), null, label + ': must not forward caller/provider key');
    assert.equal(request.headers.get('x-dmrx-godmode-proxy'), '1', label + ': recursion guard');
    assert.equal(request.headers.get('x-cost-filter'), 'free', label + ': free-only contract');
    assert.equal(request.headers.get('x-free-tier-strategy'), 'free_only', label + ': free-only contract');
    passed.push(label);
    requests = [];
  }
  const options = { model: 'auto-fast', apiKey: 'caller-openrouter-key', messages: [{ role: 'user', content: 'test' }] };
  assert.equal(await lib.sendMessage(options), 'test-text');
  check('standard chat uses the shared DMR-X relay contract');
  const tools = [{ type: 'function', function: { name: 'lookup', description: 'test', parameters: { type: 'object', properties: {} } } }];
  const history = [...options.messages, { role: 'assistant', content: null, tool_calls: [{ id: 'call_previous', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }, { role: 'tool', content: 'test-result', tool_call_id: 'call_previous' }];
  const full = await lib.sendMessageFull({ ...options, messages: history, tools, tool_choice: 'required' });
  assert.equal(full.tool_calls?.[0].id, 'call_test');
  assert.deepEqual(requests[0].body.messages, history);
  assert.deepEqual(requests[0].body.tools, tools);
  assert.equal(requests[0].body.tool_choice, 'required');
  check('tool chat preserves schema + tool history + returned tool calls');
  const chunks: any[] = [];
  for await (const delta of lib.streamMessage({ ...options, tools })) chunks.push(delta);
  assert.equal(chunks[0], 'test-text');
  assert.equal(chunks[1][0].id, 'call_test');
  check('streaming chat preserves text + tool deltas');
  streamError = true;
  await assert.rejects(async () => { for await (const _ of lib.streamMessage(options)) { /* drain */ } }, /contract-upstream-failure/);
  check('streaming errors are not swallowed');
  streamError = false;
  assert.deepEqual(await lib.getModels(options.apiKey), ['auto-fast']);
  check('model discovery uses DMR-X, not OpenRouter', '/models');
  assert.equal(await lib.sendMessageViaVenice(options), 'test-text');
  check('legacy Venice helper cannot bypass DMR-X in relay mode');
  const classification = await classifier.classifyWithLLM('Write a simple hello-world program', 'caller-openrouter-key');
  assert.equal(classification.domain, 'benign');
  check('auxiliary classifier uses DMR-X, not OpenRouter');
  assert.equal(requests.length, 0);
  const raced = await race.queryModel('auto-fast', [{ role: 'user', content: 'test' }], '', {}, undefined, 'venice');
  assert.ok(!raced.error, JSON.stringify(raced));
  check('race query ignores provider hints and relays through DMR-X');

  // Exercise the actual Express route as well as its library. The client
  // uses savedFetch; only vendor outbound inference is intercepted above.
  const { default: express } = await import(pathToFileURL(path.join(source, 'node_modules/express/index.js')).href);
  const { chatRoutes } = await import(pathToFileURL(path.join(fixture, 'api/routes/chat.ts')).href);
  const app = express();
  app.use(express.json());
  app.use('/v1/chat', chatRoutes);
  const server = await new Promise<any>((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  try {
    for (const stream of [false, true]) {
      streamError = false;
      const historyResponse = await savedFetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...options, messages: history, tools, tool_choice: 'none', stream }),
      });
      assert.equal(historyResponse.status, 200);
      await historyResponse.text();
      assert.deepEqual(requests[0].body.messages.at(-1), history.at(-1), 'actual HTTP route must preserve tool_call_id on tool-result messages');
      assert.deepEqual(requests[0].body.messages.at(-2).tool_calls, history.at(-2)?.tool_calls);
      check(`actual vendor HTTP ${stream ? 'stream' : 'chat'} preserves tool-result identity`);
    }
    streamError = true;
    const response = await savedFetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...options, openrouter_api_key: options.apiKey, stream: true, godmode: false, autotune: false }),
    });
    const frames = (await response.text()).split('\n').filter((line) => line.startsWith('data: ') && !line.includes('[DONE]')).map((line) => JSON.parse(line.slice(6)));
    assert.ok(frames.some((frame) => frame.error?.message === 'contract-upstream-failure'), 'Express route must forward the upstream SSE error, not turn it into empty success');
    check('actual vendor HTTP stream forwards relay errors');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  console.log(JSON.stringify({ mode: 'isolated-contract-test (intercepted fetch, not live inference)', success: true, passed: passed.length, checks: passed }, null, 2));
} finally {
  globalThis.fetch = savedFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  fs.rmSync(fixture, { recursive: true, force: true });
}
