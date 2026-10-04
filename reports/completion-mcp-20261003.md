# MCP lane completion report — 2026-10-03

Worktree: `C:/Users/pc/Documents/projects/DMR-X-workers-20261003/mcp` (branch `completion/mcp-20261003`).
Lane: `services/mcp-server/src/index.ts`, `auth-runtime.ts`, `session-runtime.ts`,
`http-security.ts`, `tenant-key.ts`, small NEW shared transport/auth helpers, MCP unit/integration tests.
`server.ts` (hosted lane) and `a2a/*` (A2A lane) were NOT edited. Changes are uncommitted.
No packages installed, no `.env`/credentials touched, no services restarted, no real providers called.

MCP tooling note: the GitNexus MCP tools are not loaded in this worker session, so all
code-intelligence calls below used the globally installed `gitnexus` CLI (`gitnexus --version` = 1.6.9)
against the baseline `dmr-X` index (commit `55513fb`; this worktree is 1 commit ahead, so the CLI
warns the index may be stale — that staleness is expected and recorded per call). Test runs used
`bun vitest run --config vitest.config.ts --project unit --maxWorkers 1 --retry 0` (not `npx`),
per the resume instructions.

## 1. RED baseline → GREEN

`tests/unit/mcp-production-auth-session.test.ts`: baseline **9 failed / 2 passed** (reproduced in-session
before any edit; matches `reports/mcp-production-auth-session-red.json`). After the fixes below: **11/11 pass**.

## 2. GitNexus impact records (before each edit; HIGH/CRITICAL surfaced first)

| Symbol (file) | Direct callers | Affected processes | Risk | Action |
|---|---|---|---|---|
| `checkAuthAndGetAllowedTools` (`services/mcp-server/src/index.ts`) | 2 (`checkAuth`, `httpServer`) | 0 | LOW | Edited (delegates to shared policy; behavior preserved + config-only/env-only enforced, fail-closed malformed) |
| `touchSession` (`services/mcp-server/src/index.ts`) | 2 (`httpServer`, `onsessioninitialized`) | 0 | LOW | Session lifecycle kept; cleanup now closes transport AND server via shared helper |
| `startSSE` (`services/mcp-server/src/index.ts`) | 1 (`main`) | 0 | LOW | Edited (binding checks, capacity cap, close-both lifecycle, shared eviction) |
| `drainSessions` (`services/mcp-server/src/index.ts`) | 1 (`disposeAndExit`) | 0 | LOW | Edited (deduplicated onto `closeHttpSessionResources`; still closes transport AND server) |
| `resolveGatewayKey` (`services/mcp-server/src/tenant-key.ts`) | 10 direct, 22 total incl. `dispatchTask`, gateway calls, `createDMRXMcpServer`, `handleRpcStream` (1 process) | 1 (`handleRpcStream → IsTerminal`) | **CRITICAL** | **WARNING — NOT edited.** `tenant-key.ts` is untouched; AsyncLocalStorage isolation preserved as-is. Any future change here needs A2A-lane coordination. |
| `buildBearerAuthPolicy`, `BoundSessionRegistry`, `guardHttpRequest` | absent from baseline index | UNKNOWN (new-symbol limitation) | n/a | Covered via enclosing/caller impacts above; no repo rules disabled; no find-and-replace renames. |

Exact CLI form used (example): `gitnexus impact checkAuthAndGetAllowedTools -r dmr-X -d upstream -f services/mcp-server/src/index.ts`.

## 3. Changed files

- `services/mcp-server/src/auth-runtime.ts` (modified): validated simple + file (`apiKeysConfig`) + env
  (`DMRX_MCP_API_KEYS_CONFIG`) bearer modes; any malformed configured source → `{configured:true, malformed:true,
  keys:[]}` and `authenticateBearer` denies everything (fail-closed); no-source → anonymous open (unchanged);
  principal is immutable SHA-256 hex of the validated key (never contains the raw key); `allowedTools` returned
  as a defensive copy.
- `services/mcp-server/src/session-runtime.ts` (modified): `readSessionBinding` rejects array (ambiguous)
  tenant headers, trims whitespace-only to unbound; `BoundSessionRegistry.get` enforces exact
  principal+tenant match; `add` is async and closes evicted/replaced entries (transport AND server);
  `close`/`closeAll` close both resources exactly once via a closed-id guard (eviction vs explicit close races).
- `services/mcp-server/src/http-auth-session.ts` (**new**, small shared helper, not a framework):
  per-request policy builder, `authenticateHttpRequest` (401 missing/invalid, **500** malformed — server-side,
  distinct from client credential failure), `ownerIdForA2A`, binding helpers, `closeHttpSessionResources`,
  `evictOldestHttpSession`, and the version gate (`MCP_LATEST_PROTOCOL_VERSION='2025-11-25'`,
  `MCP_SUPPORTED_PROTOCOL_VERSIONS` = 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07 —
  exactly the installed SDK 2.0.0 set; nothing else advertised).
