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

`danny-dis/G0DM0D3` is a **true GitHub fork** of `elder-plinius/G0DM0D3` (its
`parent` is set), which is what lets it be fast-forwarded with the
`merge-upstream` API rather than maintained as a hand-pushed mirror. It carries
no DMR-X commits — the relay changes live here as patches precisely so the fork
can stay a clean mirror that never conflicts on sync.

### How updates flow

`.github/workflows/godmode-fork-sync.yml` runs nightly and:

1. fast-forwards the fork from upstream `main`;
2. clones the new fork HEAD and checks **these patches still apply** to it;
3. opens a PR bumping `DMRX_GODMODE_REF` to that commit.

Step 3 is a PR and not a push because G0DM0D3 is third-party code DMR-X spawns
as a child process on the user's machine — a human reads the upstream diff
before it reaches users. Step 2 is the load-bearing one: the failure mode that
actually bites is upstream refactoring a file these patches rewrite, so
`git apply` stops landing and godmode silently reverts to hardcoded-OpenRouter
behaviour. A failed patch check fails the workflow and blocks the PR.

`scripts/dev/sync-godmode-fork.ps1` / `.sh` do step 1 by hand — useful when you
want the fork current without waiting for the nightly run.

Existing installs never move on their own: the runtime clones a pinned SHA, and
`cloneIfNeeded()` no-ops when the directory already exists. `GET
/v1/godmode/server/updates` reports pinned vs installed vs fork vs upstream so
the UI can show that drift.

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
| `api_routes_chat_tools.ts.patch` | Tool-calling passthrough in the chat route: `tools`/`tool_choice` forwarded upstream, `tool_calls` re-emitted in stream + non-stream responses, pipeline defaults (persona/AutoTune/Parseltongue/STM) turn OFF when `tools` is present, and STM is never applied to `tool_calls` payloads. |
| `src_lib_openrouter_tools.ts.patch` | New `sendMessageFull` (returns content + `tool_calls`); `tools`/`tool_choice` forwarded in `sendMessage`/`streamMessage`; Message type accepts `role: 'tool'` and `tool_calls`. |
| `api_lib_ultraplinian.ts.patch` | **ULTRAPLINIAN / CONSORTIUM race engine.** Upstream hardcoded `PROVIDER_ENDPOINTS.openrouter` and raced OpenRouter *slugs*, so every relayed race failed — and the slugs are unresolvable through DMR-X's router even with a key. `queryModel` now routes through `chatCompletionsUrl()`/`upstreamHeaders()` in relay mode (loop-breaker included), and `getModelsForTier()` returns `DMRX_RACE_ALIASES` (meta-model aliases) instead of the slug tables. Upstream slug tables are left byte-identical so this patch keeps applying. |
| `api_routes_ultraplinian.ts.patch` | The standalone `POST /v1/ultraplinian/completions` route had its own `caller_key \|\| process.env.OPENROUTER_API_KEY` gate that 400'd before the race ran; now uses `isRelayMode()`/`hasUsableUpstream()`. |
| `api_lib_consortium.ts.patch` | CONSORTIUM's synthesis model defaulted to `ORCHESTRATOR_MODELS[0]` (`anthropic/claude-sonnet-4.6`), an unresolvable slug in relay mode. Adds `getOrchestratorModel()` → `auto-smart` under relay. |
| `api_routes_consortium.ts.patch` | Same relay key gate as the ultraplinian route, **plus a genuine upstream bug**: `computeAutoTuneParams(userContent, conversationHistory, strategy, profiles)` still used a positional signature the function no longer accepts, so `context` arrived `undefined` and the first `context.toUpperCase()` threw `Cannot read properties of undefined (reading 'toUpperCase')` — CONSORTIUM could never reach synthesis. Rewritten to the object form used by the working `api/routes/ultraplinian.ts` call. |

## Relay-mode tier gate (not a patch)

G0DM0D3 maps a bearer key to a plan tier via `GODMODE_TIER_KEYS`; an unmapped
key defaults to `free`, which allows **only** the `fast` ULTRAPLINIAN tier — so
`standard` and above returned `403 Upgrade required` even once the relay worked.
DMR-X generates the sidecar key itself and runs it single-tenant, so
`buildGodmodeNativeEnv()` registers that key as `enterprise`. An operator-set
`GODMODE_TIER_KEYS` is respected as-is.

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
git -C "$G" apply ../../../patches/g0dm0d3/api_routes_chat_tools.ts.patch
git -C "$G" apply ../../../patches/g0dm0d3/src_lib_openrouter_tools.ts.patch
```

Apply the relay patches first, then the tool passthrough patches (they build on the
relay context). On a fresh clone the working tree is CRLF on Windows — if
`git apply` refuses, retry with `--ignore-whitespace`.

Then restart the gateway so the child is respawned.

## Managed inference contract

Managed startup always uses the host DMR-X relay, regardless of an OpenRouter
provider key in the host vault. Relay credentials are host-configured; caller
and provider credentials are never used as relay authentication. Missing relay
configuration, a direct OpenRouter URL mislabeled as the relay, or a required
patch failure blocks managed inference instead of silently bypassing DMR-X.
DMR-X may still choose OpenRouter as a provider inside its own pool.

The upgrade patches `src_lib_openrouter_relay_contract.ts.patch` and
`src_lib_classify_llm_relay.ts.patch` cover ordinary/tool chat, streaming,
model discovery, Venice helpers, and auxiliary LLM classification.
`api_routes_chat_stream_errors.ts.patch` propagates upstream SSE errors;
`api_routes_chat_tool_history.ts.patch` preserves `tool_call_id` on tool results.
They are registered in `patch-godmode.ts` and apply idempotently to both fresh
and previously patched clones.

`auto-free` tries its ranked concrete models first, then retries the wider
DMR-X free pool **through Godmode**. The relay's loop-breaker header prevents
recursive wrapping and its free-only headers preserve the cost boundary.
Tool requests deliberately use the clean pipeline so persona rewriting and
AutoTune do not corrupt schemas, arguments, or tool results.

## Verifying

Run the isolated vendor/HTTP contract checks (no real provider calls):

```bash
bun scripts/verify-godmode-relay.ts
```

Deployment still requires rebuilding Godmode/server-manager/gateway and
restarting both the gateway and managed companion. For live verification,
check ordinary text, streaming text, tool-call generation, a tool-result
round trip, and streaming tool deltas. Assert `gm-` response IDs, meaningful
answers, no SSE error frames, and `[DONE]`—HTTP 200 alone is not proof.
The sidecar port is configurable; this host currently uses `47115`.

```bash
# relay reaches DMR-X and bypasses the 5-request cap
curl -s -X POST http://127.0.0.1:7860/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"mistral-small-latest","messages":[{"role":"user","content":"Say PONG"}],"max_tokens":16}'

# auto-free responses should carry an id beginning "gm-" (godmode-wrapped)
curl -s -X POST http://127.0.0.1:47113/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto-free","messages":[{"role":"user","content":"Say PONG"}],"max_tokens":16}'

# tool_calls round-trip through the relay (agent tool loop)
curl -s -X POST http://127.0.0.1:7860/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"mistral-small-latest","messages":[{"role":"user","content":"What is the weather in Paris?"}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"city":{"type":"string"}}}}}],"tool_choice":"auto","max_tokens":64}'
# expect a response whose choices[0].message.tool_calls is non-empty, finish_reason "tool_calls"
```

Measured 2026-07-28: 5/5 `auto-free` responses godmode-wrapped, 0 fell through
to plain routing (previously 0 wrapped, all fell through).
