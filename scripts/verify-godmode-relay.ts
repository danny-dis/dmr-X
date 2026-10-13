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

  // Link dependencies before importing any vendor module: Bun caches the
  // package lookup roots on the first import of a temporary checkout.
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(fixture, 'node_modules'), 'junction');
  const autotune = await import(pathToFileURL(path.join(fixture, 'src/lib/autotune.ts')).href);
  const factual = autotune.computeAutoTuneParams({
    strategy: 'adaptive', message: 'What is the capital of Kenya? Answer with just the city name.', conversationHistory: [],
  });
  assert.notEqual(factual.detectedContext, 'chaotic', 'ordinary text must not match the Zalgo character class');
  assert.ok(factual.params.temperature < 1, 'ordinary factual text must not select chaotic sampling');
  assert.equal(factual.contextScores.find((score: any) => score.type === 'chaotic')?.score, 0);
  passed.push('AutoTune factual prompt is not falsely chaotic');

  for (const message of ['z', 'a', 'l', 'g', 'o', 'zalgo', 'A normal long sentence about gardens and geography.', 'caf\u00e9', 'cafe\u0301']) {
    const result = autotune.computeAutoTuneParams({ strategy: 'adaptive', message, conversationHistory: [] });
    assert.equal(result.contextScores.find((score: any) => score.type === 'chaotic')?.score, 0, `ordinary text must not match Zalgo: ${message}`);
  }
  passed.push('AutoTune plain letters and normal accented text are not chaotic');

  for (const overlay of ['\u0334', '\u0335', '\u0336', '\u0337', '\u0338']) {
    const result = autotune.computeAutoTuneParams({ strategy: 'adaptive', message: `z${overlay}a${overlay}l${overlay}g${overlay}o${overlay}`, conversationHistory: [] });
    assert.ok(result.contextScores.find((score: any) => score.type === 'chaotic')?.score > 0, 'real combining overlays must retain a chaotic signal');
  }
  passed.push('AutoTune still detects all original Zalgo combining overlays');

  const contextual = autotune.computeAutoTuneParams({ strategy: 'adaptive', message: 'What is the capital of Kenya? Answer with just the city name.', conversationHistory: [{ role: 'user', content: 'A normal long sentence about gardens and geography.' }] });
  assert.equal(contextual.contextScores.find((score: any) => score.type === 'chaotic')?.score, 0);
  passed.push('AutoTune ordinary conversation history does not introduce false chaos');

  const explicitChaos = autotune.computeAutoTuneParams({ strategy: 'adaptive', message: 'Unleash chaos and entropy!!!', conversationHistory: [] });
  assert.equal(explicitChaos.detectedContext, 'chaotic');
  const controlled = autotune.computeAutoTuneParams({ strategy: 'adaptive', message: 'What is the capital of Kenya? Answer with just the city name.', conversationHistory: [], overrides: { temperature: 0 } });
  assert.equal(controlled.params.temperature, 0);
  passed.push('AutoTune intentional chaotic requests and explicit overrides are unchanged');

  process.env.GODMODE_RELAY = '1';
  process.env.G0DM0D3_LLM_BASE_URL = 'http://dmrx-contract.invalid/v1/';
  process.env.G0DM0D3_LLM_API_KEY = '';
  process.env.OPENROUTER_API_KEY = 'test-provider-key-must-not-leak';
  const lib = await import(pathToFileURL(path.join(fixture, 'src/lib/openrouter.ts')).href);
  const classifier = await import(pathToFileURL(path.join(fixture, 'src/lib/classify-llm.ts')).href);
  const race = await import(pathToFileURL(path.join(fixture, 'api/lib/ultraplinian.ts')).href);
  let requests: Array<{ url: string; headers: Headers; body: any }> = [];
  let streamError = false;
  let proseResponse: string | null = null;
  globalThis.fetch = (async (url: any, options: any = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url: String(url), headers: new Headers(options.headers), body });
    if (!body) return Response.json({ data: [{ id: 'auto-fast' }] });
    if (proseResponse !== null) {
      if (!body.stream) return Response.json({ choices: [{ message: { content: proseResponse }, finish_reason: 'stop' }] });
      return new Response(proseResponse.split(/(?<=\n)/).map((content) => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n').join('') + 'data: [DONE]\n\n');
    }
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
  const { chatRoutes, transformCodingProse } = await import(pathToFileURL(path.join(fixture, 'api/routes/chat.ts')).href);
  for (const literal of ['{"root":"disable"}', '["root", "disable"]', '`disable`', '```ts\nconst disable = "root";\n```', '~~~ts\nconst disable = "root";\n~~~', 'https://example.test/root/disable', 'C:/root/disable.ts', 'root/disable.ts', '"disable"']) {
    assert.equal(transformCodingProse(literal, (s: string) => s.replace(/root|disable/g, 'CHANGED')), literal);
  }
  assert.notEqual(transformCodingProse('Explain disable as prose.', (s: string) => s.replace(/disable/g, 'CHANGED')), 'Explain disable as prose.');
  passed.push('coding prose boundaries preserve JSON, URLs, paths, fenced and inline code');
  const app = express();
  app.use(express.json());
  app.use('/v1/chat', chatRoutes);
  const server = await new Promise<any>((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  try {
    // The caller's coding rules and structured tool history must survive the
    // full persona/AutoTune/Parseltongue pipeline, with tools attached.
    const codingRules = 'PI_SYSTEM_SENTINEL: Use the real tools and preserve exact file bytes.';
    const code = '```ts\nconst disable = "root";\nconst payload = { root: "disable" };\n```';
    const codingPrompt = 'Explain how to disable a harmless demo flag. Preserve `root/disable.ts` exactly.\n\n' + code;
    const toolArgs = '{"root":"disable","path":"root/disable.ts"}';
    const codingHistory = [
      { role: 'system', content: codingRules },
      { role: 'user', content: codingPrompt },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_previous', type: 'function', function: { name: 'lookup', arguments: toolArgs } }] },
      { role: 'tool', name: 'lookup', content: '{"root":"disable","code":"const root = 1;"}', tool_call_id: 'call_previous' },
    ];
    for (const stream of [false, true]) {
      const response = await savedFetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...options, messages: codingHistory, tools, tool_choice: 'required', stream }),
      });
      assert.equal(response.status, 200);
      const raw = await response.text();
      const outbound = requests[0].body;
      const system = outbound.messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
      assert.ok(system.includes('G0DM0D3'), 'tools must not disable the GODMODE persona');
      assert.ok(system.includes(codingRules), 'caller coding instructions must be retained beside the persona');
      assert.ok(system.includes('Respect tool dependencies'), 'coding contract must require dependent operations to await earlier tool results');
      const user = outbound.messages.find((m: any) => m.role === 'user').content;
      assert.notEqual(user, codingPrompt, 'Parseltongue must transform eligible user prose with tools attached');
      assert.ok(user.includes(code), 'code fences must remain byte-identical');
      assert.ok(user.includes('`root/disable.ts`'), 'inline code and paths must remain byte-identical');
      assert.deepEqual(outbound.messages.at(-2), codingHistory.at(-2), 'assistant null content and tool-call arguments must remain intact');
      assert.deepEqual(outbound.messages.at(-1), codingHistory.at(-1), 'tool names, results and identity must remain intact');
      assert.deepEqual(outbound.tools, tools);
      assert.equal(outbound.tool_choice, 'required');
      if (!stream) {
        const data = JSON.parse(raw);
        assert.equal(data.x_g0dm0d3.pipeline.godmode, true);
        assert.ok(data.x_g0dm0d3.pipeline.autotune, 'AutoTune must run with tools attached');
        assert.ok(data.x_g0dm0d3.pipeline.parseltongue?.transformations_count > 0);
        assert.equal(data.choices[0].message.tool_calls[0].function.arguments, '{}');
      }
      check(`full tool pipeline ${stream ? 'stream' : 'chat'} preserves coding contracts and transforms user prose`);
    }
    const parts = [{ type: 'text', text: codingPrompt }, { type: 'image_url', image_url: { url: 'data:image/png;base64,coding-contract' } }];
    const multimodalResponse = await savedFetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...options, messages: [{ role: 'system', content: codingRules }, { role: 'user', content: parts }], tools }),
    });
    assert.equal(multimodalResponse.status, 200);
    await multimodalResponse.text();
    const outboundParts = requests[0].body.messages.at(-1).content;
    assert.ok(Array.isArray(outboundParts));
    assert.deepEqual(outboundParts[1], parts[1]);
    assert.notEqual(outboundParts[0].text, codingPrompt);
    assert.ok(outboundParts[0].text.includes(code));
    check('multimodal prompt transformation preserves images and exact code');
    proseResponse = 'Perhaps the demo flag might work.\n' + code;
    let transformedProse: string | undefined;
    for (const stream of [false, true]) {
      const response = await savedFetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...options, tools, tool_choice: 'none', stream }),
      });
      const raw = await response.text();
      const text = stream
        ? raw.split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).map(line => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '').join('')
        : JSON.parse(raw).choices[0].message.content;
      assert.ok(text.includes(code), 'semantic text transformations must preserve response code');
      if (!stream) { assert.notEqual(text, proseResponse); transformedProse = text }
      else assert.equal(text, transformedProse, 'stream clients must receive transformed text, not ignored correction metadata');
      check(`semantic ${stream ? 'stream' : 'chat'} transforms prose but preserves code with tools attached`);
    }
    proseResponse = null;
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
