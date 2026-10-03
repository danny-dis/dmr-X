# Company gateway rollout — staging contract

**Status: staged rollout guide, NOT a production approval.** See [the production plan](plans/2026-09-28-production-gateway.md) and `reports/production-2026-09-28-*.md` for unresolved gates. Do not expose a shared MCP/A2A sidecar to unrelated tenants yet.

## The developer experience to ship

A company's application team should receive only:

- One HTTPS base URL, e.g. `https://ai.company.example/v1`.
- A revocable, expiring application key—not a provider key or gateway admin key.
- A short approved model list and explicit cost policy (`free` versus paid opt-in).
- A tested tool/agent catalog, usage limits, request IDs and support/error guidance.

Keep provider activation, master credentials, tenant administration, tool installation and outbound network policy with the operator. Avoid asking each application to understand provider accounts or sidecar ports.

## Existing pieces to reuse

Source-verified operator routes:

- `POST /v1/admin/tenants` with `{ "name": "Company name" }`.
- `POST /v1/admin/api-keys` with the returned `tenant_id`, a key name, explicit `role`, `scopes`, `allowed_tools` and `expires_at`. Review accepted values in `CreateApiKeySchema` before automating; omission is not equivalent to least privilege. The admin role permits cross-tenant access and must not be handed to applications.
- Existing provider activation, tenant/key policy and usage controls rather than a second control plane.

Existing inference interfaces are OpenAI (`/v1/chat/completions`), Anthropic (`/v1/messages`) and Gemini (`/v1/gemini/generateContent`). Treat the following as a staging smoke-request template, not proof that a particular deployment is ready:

```bash
curl --fail-with-body "$DMRX_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $DMRX_APP_KEY" \
  -H 'Content-Type: application/json' \
  -H 'x-cost-filter: free' \
  -d '{"model":"auto-agentic","messages":[{"role":"user","content":"Reply READY"}],"max_tokens":64,"stream":false}'
```

`DMRX_BASE_URL` ends in `/v1`; the example never permits paid fallback. Server-side policy must enforce the same rule—client headers alone are not company governance. Do not log key values or put them in source control.

For agents, reuse create/import → deploy → fixed instance chat/resume. Generate conversation IDs per application session. The new binding check rejects using one instance's persisted conversation through another instance. Do not promise immediate cancellation or crash-safe exactly-once schedules until their release tests pass.

## Ingress and identity

Proposed topology:

```text
Company applications / SDKs / agents
                |
       private HTTPS ingress
                |
       DMR-X gateway + policy
         |             |
    provider APIs   internal MCP/A2A sidecar
```

This is a target deployment contract; it was not deployed by this audit. A single public origin can route to multiple internal processes. A reverse proxy does not by itself solve identity translation or authorization.

Before staging:

1. Set `DMRX_LOCAL_MODE=false`; never use local-mode success as evidence of auth.
2. Require a strong admin key, encryption key and explicit browser-origin policy; use a secret manager/deployment secret mechanism.
3. Keep admin, metrics and the sidecar on protected/internal paths. Terminate TLS; restrict trusted proxies; disable buffering for SSE and streaming responses.
4. Verify missing/bogus/revoked keys are denied, and two companies cannot cross-read sessions, tasks, policies, tools or usage.
5. Match rate/body/time limits to bounded workloads, and validate structured errors/Retry-After instead of retry storms.

### MCP security change in this patch

Both SSE and Streamable HTTP now reject any supplied Origin not explicitly listed in `DMRX_MCP_CORS_ORIGIN` (comma-separated exact origins). `*` is not accepted as a security allowlist; clients without an Origin header remain eligible. Browser integrations must configure their exact scheme/host/port.

Non-public A2A routes now use the configured MCP bearer authentication gate before dispatch. Keys with an `allowedTools` restriction are denied A2A access until a real A2A policy mapping exists. Public agent-card discovery remains public. These controls **do not** implement per-tenant task ownership or make current A2A/MCP version claims conformant.

## Free-only service expectations

The live sample passed 16/18 checks: agentic 6/6, coding 6/6, smart 4/6. One selected model answered incorrectly and one request exhausted its deadline. This is a useful baseline, not a company availability guarantee or a proof that all usage accounting is correct.

- Keep free-only admission fail-closed on direct, alias, cached, sticky, hedged and fallback paths.
- Pool capacity by provider account, not merely key count.
- Honor provider cooldowns and finite deadlines; give actionable 429/503 responses.
- Measure quality, time-to-first-token, completion latency and exhaustion recovery across representative tasks and different quota states.
- Paid or local fallback must be explicitly enabled by company policy, never silently substituted.

## Rollout gates

1. **Security:** tenant-owned MCP sessions/A2A tasks, safe webhooks, model/tool policies, pre-dispatch budget admission and independent negative tests.
2. **Protocol:** advertised versions pass an independent SDK/conformance suite; current failing paths are fixed or explicitly excluded from the release contract.
3. **Runtime:** cancellation reaches active provider calls; deadlines and budgets terminate work; restart/scheduled side-effect semantics are tested and documented.
4. **Operations:** backup restore, secret rotation, key revocation, graceful drain, upgrade/rollback, load/soak and alerts exercised in staging. Begin with a single writer deployment; do not imply untested multi-host HA.
5. **Pilot:** one internal team with restricted tools and bounded free workloads; expand only when those measured gates pass.

No new framework, federation system, marketplace, billing engine or database replacement is required for this first release scope.
