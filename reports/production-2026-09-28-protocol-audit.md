# DMR-X production protocol audit — 2026-09-28

Scope: read-only audit of `services/mcp-server/src`, `services/mcp-client/src`, and `apps/gateway/src/routes/a2a-proxy.routes.ts`, with emphasis on company-gateway integration, MCP/A2A auth and tenant boundaries, current protocol versions, task lifecycle/cancellation/streaming, Origin handling, and SSRF.

Result: **not production-ready for externally reachable MCP/A2A traffic**. Five actionable blockers follow. Backward-compatible legacy surfaces are not themselves defects; the issue is where the implementation claims/currently advertises a newer protocol while retaining incompatible semantics or missing required controls.

## Blockers

### 1. P0 — A2A bypasses configured HTTP authentication and has no tenant ownership boundary

**Files/lines**

- `services/mcp-server/src/index.ts:716-740` and `894-918`: A2A routing executes at lines 724-727 / 902-905 **before** `checkAuthAndGetAllowedTools`; auth is only applied later to `/sse` or `/mcp`.
- `services/mcp-server/src/task-manager.ts:147-151,178-216,219-250,307-337`: one process-global task map; Task has no owner/tenant field and get/list/cancel/push-config operations accept only a task ID.
- `services/mcp-server/src/a2a/jsonrpc.ts:173-245`: `tasks/get`, `tasks/cancel`, `tasks/list`, and push-config get/set perform no principal/tenant check.
- `services/mcp-server/src/tenant-key.ts:65-78`: the unverified inbound `x-dmr-tenant-key` is accepted as the downstream gateway bearer token.

**Proof**

The server calls `handleA2ARoutes()` before either transport auth gate. Once routed, every task operation uses the same singleton `A2ATaskManager`; knowledge of a task ID is sufficient to read, cancel, or attach a webhook to it. In production, `DMRX_MCP_API_KEY` being required at startup (`index.ts:1127-1134`) does not protect A2A because A2A never reaches that check. This is both an authentication bypass and a cross-company task boundary failure.

**Minimal test-first fix**

1. Add HTTP integration tests for both SSE and Streamable HTTP listeners proving unauthenticated `/a2a` requests return 401 and key A cannot get/cancel/list/configure a task created by key B.
2. Move a shared auth/principal resolution gate ahead of all non-public A2A routes (leave only Agent Card discovery public if intended).
3. Persist an immutable owner/tenant ID on each task and require it in every task lookup, list, cancellation, resubscription, and push-config operation. Do not treat a caller-supplied gateway key as an identity without validating it.

### 2. P0 — A2A push notification URLs are an SSRF primitive

**Files/lines**

- `services/mcp-server/src/a2a/jsonrpc.ts:135-139,227-245`: arbitrary `pushNotificationConfig.url` values are stored with only a truthy-string check.
- `services/mcp-server/src/a2a/persistence.ts:258-281`: terminal task completion performs `fetch(pc.url, ...)` directly, including caller-controlled authorization material, with no scheme/IP validation, DNS pinning, or redirect policy.

**Proof**

An A2A caller can submit an inline push URL or set one on a task, then cause completion. The sidecar will POST from the trusted host to that URL. Values such as loopback, link-local/cloud metadata, RFC1918 addresses, or a public hostname that later rebinds are not rejected. This is reachable through the unauthenticated surface described in blocker 1.

**Minimal test-first fix**

1. Add tests rejecting `file:`, loopback, RFC1918, link-local/metadata, IPv4-mapped IPv6, and a DNS-rebinding fixture; add a redirect-to-private test.
2. Validate at registration and again at delivery, allow only HTTPS in production, pin the validated DNS result into an `undici.Agent` dispatcher, and disable redirects or revalidate every redirect hop.
3. Consider an explicit outbound webhook allowlist for company deployments.

### 3. P1 — Admin peer probe validates DNS, then discards the pin (DNS rebinding/redirect SSRF)

**Files/lines**

- `apps/gateway/src/routes/a2a-proxy.routes.ts:304-330`: `validateBaseUrlForSSRF()` is called, but the subsequent `fetch(url, ...)` uses the default resolver.
- `apps/gateway/src/routes/admin-ssrf.ts:143-161,217-229`: the validator explicitly returns a pinned `lookup` and documents that callers must install it in a dispatcher to close the rebinding window.

**Proof**

The probe uses only `validated.url`; it does not use `validated.lookup`. The hostname is therefore resolved once during validation and independently again during fetch. A rebinding hostname can resolve publicly for validation and privately for connection. Default redirect following creates a second bypass because redirect targets are not revalidated.

**Minimal test-first fix**

1. Add a gateway route test whose validator returns a pinned lookup and assert the fetch dispatcher uses it; add redirect-to-loopback rejection.
2. Mirror the established admin route pattern: `new Agent({ connect: { lookup: validated.lookup } })`, pass it as dispatcher, set `redirect: 'manual'`, and revalidate explicitly if redirects are supported.