- `services/mcp-server/src/index.ts` (modified): `checkAuthAndGetAllowedTools` delegates to the shared policy
  (fixes the old early `MCP_API_KEYS.length===0` return that ignored config-only deployments); removed dead
  `parseApiKeys`/`MCP_API_KEYS`/`checkAuth`; startup production gate uses `hasConfiguredBearerAuth()` so
  standalone `apiKeysConfig`/env deployments count as authenticated; both listeners run
  `guardHttpRequest` (exact Origin allowlist, AsyncLocalStorage scope via `runWithRequestHeaders` — unchanged)
  then authenticate → bind (400 on ambiguous, 403 on binding mismatch) → version gate → dispatch; SSE and
  streamable both cap at 50 sessions with shared close-both eviction; init-failure path releases both
  resources exactly once; `drainSessions` deduplicated onto the shared closer; session-less POST bodies are
  buffered (existing `readBodyWithLimit`), initialize versions validated (`checkMcpInitializeBody`) and the
  parsed body forwarded to `transport.handleRequest(req, res, parsedBody)`; GET streams skip the
  missing-header rejection (they inherit the negotiated session version; fetch/EventSource clients cannot
  always set headers).
- `services/mcp-server/src/http-security.ts`, `tenant-key.ts`: unchanged (A2A tool-restricted denial and
  AsyncLocalStorage isolation already correct; covered by existing tests).
- `tests/unit/mcp-transport-protocol.test.ts` (**new**, 25 tests): version-gate units, wiring units, and real
  SDK-2.0.0 interop on ephemeral loopback fixtures (legacy 2025-03-26 initialize/list/call, current stateful
  Client flow, stateless flow with no session id minted, legacy SSE flow, SDK-leniency documentation +
  production-order rejection of unsupported versions and header/body disagreement).

## 4. Exact commands and results (all real, nothing invented)

- `bun vitest run --config vitest.config.ts --project unit --maxWorkers 1 --retry 0 tests/unit/mcp-production-auth-session.test.ts` → **11 passed** (was 9 failed / 2 passed).
- `bun vitest run --config vitest.config.ts --project unit --maxWorkers 1 --retry 0 tests/unit/mcp-transport-protocol.test.ts` → **25 passed** (1 failed mid-work: raw SDK accepts unknown versions by upgrading to latest — probed live: status 200, `protocolVersion 2025-11-25`, session minted; the production body gate was added because of this finding, and the test now documents the leniency plus the gate's 400 rejection).
- Adjacent regressions, same runner: `mcp-production-auth-session`, `mcp-http-security`, `mcp-tenant-key`, `mcp-tool-restrictions`, `mcp-session-sweep`, `mcp-config` → **6 files, 71 tests, all passed**.
- `bun x tsc --noEmit -p services/mcp-server/tsconfig.json` → **clean** (one self-caught `throw;` syntax error fixed during wiring).
- Out-of-lane status only (NOT edited): `tests/unit/a2a-production-ownership.test.ts` → **3 failed** (A2A implementation gaps: owner-error code, legacy 404 enforcement, plus the mechanical `toHaveProperty` on undefined metadata). The brief permits repairing that one assertion as equivalent intent, but the suite would stay red on A2A-lane implementation behavior, so no test was touched to avoid masking another lane's RED. 0 skipped everywhere above.

## 5. Decisions and seam coordination (no A2A edits)

- Scoped keys → A2A boundary: enforced at the shared HTTP boundary (`guardHttpRequest` denies `allowedTools`-scoped
  keys on `/a2a*` before dispatch — unchanged, tested). `ownerIdForA2A(auth)` derives the task owner from the
  VALIDATED hashed principal (`'unauthorized'` when not authorized; never the raw key). **A2A lane seam:** the A2A
  handler owns integration — call `ownerIdForA2A` with the already-authenticated result, persist tasks under it,
  and enforce it on list/get/cancel/resubscribe/push-config including legacy paths.
- Downstream tenant binding: `X-DMR-Tenant-Key` remains a binding claim, never identity; sessions verify
  principal+tenant on every reuse (ids are not authorization).
- Malformed auth config over HTTP is a **500** (operator must fix), distinct from 401 credential failure.
- Unsupported MCP versions fail with 400 + supported list at the listener; the SDK's silent upgrade never
  reaches clients through `/mcp`. Only SDK-2.0.0-supported versions are advertised; no initialized state faked.

## 6. Remaining gaps (not claimed as done)

- A2A task ownership enforcement (3 failing ownership tests) — A2A lane owns; `ownerIdForA2A` is ready for them.
- Unexercised protocol capabilities: elicitation, sampling, roots, task-augmented requests, JSON-RPC batching,
  `ListTasks` semantics against the versioned transports, OAuth interop, cross-key session ownership and
  cross-company A2A isolation (same caveats as the 2026-09-28 gate report).
- Full unit project (~1.7k tests) not re-run here (disk/time); only owned + adjacent suites. Parent owns final
  integration and `detect_changes` before any commit. No TODO stubs reported as finished.
