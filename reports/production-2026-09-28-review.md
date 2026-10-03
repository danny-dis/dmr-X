DMR-X production patch review — 2026-09-28

Verdict at review time: BLOCKED — one concrete new regression found.

Integrator disposition: accepted as an intentional security-hardening compatibility change, not a reason to restore wildcard browser trust. The default is now an explicitly empty allowlist; `docs/COMPANY-GATEWAY.md` requires exact configured Origins and disclaims default browser compatibility. Added a real HTTP regression for both empty and wildcard configurations (browser denied, origin-less native client accepted). Final focused MCP suites: 15/15; MCP typecheck passed. This disposition was not independently re-reviewed. All broader release HOLD gates remain.

Scope reviewed: current diffs in a2a-proxy.routes.ts, agent-chat.routes.ts, MCP index.ts and tenant-key.ts, new http-security.ts, and related new tests. No implementation changes made. Full suites were not run.

P1 / correctness regression — default CORS policy rejects every browser request

- services/mcp-server/src/index.ts:274 sets CORS_ORIGIN to '*' by default.
- services/mcp-server/src/http-security.ts:16-19 removes '*' from allowedOrigins, then rejects every request carrying an Origin header unless an explicit origin is configured.
- Result: with the default configuration, browser MCP/A2A requests receive 403 Forbidden Origin, while native requests without Origin continue to work. This is a new default-runtime regression, not covered by the green origin test because that test supplies an explicit configured origin.
- Security intent is reasonable, but the patch must either require/document an explicit origin configuration and accept the intentional breaking default, or define a safe wildcard behavior. Do not claim default browser compatibility while this remains.

No additional concrete blocker found in the reviewed A2A native pinned-IP/redirect/size handling or the chat/resume instance+definition checks. The explicitly out-of-scope gaps (task ownership, complete session ownership, webhook SSRF, and protocol conformance) remain unreviewed/blocked as stated and are not treated as findings here.

Evidence supplied for this review: unit run 1737/1737; Bun peer HTTP probe green; isolated MCP HTTP transport auth/origin probes green. Those results do not cover the default '*' browser case above.
