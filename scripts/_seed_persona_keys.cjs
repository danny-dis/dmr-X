// Re-seed BETTY/BYTE/NOCTURNE/FAEY/KALLMEDIS free keys onto the global
// DMR-X providers. Provider UUIDs are resolved by NAME at runtime (fresh DBs
// assign new UUIDs each boot), so this is safe to re-run after a reset.
//
// The actual keys live in scripts/persona_keys.local.cjs (gitignored, never
// committed). Copy persona_keys.local.example.cjs -> persona_keys.local.cjs
// and fill in real credentials. Run with the gateway up:
//   DMRX_ADMIN_API_KEY=... bun scripts/_seed_persona_keys.cjs
const fs = require('fs');
const path = require('path');

const K = process.env.DMRX_ADMIN_API_KEY;
const BASE = process.env.DMRX_BASE_URL || 'http://localhost:47113';

const localKeysPath = path.join(__dirname, 'persona_keys.local.cjs');
if (!fs.existsSync(localKeysPath)) {
  console.error(
    'FATAL: scripts/persona_keys.local.cjs not found.\n' +
      'Copy persona_keys.local.example.cjs to persona_keys.local.cjs and fill in keys.',
  );
  process.exit(1);
}
const KEYS = require(localKeysPath);

const WANT = ['google', 'cohere', 'mistral', 'gitlawb', 'opencode-zen'];

async function resolveIds() {
  const r = await fetch(`${BASE}/v1/admin/providers`, { headers: { 'X-API-Key': K } });
  const j = await r.json();
  const map = {};
  for (const w of WANT) {
    const p = (j.providers || []).find((x) => x.name === w);
    if (!p) throw new Error('provider not found: ' + w);
    map[w] = p.id;
  }
  return map;
}

async function addKey(provider, pid, persona, key) {
  const res = await fetch(`${BASE}/v1/admin/providers/${pid}/keys`, {
    method: 'POST',
    headers: { 'X-API-Key': K, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: persona, tier: 'free', api_key: key, priority: 0 }),
  });
  const ok = res.ok;
  console.log(`${ok ? 'OK ' : 'ERR'} ${provider.padEnd(12)} ${persona.padEnd(9)} [${key.slice(-4)}] -> ${res.status}`);
  return ok;
}

(async () => {
  if (!K) {
    console.error('FATAL: DMRX_ADMIN_API_KEY is not set in the environment.');
    process.exit(1);
  }
  const ids = await resolveIds();
  let ok = 0, err = 0;
  for (const provider of WANT) {
    const pid = ids[provider];
    const map = KEYS[provider] || {};
    for (const [persona, key] of Object.entries(map)) {
      try {
        const success = await addKey(provider, pid, persona, key);
        if (success) ok++; else err++;
      }
      catch (e) { err++; console.log('FAIL', provider, persona, e.message); }
    }
  }
  console.log(`\nDONE: ${ok} ok, ${err} err`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
