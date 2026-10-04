# DMR-X production-readiness gate report — 2026-09-28

## Decision: HOLD

The research/audit and first security repair slice are complete. **DMR-X is not yet approved as a shared company production gateway with every feature enabled.** Passing unit tests does not close protocol, ownership, crash, accounting or operational gaps. No deployment, commit, daily configuration change or daily listener restart was performed.

## Progress established

- Branch audited: `plan/ui-agent-runtime-v2`; starting HEAD `55513fb`.
- Existing progress includes durable SQLite agent sessions, tenant-scoped runtime context, agent RBAC/deployment, quota reservations and free-only routing/fallback protections. Recent quota and routing work was preserved.
- Research and implementation/release plan: `docs/plans/2026-09-28-production-gateway.md`, with seven official sources and a machine-verified citation mapping.
- Company-facing staging/onboarding contract: `docs/COMPANY-GATEWAY.md`.
- Two bounded Sol audits and two Sol implementation workers were used; Astra integrated and independently exercised the results. A bounded Luna review identified the browser default compatibility break; the explicit fail-closed policy, migration documentation and final regression are recorded in the review disposition.

## Changes actually implemented

1. **Agent conversation binding:** persisted chat/resume sessions must match both the addressed deployed instance and definition. Mismatch returns a non-disclosing 404 before execution. Six route tests cover the regression and valid continuation.
2. **MCP credential concurrency:** process-global last-request headers replaced with AsyncLocalStorage. Both HTTP listeners enter an explicit `.run()` scope. The existing setter remains request-context scoped for compatibility. An interleaved regression first returned company B's key to company A and now passes; scope restoration is tested.
3. **Shared HTTP boundary:** both MCP HTTP transports validate exact allowed Origins before dispatch. Invalid Origins/preflights return 403. Non-public A2A routes reach the configured MCP authentication gate; tool-restricted keys cannot bypass their scope through A2A. Public agent-card discovery stays public. This is authentication hardening, **not task/session tenant-ownership enforcement**.
4. **A2A peer probe:** native HTTP(S) request connections use the validated IP via a lookup hook, retain the original hostname/TLS identity, do not follow redirects, cap card responses at 1 MiB, and destroy rejected responses. The initial Undici implementation passed mocked tests but failed real networking; it was replaced and re-tested on Node/Vitest and Bun.

No routing weights were tuned to the small quality sample. No new framework/service/database was introduced.

## Execution evidence

### Unit and type checks

- Full unit project: **1,737 passed, zero failed/skipped; 152 test files** before the final explicit CORS-default clarification and added policy test. The affected final MCP suites were rerun below. Evidence: `reports/production-2026-09-28-full-unit.json`.
- Final focused MCP suites: **15 passed**, including the final empty/wildcard Origin policy regression. Evidence: `reports/production-2026-09-28-mcp-final.json`.
- Initial gateway/free admission baseline: **64 passed** in six files. Evidence: `reports/production-2026-09-28-gateway-baseline.json`.
- Gateway, agent-runtime, MCP-server and MCP-client TypeScript checks passed; gateway and MCP-server were rechecked after their final code changes. These were `tsc --noEmit`, not a release binary/container build.
- Native Bun peer networking test: **1 test / 5 expectations passed** via `bun test scripts/production-bun-peer.test.ts`. It exercises valid-card DNS pinning, redirect rejection and declared-size rejection with a loopback fixture. DNS validation is mocked ONLY to authorize the local fixture; actual networking is real.
- `git diff --check` passed. Existing Vitest poolOptions deprecation warnings and Git line-ending warnings remain.

### Fresh isolated source listeners

`python scripts/production-isolated-http.py` passed **18/18 assertions**, nine on Streamable HTTP and nine on legacy SSE:

- public agent-card discovery;
- A2A missing/bogus credentials denied;
- restricted MCP key denied A2A;
- valid configured key allowed legacy task listing;
- hostile Origin and hostile preflight denied;
- allowed preflight succeeds;
- unauthenticated MCP endpoint denied.

Evidence: `reports/production-2026-09-28-isolated-http.json`. The harness uses temporary DB/config/workspace paths, removes provider credentials from the child environment, disables automatic `.env` loading and points downstream inference at an unused loopback port. Startup still performs credentialless catalog discovery. It runs no inference or arbitrary tools. Both owned test listeners are terminated in `finally`; diagnostic files are retained.

