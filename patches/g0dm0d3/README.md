# G0DM0D3 relay-mode patch

DMR-X spawns G0DM0D3 as an internal proxy and sets `G0DM0D3_LLM_BASE_URL`,
`G0DM0D3_LLM_API_KEY`, and `GODMODE_RELAY=1` (see
`services/server-manager/src/server-manager.service.ts`, `startNative`).

**Upstream G0DM0D3 ignores all three.** It hardcodes the OpenRouter endpoint
and requires `OPENROUTER_API_KEY`, so every relayed request failed with
`400 missing_api_key` and no `auto-free` request was ever godmode-wrapped.
Its request limiter also applied the research-preview default of 5 lifetime
requests to the relay, which capped the whole host gateway.

These patches add relay support. They target the runtime clone at
`.dmrx-data/servers/g0dm0d3`, which is **not** version-controlled and is
recreated by the server-manager — so re-apply after any re-clone.

## Contents

| File | Purpose |
|------|---------|
| `relay.ts` | New `api/lib/relay.ts`: resolves upstream URL, key, and headers from env. Copy into place. |
| `api_routes_chat.ts.patch` | Streaming path + key guard use the resolved upstream. |
| `src_lib_openrouter.ts.patch` | Non-streaming `sendMessage`/`streamMessage` (the path DMR-X actually calls). |
| `api_middleware_rateLimit.ts.patch` | Skip the limiter in relay mode; the host gateway owns quotas. |

## Applying

```bash
G=.dmrx-data/servers/g0dm0d3
cp patches/g0dm0d3/relay.ts "$G/api/lib/relay.ts"
git -C "$G" apply ../../../patches/g0dm0d3/api_routes_chat.ts.patch
git -C "$G" apply ../../../patches/g0dm0d3/src_lib_openrouter.ts.patch
git -C "$G" apply ../../../patches/g0dm0d3/api_middleware_rateLimit.ts.patch
```

Then restart the gateway so the child is respawned.

## Verifying

```bash
# relay reaches DMR-X and bypasses the 5-request cap
curl -s -X POST http://127.0.0.1:7860/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"mistral-small-latest","messages":[{"role":"user","content":"Say PONG"}],"max_tokens":16}'

# auto-free responses should carry an id beginning "gm-" (godmode-wrapped)
curl -s -X POST http://127.0.0.1:47113/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto-free","messages":[{"role":"user","content":"Say PONG"}],"max_tokens":16}'
```

Measured 2026-07-28: 5/5 `auto-free` responses godmode-wrapped, 0 fell through
to plain routing (previously 0 wrapped, all fell through).
