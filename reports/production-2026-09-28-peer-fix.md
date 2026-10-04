# A2A peer probe SSRF fix — red/green report

Date: 2026-09-28
Scope: `apps/gateway/src/routes/a2a-proxy.routes.ts` and `tests/unit/a2a-peer-probe-security.test.ts`
Parent checklist: `dmrx-production-2026-09-28` (not edited)

## Impact and caller review

Pre-edit command:

`gitnexus impact a2aProxyRoutes --repo dmr-X`

Result: **CRITICAL**, 172 impacted symbols (69 direct, 72 at depth 2, 31 at depth 3; no processes/modules reported). The parent previously observed CRITICAL/209. The graph is not trustworthy after the failed incremental FTS rebuild: its alleged direct callers include unrelated database, tokenizer, UI, and utility symbols. No reindex was run.

Manual caller inspection found:

- `apps/gateway/src/server.ts` imports and registers `a2aProxyRoutes` under `/v1`.
- `apps/ui/src/lib/queries/a2a.ts` calls `/admin/a2a/peers/probe` through the admin API client.
- No other production caller of the peer-probe route was found.

## RED

Test added first: `tests/unit/a2a-peer-probe-security.test.ts`.

Command:

`bun vitest run --project unit --maxWorkers 1 tests/unit/a2a-peer-probe-security.test.ts`

Result before production edits: **FAIL** — 1 file failed, 3/3 tests failed.

Observed failures demonstrated that:

- no `undici.Agent` was created from the validator's pinned `lookup`;
- fetch did not receive `redirect: 'manual'`;
- no dispatcher existed to close after success or failure.

## Fix

The peer probe now:

- creates `new Agent({ connect: { lookup: validated.lookup } })` after SSRF validation;
- passes that Agent as the fetch `dispatcher` for every candidate URL;
- sets `redirect: 'manual'` and never fetches an unvalidated redirect target;
- cancels non-success response bodies;
- closes the dispatcher in `finally`, falling back to `destroy()` if close fails;
- streams and caps remote agent-card bodies at 1 MiB before JSON parsing.

## GREEN

Focused command after the fix:

`bun vitest run --project unit --maxWorkers 1 tests/unit/a2a-peer-probe-security.test.ts`

Result: **PASS** — 1 file passed, 3/3 tests passed.

Related regression command:

`bun vitest run --project unit --maxWorkers 1 tests/unit/a2a-peer-probe-security.test.ts tests/unit/a2a-agent-card.test.ts tests/unit/a2a-rpc-methods.test.ts`

Final result: **PASS** — 3 files passed, 30/30 tests passed.

Type check:

`bunx tsc -p apps/gateway/tsconfig.json --noEmit`

Result: **PASS** (exit 0, no diagnostics).

Vitest emitted only the repository's existing `test.poolOptions` deprecation warnings.

No environment files were edited, no server was restarted, no checklist was changed, and no commit was created.
