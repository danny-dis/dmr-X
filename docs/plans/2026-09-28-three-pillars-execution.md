# Three-pillar production implementation — wave 2

Existing stack and source preserved. No daily listener restart or provider-policy change before isolated verification. External provider capacity is not an unconditional availability guarantee. All free checks are explicitly free-only.

## Ownership
- Sol runtime: lifecycle.ts and agentic.routes.ts; exact TTL/idle/budget termination and active provider cancellation.
- Sol MCP: mcp-server index.ts/http-security.ts and dedicated helper modules; config-only auth, owner-bound sessions, cleanup and versioned protocol transport.
- Sol A2A: a2a/ subtree; owner-bound persisted tasks/contexts, safe notifications, cancellation, protocol follow-up.
- Astra integration: agent registry/runtime context and agent routes for explicit workspace sharing; staging fixtures, gateway/free reliability, scheduler follow-up, review.
- Luna: bounded read-only spec review, then quality review.

No overlapping writes; new tests have lane-specific names. Workers do not modify trackers, reindex, commit or touch daily data. Parent records ownership here and agents-checklist.md.

## Frozen integration seams
- MCP continues to call handleA2ARoutes(req,res,config,tools) after authentication.
- A2A derives principal from validated bearer headers; caller metadata cannot set ownership. Credential-derived identifiers must not be returned as raw secrets.
- Team=existing tenant/workspace (no new team service). Share definition by explicit owner grant to recipient tenant, permission read or run. Each recipient deployment/session/usage remains recipient-owned. Revocation denies subsequent requests. No edit/admin/credential/history grant implied.
- Preserve AsyncLocalStorage request headers and existing free-only quota policy.

## Acceptance matrix
1. Gateway: readiness tied to usable lifecycle; no unbounded retry; free-only failover excludes paid capacity; timeout/cancel frees reservations; streams correctly terminate; provider fault recovery verified.
2. Runtime: create, deploy, run, stream, persist/reopen/resume; deadline/budget/cancellation terminal behavior; two workspaces isolated; explicit sharing/read/run/revoke verified with real DB and HTTP.
3. MCP: key modes fail closed; no session-ID authorization; independent client initialize/list/call/close; correct current versus legacy version handling; connection and session cleanup.
4. A2A: send/get/list/cancel/stream, principal isolation across context/task operations and restart; safe webhook delivery; only tested version contracts advertised.
5. Scheduler: crash after claim cannot silently duplicate a scheduled occurrence; semantics documented and deterministic restart test.
6. Release: full tests, package builds, non-local-mode HTTP staging, real free-only samples, soak/fault probes, spec and quality reviews. Record actual results and unresolved gates; do not substitute mock outcomes or claim zero downtime from a short sample.

## Execution
Each slice: inspect callers/impact, behavioral RED, minimal patch, focused GREEN/typecheck, independent review, integrated verification. Add only needed schema grants; reuse existing APIs/storage. No speculative frameworks, redundant federation or billing stack.
