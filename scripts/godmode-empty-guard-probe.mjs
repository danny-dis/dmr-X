// Concurrent auto-free probe: proves the godmode empty-content guard is exercised.
// Usage: node scripts/godmode-empty-guard-probe.mjs [count] [model]
const N = Number(process.argv[2] || 12);
const MODEL = process.argv[3] || 'auto-free';
const URL = 'http://127.0.0.1:47113/v1/chat/completions';

const one = async (i) => {
  const t0 = Date.now();
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'say PONG' }],
        max_tokens: 24,
      }),
      signal: AbortSignal.timeout(90000),
    });
    const d = await r.json();
    const c = d?.choices?.[0]?.message?.content ?? '';
    return {
      i,
      state: r.status !== 200 ? `HTTP${r.status}` : c ? 'OK' : 'EMPTY',
      model: d?.model,
      gm: String(d?.id ?? '').startsWith('gm-'),
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { i, state: 'FAIL', err: String(e).slice(0, 60), ms: Date.now() - t0 };
  }
};

const rows = await Promise.all(Array.from({ length: N }, (_, i) => one(i + 1)));
for (const r of rows) {
  console.log(
    `${String(r.i).padStart(2)}: ${r.state.padEnd(6)} gm=${r.gm ?? '-'} ${r.ms}ms ${r.model ?? r.err ?? ''}`,
  );
}
const tally = rows.reduce((a, r) => ((a[r.state] = (a[r.state] || 0) + 1), a), {});
console.log('TALLY:', JSON.stringify(tally));
console.log('wrapped(gm-):', rows.filter((r) => r.gm).length, '/', N);