### 4. P1 — Streamable HTTP is a legacy session implementation, not MCP 2026-07-28 compliance; Origin is not validated

**Files/lines**

- `services/mcp-server/src/index.ts:273-289`: default CORS is `*`; allowed headers advertise `Mcp-Session-Id` and `Last-Event-ID`; no Origin rejection exists.
- `services/mcp-server/src/index.ts:292-353,879-882,916-980`: server maintains protocol sessions, consumes `mcp-session-id`, generates a session ID, and creates one MCP server per session.
- `services/mcp-server/src/index.ts:952-965`: `sessionIdGenerator` explicitly mints protocol session IDs.
- `services/mcp-client/src/registry.ts:115-126`: HTTP client delegates negotiation to the v2 SDK and sends the correct dual Accept header, but no evidence in this code establishes 2026-07-28 request-metadata/header compliance.

**Proof against current spec**

The official MCP 2026-07-28 Streamable HTTP page says the revision removed protocol-level sessions and the GET stream endpoint; every request is its own POST. It also requires validating every supplied `Origin` and returning 403 for an invalid Origin. Earlier session behavior may be retained as backward compatibility, but this implementation has only the session path and does not distinguish a current stateless mode. Therefore it must not be claimed as current 2026-07-28 compliance.

**Minimal test-first fix**

1. Add conformance tests for stateless POSTs with no `Mcp-Session-Id`, invalid Origin → 403, current protocol-version/request metadata headers, notification status semantics, and GET/DELETE `/mcp` → 405.
2. Configure the current SDK transport in stateless/current mode (no session generator/map) for 2026-07-28. Keep the existing stateful transport only as a separately negotiated/versioned legacy path.
3. Replace permissive Origin behavior with an explicit allowlist; absence may remain acceptable for non-browser clients, but a present invalid Origin must be rejected.

### 5. P1 — A2A advertises 1.0 but ignores mandatory version negotiation

**Files/lines**

- `services/mcp-server/src/a2a/agent-card.ts:182-193,279-306`: primary `supportedInterfaces` advertises protocol version `1.0` while the legacy top-level field advertises `0.3.0` for compatibility.
- `services/mcp-server/src/a2a/handler.ts:42-115,122-219`: request dispatch never reads `A2A-Version` from the header or query parameter and never returns `VersionNotSupportedError`.
- `services/mcp-server/src/a2a/jsonrpc.ts:28-39`: the error table has no version-not-supported error.

**Proof against current spec**

A2A 1.0 requires clients to send `A2A-Version` on each request (empty means 0.3), and servers must execute the requested major.minor semantics or return `VersionNotSupportedError`. DMR-X always executes one mixed implementation regardless of requested version. Advertising a 1.0 interface is therefore a false compliance claim; retaining 0.3 fields is valid compatibility, but silently ignoring version selection is not.

**Minimal test-first fix**

1. Add handler tests for `A2A-Version: 1.0`, empty/missing → 0.3 compatibility, query-parameter version, and unsupported `9.9` → the normative version error.
2. Parse and normalize major.minor at the transport boundary, pass the selected version into dispatch/serialization, and explicitly branch only where 0.3 and 1.0 semantics differ.
3. Until those tests pass, advertise only the actually supported legacy version rather than `supportedInterfaces[].protocolVersion = "1.0"`.

## Lifecycle notes not promoted above the five-blocker cap

- `services/mcp-server/src/a2a/task-manager.ts:270-320` correctly prevents terminal-state resurrection, and `dispatch.ts:140-164` drops late results after cancellation.
- Cancellation is logical only: `tasks/cancel` does not abort the in-flight gateway `fetch` (`dispatch.ts:111-137`). Work and provider cost continue until completion/timeout. Add an AbortController registry keyed by task ID after the boundary/security blockers.
- `message/stream` emits lifecycle status objects rather than token streaming; that can be valid task-event streaming, but cancellation/disconnect should unsubscribe and abort work. `handler.ts:200-206` has no response-close cancellation hook.

## Commands and recorded results

- `git status --short --branch && git log -1 --oneline`
  - Branch `plan/ui-agent-runtime-v2`, ahead 4.
  - Pre-existing changes: `TODO.md`, `agents-checklist.md`, untracked `reports/`.
  - HEAD `55513fb fix(quota): share cryptographic reservation ID across capacity stores`.
- `node .gitnexus/run.cjs status`
  - Repeated result: index stale; indexed commit `322afe4`, current `55513fb`, indexed 2026-09-25 14:10:44.
  - Parent-owned refresh did not become current within the audit budget, so no GitNexus query was run and no competing `analyze` was started.
- Official sources fetched:
  - MCP Streamable HTTP 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
  - A2A 1.0.0: https://a2a-protocol.org/v1.0.0/specification/
- Targeted tests were not run before the eight-minute cutoff; this audit is grounded in source inspection and official normative text, not inferred test output.

## Read-only compliance

No code, config, credentials, trackers, processes, or commits were changed. The only written artifact is this report.
