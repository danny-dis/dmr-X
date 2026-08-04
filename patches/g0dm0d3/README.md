# G0DM0D3 relay-mode patch

DMR-X spawns G0DM0D3 as an internal proxy and sets `G0DM0D3_LLM_BASE_URL`,
`G0DM0D3_LLM_API_KEY`, and `GODMODE_RELAY=1` (see
`services/server-manager/src/server-manager.service.ts`, `startNative`).

## Source: DMR-X's fork, pinned

The runtime clone (`server-manager.service.ts`, `cloneIfNeeded()`) points at
`danny-dis/G0DM0D3` (a fork of `elder-plinius/G0DM0D3`), not upstream
directly, pinned to a commit SHA via `DMRX_GODMODE_REF` (default baked into
`server-manager.service.ts`; override via env — see `docs/CONFIGURATION.md`).
Pinning to a SHA rather than a branch tip means every fresh install gets
identical G0DM0D3 source regardless of when it runs.

To pull upstream changes into the fork (never automatic — this is a
deliberate, reviewed step), run `scripts/dev/sync-godmode-fork.ps1` (or
`.sh`), then bump `DMRX_GODMODE_REF` to the synced commit once you're happy
with it. See that script for why a `gh repo sync` script was chosen over a
scheduled GitHub Actions workflow living in the fork.

## Applying — now automatic

**These patches are applied automatically** by
`services/server-manager/src/patch-godmode.ts`, called from
`ServerManagerService.install()` and `.start()` on every gateway boot, on
every platform (pure Node/TS — `fs` + `git apply`, no perl, no bash). You do
not need to do anything by hand; this section is for understanding what
happens or re-applying manually while iterating on the patches themselves.

**Upstream G0DM0D3 ignores `G0DM0D3_LLM_BASE_URL`/`G0DM0D3_LLM_API_KEY`/
`GODMODE_RELAY`.** It hardcodes the OpenRouter endpoint and requires
`OPENROUTER_API_KEY`, so every relayed request failed with
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
| `api_routes_research.ts.patch` | **Not relay-related.** On the pinned commit, `researchRoutes.get('/batch/*', ...)` uses an Express-4-style bare wildcard that `path-to-regexp` v6+ (Express 5.2.1, which G0DM0D3's own `package.json` pins) rejects at import time — the whole process crashes before it can bind to a port, independent of anything DMR-X sends it. Renames it to the named-wildcard form (`/batch/*splat`) and adjusts the param read accordingly. Filed as a real upstream bug; patched here so godmode isn't blocked waiting on it. |

## Applying manually (rarely needed)

Automatic application (see above) covers every normal path. To force a
re-apply by hand — e.g. while editing the `.patch` files themselves — run:

```bash
# any platform, no perl/bash dependency:
bun scripts/dev/patch-godmode-cli.ts .dmrx-data/servers/g0dm0d3
```

which is exactly what `applyGodmodePatches()` in
`services/server-manager/src/patch-godmode.ts` does. The old fully-manual
`cp` + `git apply` invocations still work identically if you'd rather run
them directly:

```bash
G=.dmrx-data/servers/g0dm0d3
cp patches/g0dm0d3/relay.ts "$G/api/lib/relay.ts"
git -C "$G" apply ../../../patches/g0dm0d3/api_routes_chat.ts.patch
git -C "$G" apply ../../../patches/g0dm0d3/src_lib_openrouter.ts.patch
git -C "$G" apply ../../../patches/g0dm0d3/api_middleware_rateLimit.ts.patch
git -C "$G" apply ../../../patches/g0dm0d3/api_routes_research.ts.patch
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
