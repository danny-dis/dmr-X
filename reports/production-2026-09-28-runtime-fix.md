# Runtime finding 1 fix: durable conversation instance binding

Date: 2026-09-28
Parent checklist: `dmrx-production-2026-09-28`
Scope: finding 1 only. Broader lifecycle, scheduler, cancellation, and budget findings were not changed.

## Ownership

Changed only:

- `apps/gateway/src/routes/agent-chat.routes.ts`
- `tests/unit/agent-chat-instance-binding.test.ts` (new)
- `reports/production-2026-09-28-runtime-fix.md` (this report, required evidence)

No existing tests were edited. No commit, environment change, listener restart, or GitNexus reindex was performed.

## Impact check

Before editing `agentChatRoutes`, I ran:

`gitnexus impact agentChatRoutes --direction upstream --repo dmr-X --file apps/gateway/src/routes/agent-chat.routes.ts --depth 3 --limit 250`

It reported CRITICAL risk, 172 impacted symbols, 69 allegedly direct callers, and zero affected processes/modules. The result is unreliable: alleged direct callers included unrelated database, tokenizer, quota, UI, and utility symbols that do not call this route plugin. The index was also stale (`322afe4` indexed versus current `55513fb`). Per instruction, I did not reindex.

Manual direct-caller check found the real registration path in `apps/gateway/src/server.ts`: `createServer` imports `agentChatRoutes` and registers it under `/v1` (`server.ts:68`, `server.ts:117`, `server.ts:764-765`). Both chat modes share the same POST handler, so the binding check covers non-streaming and streaming entry.

## TDD evidence

### RED (before production edit)

Command:

`bun vitest run --project unit --maxWorkers 1 tests/unit/agent-chat-instance-binding.test.ts`

Result: exit 1; 1 file failed; 5 tests failed and 1 passed. Every mismatch request returned 200 instead of the required 404:

- non-streaming chat with another instance's conversation
- streaming chat with another instance's conversation
- chat with a different definition binding
- resume with a different instance binding
- resume with a different definition binding

The same-instance/same-definition resume baseline passed before the fix.

### GREEN (after minimal production edit)

Same command result: exit 0; 1 file passed; 6 tests passed.

Regression tests use real Fastify route registration and `app.inject`. Only expensive/external boundaries are mocked: runtime context/execution services, durable store access, tool registry, model loop, and registry analytics. Assertions verify 404 response bodies, that the model loop is never entered, and that mismatches are never persisted.

Exact test cases:

1. chat rejects another instance's transcript in non-streaming mode
2. chat rejects another instance's transcript in streaming mode
3. chat rejects another definition's transcript
4. resume rejects another instance's transcript with the same response as an absent durable session
5. resume rejects another definition's transcript with the same response as an absent durable session
6. matching instance and definition still resume successfully

## Implementation

After tenant-scoped session lookup, both chat and resume now require:

- `persisted.agentInstanceId === context.instanceId`
- `persisted.agentDefinitionId === context.definition.id`

Chat mismatches return `404 { error: { message: "Conversation not found" } }` before transcript loading or streaming begins. Resume mismatches return the existing absent-session 404 body, `No durable session to resume`, so the resume endpoint does not distinguish absent sessions from sessions bound elsewhere.

## Affected-suite and build verification

Command:

`bun vitest run --project unit --maxWorkers 1 tests/unit/aaas-eve-features.test.ts tests/unit/agent-chat-loop-features.test.ts tests/unit/agent-chat-loop-final-summary.test.ts tests/unit/agent-chat-loop-empty-reply.test.ts`

Result: exit 0; 4 files passed; 35 tests passed.

Command:

`bun run --cwd apps/gateway build`

Result: exit 0 (`tsc`).

Vitest emitted the repository's existing `test.poolOptions` deprecation warning; it did not affect results.

## Unresolved blockers

No unresolved blocker remains for this scoped fix. The stale/corrupted GitNexus graph remains unreliable and was not rebuilt. Findings 2-5 from the runtime audit remain intentionally untouched.
