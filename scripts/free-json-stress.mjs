// Probe the real automatic free-only JSON path; exit nonzero if any call fails.
const base = process.env.DMRX_GATEWAY_URL ?? 'http://127.0.0.1:47113';
const count = Math.min(Math.max(Number(process.argv[2] ?? 12), 1), 100);
const parallel = Math.min(Math.max(Number(process.argv[3] ?? 3), 1), 8);
// A response's model name is not proof of zero-cost billing. Supply a verified
// allowlist (provider:model) from the deployment catalog; unknowns fail closed.
const freeBindings = new Set((process.env.DMRX_VERIFIED_FREE_BINDINGS ?? '').split(',').map(x => x.trim()).filter(Boolean));
const results = new Array(count);
let cursor = 0;

async function worker() {
  while (cursor < count) {
    const index = cursor++;
    const start = Date.now();
    try {
      const response = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cost-filter': 'free' },
        body: JSON.stringify({
          model: 'auto', stream: false, decompose: false, max_tokens: 128,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: `Return only JSON with city Nairobi and year 2024. Probe ${index}.` }],
        }),
        signal: AbortSignal.timeout(35_000),
      });
      const body = await response.json().catch(() => ({}));
      const content = body.choices?.[0]?.message?.content;
      let valid = false;
      try {
        const parsed = JSON.parse(content);
        valid = parsed?.city === 'Nairobi' && parsed?.year === 2024;
      } catch { /* invalid or absent JSON */ }
      results[index] = {
        index, status: response.status, valid: response.ok && valid,
        provider: response.headers.get('x-dmrx-provider-id'),
        model: body.model ?? null, error: body.error?.message ?? null,
        freeVerified: freeBindings.has(`${response.headers.get('x-dmrx-provider-id')}:${body.model}`),
        ms: Date.now() - start,
      };
    } catch (error) {
      results[index] = { index, valid: false, error: `${error.name}: ${error.message}`, ms: Date.now() - start };
    }
  }
}

await Promise.all(Array.from({ length: Math.min(count, parallel) }, () => worker()));
const valid = results.filter(result => result.valid).length;
const freeVerified = results.filter(result => result.freeVerified).length;
console.log(JSON.stringify({ count, parallel, valid, freeVerified, results }, null, 2));
if (valid !== count || freeVerified !== count) process.exitCode = 1;