This harness validates configured simple bearer plus restricted-key behavior. It does **not** prove standalone `apiKeysConfig`-only deployments, OAuth interoperability, cross-key session ownership or cross-company A2A isolation.

### Daily free-only baseline (before changes, unchanged daily listener)

`python scripts/production-free-baseline.py`: **16/18 functional passes**.

- `auto-agentic`: 6/6.
- `auto-coding`: 6/6.
- `auto-smart`: 4/6. Wrong arithmetic response from the selected `command-r7b-12-2024`; separate coding request returned 503 after the provider deadline.
- All requests explicitly used `x-cost-filter: free`. Passing functional output does not prove invoice/accounting correctness or contractual free-provider capacity.
- The scorer's streaming checks passed. No gateway restart occurred during this sample.

Evidence: `reports/production-2026-09-28-free-live.json`. Free-only and quota invariants are covered by the unit project; the live sample is not a capacity SLO. Re-test at different quota states before making company reliability promises.

Final health observation: daily gateway `/health` returned 200; listener PID remained **7416** on 47113. Sidecar PID **9080** remained on 47114. New source fixes were verified on isolated listeners, **not hot-deployed to the daily service**.

## Still blocking the all-features production claim

### Security / tenant policy

- Persist authenticated ownership on A2A tasks and enforce it on list/get/cancel/resubscribe/push-config, including legacy paths. MCP protocol sessions also need principal binding; session IDs are not authorization.
- Protect A2A notification URL registration and delivery against private/link-local destinations, DNS rebinding and redirects. Peer discovery protection does not fix webhook delivery.
- Bind downstream tenant identity to authenticated policy, not merely a caller-supplied header. Verify all supported MCP key configuration modes; the current authentication function's early no-simple-key return is not proof of config-only key enforcement.
- Prove model/tool override policy and company budget reservations before agent execution, then settle actual input/output usage. The bounded runtime audit found post-hoc/missing-pricing weaknesses that still need dedicated reproductions/fixes.

### Protocol conformance

- Current live MCP legacy initialize/list works (332 tools observed), but the current stateless request failed with `Server not initialized`. New Origin/auth fixes do not implement stateless protocol conformance.
- A2A advertises a 1.0 interface, but live `ListTasks` returned method-not-found. Version selection/schema/capability conformance remains unverified. Implement the advertised contract or withdraw unsupported claims; do not equate legacy task-list success with 1.0 support.
- Execute independent SDK conformance checks and real, policy-safe tool/agent tasks. Discovery/catalog success is not proof that every registered tool works.

### Runtime and operations

- Reproduce/fix absolute TTL and idle deadline scheduling; link cancellation to the active provider AbortSignal and persist terminal status.
- Scheduled runs need occurrence identity and crash-safe deduplication; external side effects cannot be called exactly-once based on a process-local lock.
- Verify backup restore, upgrades/rollback, graceful drain, provider/key rotation, key revocation, load/soak and overload recovery in non-local-mode staging.
- Release builds/container image verification and an actual company onboarding smoke test are still required. No availability or latency SLO was invented for this audit.

## Minimal next release sequence

1. Close ownership, webhook egress and admission/security gates.
2. Make supported MCP/A2A versions explicit and pass independent clients.
3. Close cancellation/deadline/crash semantics with deterministic failure injection.
4. Run one-company staging onboarding through one HTTPS origin and scoped service keys.
5. Measure free capacity/recovery, then perform operational gates and a restricted internal pilot.

Do not add federation, marketplace, new billing infrastructure or a new data backend to solve these bounded defects. Reuse the existing gateway and stores; simplify duplicated boundary code only when the associated tests are green.

## Tooling limitations and review notes

The first GitNexus incremental rebuild failed with an FTS/index-consistency error and returned unrelated callers. A forced rebuild succeeded; critical early impact warnings were surfaced and complemented with direct caller inspection. The rebuild updated only generated index statistics in `AGENTS.md` and `CLAUDE.md`. No commit was made.

Audit reports are source findings, not automatically verified vulnerabilities. This report distinguishes reproduced/fixed behavior from remaining audit findings. The initial peer worker report describes the superseded Undici patch; the native transport and final test evidence above are authoritative for the delivered code.
