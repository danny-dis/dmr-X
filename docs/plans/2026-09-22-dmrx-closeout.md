# DMR-X AaaS, UI, and GitHub Closeout Plan

> For the controller: use isolated OpenCode worktrees, test-driven development, independent review, and scoped commits. Do not interpret a green unit test or a passing documentation PR as proof of a live feature.

**Goal:** Preserve and commit the verified AaaS fixes, finish the UI V2 implementation locally, resolve the real job-planning defect, and reconcile each open PR and issue against evidence.

**Architecture:** Keep gateway/runtime, agent registry, and UI as separate lanes. Reuse the existing typed gateway API/query layer and React components. Small, reversible patches only; no mock production metrics, new frameworks, generic abstractions, or blanket issue closure (YAGNI).

**Stack:** Bun/TypeScript, React/Vite, Vitest, SQLite/sql.js, GitHub Actions, OpenCode.

**Starting state (22 September 2026):** `plan/ui-agent-runtime-v2` at `66b76e2`, with unrelated dirty UI/doc/artifact work. PRs #18 (draft docs), #19 (UI implementation, old failed typecheck), #20 (draft Jev spec with failed unit/security checks); issues #15 and #16 are broad incomplete backlogs. AaaS isolated reviews passed, registry build passed, and six focused suites passed. Isolated create/deploy/chat/resume passed; job planning twice returned HTTP 422, `planner returned an empty response`. The shared gateway is not evidence that the newly edited sources were deployed.

## Safety and ownership

- Never stage `.env`, keys, logs, artifacts, `.mote-audit.git/`, or unrelated changes. Preserve the dirty checkout; no `git add .`, reset, force push, blind restart of the shared gateway, or deletion of existing worktrees.
- Requested workers: `opencode/muse-spark-1.3-contributor-free` or `opencode/mimo-v2.6-flash-free`, after real smoke tests. `openrouter/meituan/longcat-2.0:free` currently errors; do not claim it ran or silently substitute it for a Hermes subagent model (which cannot be pinned per invocation here).
- Worktree/file ownership: UI lane owns UI files only and receives a copy of current uncommitted UI changes; job lane owns job planner and focused tests; PR/issue triage is read-only until a particular disposition is justified. The controller alone stages, commits, pushes, merges and closes.
- For code, test RED → minimal patch → GREEN; run affected regressions, build, and live tests. Apply GitNexus upstream impact before editing symbols, and `detect-changes` before committing.

## Task 1 — Commit completed AaaS fixes

**Files:** `apps/gateway/src/routes/{agent-chat-loop,tools.routes}.ts`, `services/agent-registry/src/agent-registry.service.ts`, `tests/unit/{agent-chat-loop-empty-reply,agent-instances,agent-tool-resolution}.test.ts`.

1. Recheck the six-file diff, secret scan added lines, `git diff --check`, and the six focused suites sequentially (parallel Vitest suites collide on SQLite migration).
2. Confirm registry build and relevant gateway typecheck; compare against known pre-existing failures rather than manufacturing a green claim.
3. Run `node .gitnexus/run.cjs detect-changes --repo dmr-X --scope unstaged` and inspect changed AaaS symbols; stage exactly those six files; review `git diff --cached` and `git status` for secrets and unrelated WIP.
4. Commit `fix(agents): harden chat, tools, and tenant installs`. Read back the commit's file list and leave every other dirty file untouched. Do not push until remote branch/CI plan is understood.

## Task 2 — Reproduce and repair job planning

**Files:** `apps/gateway/src/lib/job-runner.ts` and focused job tests (determine exact file names before editing).

