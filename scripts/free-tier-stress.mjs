import { performance } from 'node:perf_hooks';

const base = process.env.DMRX_GATEWAY_URL ?? 'http://127.0.0.1:47113';
const count = Math.min(Math.max(Number(process.argv[2] ?? 24), 1), 100);
const parallel = Math.min(Math.max(Number(process.argv[3] ?? 4), 1), 8);
const model = process.argv[4] ?? 'auto';
const tasks = [
  { type: 'simple', prompt: 'Answer in one word: what color is a clear daytime sky?' },
  { type: 'code', prompt: 'Write a short JavaScript function that reverses an array without mutating it.' },
  { type: 'reason', prompt: 'A bag has three red and two blue marbles. Explain the probability of drawing blue.' },
  { type: 'extract', prompt: 'Extract the city and year from: Nairobi hosted the meetup in 2024. Reply as JSON.' },
];
const results = new Array(count);
let cursor = 0;

async function probe(index) {
  const task = tasks[index % tasks.length];
  const start = performance.now();
  try {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cost-filter': 'free' },
      body: JSON.stringify({
        model, decompose: false, max_tokens: 128,
        messages: [{ role: 'user', content: `${task.prompt} [test-${index}]` }],
      }),
      signal: AbortSignal.timeout(35_000),
    });
    const body = await response.json().catch(() => ({}));
    const choice = body.choices?.[0] ?? {};
    const content = choice.message?.content;
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    const quality = task.type === 'simple' ? /\bblue\b/i.test(text)
      : task.type === 'code' ? /\breverse\b/i.test(text) && /(function|=>)/.test(text)
      : task.type === 'reason' ? /(2\s*\/\s*5|0[.,]4\b|40\s*%)/.test(text)
      : /nairobi/i.test(text) && /2024/.test(text);
    results[index] = {
      task: task.type, status: response.status,
      nonempty: response.ok && text.trim().length > 0, quality: response.ok && quality,
      provider: response.headers.get('x-dmrx-provider-id'),
      model: body.model ?? null, fallback: response.headers.get('x-dmrx-fallback') === 'true',
      finish: choice.finish_reason ?? null, seconds: +((performance.now() - start) / 1000).toFixed(2),
    };
  } catch (error) {
    results[index] = {
      task: task.type, status: error?.name ?? 'network_error', nonempty: false, quality: false,
      provider: null, model: null, fallback: false, finish: null,
      seconds: +((performance.now() - start) / 1000).toFixed(2),
    };
  }
}

async function worker() {
  while (cursor < count) {
    const index = cursor++;
    await probe(index);
  }
}
const start = performance.now();
await Promise.all(Array.from({ length: Math.min(parallel, count) }, worker));
const seconds = results.map(item => item.seconds).sort((a, b) => a - b);
const distribution = key => Object.fromEntries(
  [...new Set(results.map(item => item[key] ?? 'unknown'))]
    .map(value => [value, results.filter(item => (item[key] ?? 'unknown') === value).length]),
);
console.log(JSON.stringify({
  model, count, parallel, duration_seconds: +((performance.now() - start) / 1000).toFixed(2),
  nonempty: results.filter(item => item.nonempty).length,
  quality_heuristic_pass: results.filter(item => item.quality).length,
  p50_seconds: seconds[Math.ceil(count * 0.5) - 1],
  p95_seconds: seconds[Math.ceil(count * 0.95) - 1],
  status: distribution('status'), provider: distribution('provider'),
  served_model: distribution('model'), fallback: results.filter(item => item.fallback).length,
  failures: results.map((item, index) => ({ index, ...item })).filter(item => !item.nonempty),
  quality_misses: results.map((item, index) => ({ index, task: item.task,
    status: item.status, provider: item.provider, model: item.model,
  })).filter(item => !results[item.index].quality),
}, null, 2));
