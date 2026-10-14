# Scoped repair save point

User authorized a local commit of Ishtar's deployed Receptionist/runtime repairs. This is not a release or full-project readiness certification. No push, restart, provider credentials/default changes, deletion or dependency installation is part of this commit.

## Included changes
- Receptionist: valid planning payload, eligible runnable assignments, explicit start tool, exact criterion-specific verification and substantive-output delivery gates, authoritative recorded-action receipts.
- Runtime: paired tool transcripts, fresh board reads, safe compaction boundaries, durable approval intent, partial approvals/denials, terminal checkpoint status and truthful provider-step accounting.
- Jobs: single planner admission, cancellation across async materialization/execution, explicit enqueue required for drafts, actual partial usage retained.
- HTTP/telemetry: incomplete/error operations are not successful executions; deterministic step-limit receipts do not invent actions.
- Cohere (separate commit): actual native token metrics and indexed streamed tool calls; omitted/invalid metrics remain unknown.
- Compiler scope excludes generated dist/report/recovery trees. This does not fix the root diagnostics.

Unrelated client protocols, sharing/teams, UI, job-queue changes, dependencies, workflow/Docker changes, already-staged research documents and earlier wake-lease work are intentionally excluded. Only the two Receptionist exports are selected from the mixed runtime barrel.

## Fresh pre-commit verification
Run from the repository root; run Bun suites as separate processes to isolate module mocks.

- `bun test reports/ishtar-edge-repair/checkpoint-review/checkpoint.test.ts`: 26 passed.
- `bun test reports/ishtar-edge-repair/token-usage/native-usage.test.ts`: 7 passed.
- `bun test reports/ishtar-edge-repair/ship-review/adversarial.test.ts`: 6 passed, including rerun after replacing workstation-specific import paths with relative paths.
- `bun test tests/native/ishtar-planning-admission.test.ts`: 10 passed.
- `bun test tests/native/ishtar-job-cancel.test.ts`: 17 passed.
- `bun test tests/native/ishtar-receptionist.test.ts`: 54 passed.
- `bun test tests/native/ishtar-receptionist-http.test.ts`: 10 passed.
- `bun test tests/native/ishtar-receptionist-receipt.test.ts`: 4 passed.
- `node node_modules/vitest/vitest.mjs run --config reports/ishtar-edge-repair/combined.config.ts`: 76 passed after correcting two stale feature-test assertions (terminal JSON status is completed; denied calls explicitly carry executed:false). Initial run: 74 passed, 2 failed.
- `node node_modules/vitest/vitest.mjs run --config reports/ishtar-edge-repair/review/focused.config.ts`: 20 passed.

Accidentally running the Vitest runtime-edge suite under Bun produced a harness error (`vi.hoisted` unavailable). The actual Vitest run above subsequently passed it; that failed invocation is not counted as a behavior regression or passing gate.

## Review and gates
Final narrow independent APPROVE and source hashes are retained under ship-review/. Reviewed application-source hashes matched current files before staging. Production files were not edited during this commit session; only fixture expectations and test/config paths were adjusted.

GitNexus status reported a stale graph. Refresh exceeded 90 seconds; detect_changes nevertheless completed against that existing graph and flagged critical shared-runtime risk. It cannot certify a fresh graph. The staged core check was attempted but exceeded 45 seconds. The staged Cohere check completed on the existing graph: five files, seven symbols, four affected processes, medium risk. Exact selected file diffs were checked independently; these results do not certify a fresh graph.

The actual root semantic check finished with compiler exit2, 233 diagnostics, no timeout and stable source. Full suite/release certification remains open. Prior live verification is documented in the task reports; this commit session does not rerun live jobs. Test-instance cleanup remains outstanding.