1. Record the failing 422 live request/response on an isolated DB snapshot; inspect model response extraction and prompt constraints. Distinguish empty upstream content from parsing errors and free-model quota errors.
2. Write one failing regression for the observed empty-response case; use existing model fallback and retry contracts. Do not fabricate a plan or mask the failure.
3. Implement the smallest safe retry/fallback or extraction fix, with bounded attempts and explicit terminal errors; run focused tests, package build, and independent review.
4. On a fresh isolated server process (NOT `main.ts`, which may reap the shared gateway), exercise create → plan → run → terminal status and check resulting task records. If upstream free models still return empty replies, record a real blocker instead of declaring success.

## Task 3 — Finish UI V2 in isolated lanes

**Existing contract:** `docs/plans/DMRX_UI_AGENT_RUNTIME_V2_PLAN.md`. Phases 1–5 have commits; Phase 6 is dirty WIP in seven UI files. Phases 7–10 need gap analysis against existing source, not automatic rewrites.

1. Copy the exact dirty UI diff and untracked `apps/ui/src/lib/queries/bandit.ts` into a fresh UI worktree; do not ask agents to edit the primary dirty tree.
2. Phase 6: use real endpoint schemas for provider health, router scores, free-tier traffic, quota/reset and savings. Remove the invented traffic percentage, guessed exhaustion days, and unconditional paid-fallback claims unless backed by real data. Add tests for unknown/empty/error states and real API response shapes.
3. Check Phases 7–8 route and component inventory. Add only missing requests/performance/cost/health linking and MCP/A2A/integrations behavior that backend endpoints actually support; preserve old URLs and navigation. Do not display unsupported controls.
4. Phase 9: keyboard labels, focus, reduced motion, mobile layout and loading/error/degraded/unauthorized/reconnect states on critical pages; focus on measured gaps.
5. Phase 10: run UI Vitest/RTL, `bun run --cwd apps/ui typecheck`, `bun run --cwd apps/ui build`, then browser/real-gateway smoke. Review the worktree diff before copying scoped changes to the integration tree.

## Task 4 — Resolve each GitHub PR individually

- **#18 (gateway plan, draft):** compare its sole 719-line document with current architecture; trim obsolete prescriptions, ensure docs checks pass, then mark ready/merge only if it remains useful. Otherwise close with a reason; do not equate a merged plan with implemented hardening.
- **#19 (UI/runtime branch):** finish Tasks 1 and 3, push only reviewed commits to its head branch, wait for current CI (the old Typecheck/Security failures are not acceptable evidence), fix introduced failures, review diff versus `main`, then merge only if the complete acceptance checklist is met.
- **#20 (Jev spec, draft):** inspect overlap with `docs/plans/JEV_ROUTING_INTEGRATION_PLAN.md`, decide whether its specification is distinct from actual implementation, address current security/unit CI failures or explicitly classify pre-existing ones, then merge a verified spec or close as superseded. Never close a feature issue just because its specification merged.

## Task 5 — Resolve each issue against acceptance criteria

- **#15:** the architecture completion backlog spans routing, economics, learning, agent runtime, MCP, A2A, and scale. Enumerate checked-off vs missing items with code/tests/live proof. Keep open or split remaining work into traceable issues; close only when all its substantive acceptance criteria are truly met.
- **#16:** test `free_only` never selects paid, atomic multi-instance quota reservations, dimensioned limits, Retry-After, provider adapters/catalog freshness, stream retry semantics, and measurable 429 avoidance. Keep open until live behavior and tests support every criterion; no blanket close.
- Read back each remote PR/issue after any merge/close. Never rely on a successful write response alone.

## Task 6 — Final gate

Run scoped/full relevant TypeScript builds, sequential unit suites where DB isolation is weak, UI tests, integration/E2E, security checks, and isolated live AaaS chat/job and UI workflows. Inspect GitNexus changed symbols, final `git diff`, commit file lists and GitHub CI. `clean` means intended commits landed, no owned uncommitted changes remain, each PR/issue is either resolved with evidence or explicitly retained with a blocker, and no shared service was left degraded. Report latency/error rates if measured; never promise an unmeasured 'optimal' state.
