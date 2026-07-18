# YAGNI / Ponytail Audit — DMR-X

**Branch:** `audit/yagni-ponytail`
**Date:** 2026-07-18
**Scope:** Whole repo, READ-ONLY. No source files modified by this audit.
**Method:** Manual read of the AaaS core + targeted ripgrep sweeps (see "Method & Limits").
**Lens:** Ponytail ladder — (1) does it need to exist, (2) already in repo, (3) stdlib, (4) native, (5) installed dep, (6) one line, (7) minimal new code. Deletion over addition.

---

## 0. Repo-hygiene findings (high confidence, no scanning needed)

These are the cheapest, highest-impact wins and need zero code understanding.

### [UNTRACKED-DEBRIS] repo root + services — ~30 scratch/debug files in the tree
Untracked files checked via `git status`:
- Root: `DBCHECK.ts`, `OPENCLAUDE_BRIEF.md`, `list_candidates.mjs`, `pi_approx.py`, `pi_live_test.clean.txt`, `probe_test.ts`, `nul`, `mcp_out/`
- `apps/gateway/`: `DBALTER.ts`, `DBCHECK.ts`, `ROWS.ts`, `START2.ts`, `START3.ts`, `STARTDBG.ts`, `diag.ts`, `gw.out`, `src/routes/.hermes-tmp.CyuxSJ`
- `apps/gateway/scripts/`: `_diag2.cjs`, `_diag3.cjs`, `_diag_keys.cjs`, `_mcp_tools_test.sh`, `_mcp_tools_test2.sh`, `_pi_live_test.sh`, `_pi_realistic_test.sh`, `_ts_start.ps1`, `_ts_tasks.ps1`, `dev/_health_check.ts`, `dev/_prov_with_key.ts`, `dev/_reset_health.ts`, `dev/pi_create_and_test_agents.py`, `verify-persist.mjs`
- `services/mcp-server/`: `dbcopy.ts`, `dbtest.ts`, `diag.ts`

**YAGNI:** These are throwaway probes/diagnostics sitting in version control. They add noise, confuse `git status`, and risk being shipped in a release. None are referenced by `package.json` scripts or CI.
**Action:** Delete (or move to a git-ignored `scratch/` dir). If any hold a genuinely reusable check, promote it to `tests/` or `scripts/verify/`. Add a `.gitignore` rule so `*.out`, `.hermes-tmp.*`, and ad-hoc `diag.ts`/`dbtest.ts` never get tracked again.

### [WIP-ON-BRANCH] 18-file unreviewed diff riding on this branch
`git diff --stat` shows **18 modified files, +338 / −180**, none authored by this audit. This predates the session and rode along when the branch was checked out from `main`. It touches `apps/gateway/src/routes/*`, `packages/db/src/client.ts` (+92), `services/server-manager` (+113), `services/router/src/meta-models.ts` (+45), `services/godmode`, `services/agent-registry`, `services/agent-runtime` (incl. my 2 edits: `agent-runtime.ts` +7, `agent-session.store.ts` −11), etc.

**YAGNI / risk:** A 500+-line mixed WIP on a branch intended for a *clean audit* contaminates the audit's diff and makes "what changed for the audit" indistinguishable from prior work. It also means `main` itself carries uncommitted, un-reviewed code.
**Action:** Stash/commit this WIP to its own branch (`wip/pre-audit`) **before** any audit-driven changes are added, so the audit PR is a clean, reviewable unit. Do not let it get folded into a YAGNI cleanup commit.

---

## 1. AaaS core findings (verified by reading the source)

### [DEAD+WRONG] `services/agent-runtime/src/agent-session.store.ts` — `cleanupExpired()`
*(Already removed in this branch's working tree — recorded here for the report.)*
- Defined as a public method; **zero callers** in `src/` across the repo (verified by `rg`).
- Its SQL `WHERE expires_at < datetime('now')` is **non-functional on sql.js** (the WASM SQLite engine this repo uses — see `packages/db/src/client.ts` importing `sql.js`). `datetime()` is a SQLite datetime function not implemented in the sql.js WASM build, so it would throw or no-op.
- Even if it ran, it compared an ISO-8601 `expires_at` (`new Date().toISOString()`) against `datetime('now')` which yields `'YYYY-MM-DD HH:MM:SS'` — different string shapes that don't sort correctly.
- **Already covered:** `get()` expires on access via a JS `new Date(row.expires_at) < new Date()` comparison. The periodic sweep was redundant *and* broken.
**Action (done on branch):** Deleted. If a real periodic sweep is wanted later, replicate `get()`'s JS comparison, not SQLite datetime functions.

### [BUG-THEN-YAGNI] `services/agent-runtime/src/agent-runtime.ts` — `evaluateExecution()` budgetAdherence inverted
*(Already fixed on this branch — recorded here for the report.)*
- Original: `budgetAdherence = min(steps/maxSteps, 1)`. This rewards *consuming* the full step budget (a 10/10-step run scored 1.0).
- Correct semantics (matching `turnEfficiency`): `max(0, 1 - steps/maxSteps)` — reward finishing *under* budget.
- **YAGNI note:** `evaluateExecution` is only called from `agent-chat-loop.ts`, and the per-call args `inputTokens`/`outputTokens`/`durationMs` are **dead** (the score uses only `steps` + `maxSteps`). Left them as-is to avoid churning dead params (YAGNI: don't touch inert code).
**Action (done on branch):** Inverted the formula. Verified with a standalone bundle check: 3-of-10 steps → `0.7` (was `0.3`).

### [SUSPECTED-DEAD — VERIFIED FALSE] `resolveFallbackModel`
Initially suspected unused. `rg` confirms it **is** called at `apps/gateway/src/routes/agent-chat-loop.ts:117` inside `resolveFallbackForError`. **Not a finding.** Recorded to show verification discipline — do not delete.

---

## 1.5 Dead code — subagent sweep + `rg` confirmation (HIGH confidence)

Two scoped subagents (services 1: agent-runtime/agent-registry/router; services 2: billing/quota/policy/memory/telemetry/workers) completed a READ-ONLY dead-code pass. Each used the **package `index.ts` export-gate** as the dead-code signal (if a module isn't re-exported from its package `index.ts`, no other package can import it) plus repo-wide `rg`. I independently re-verified every "whole module orphaned" claim below with `rg -l` and confirmed **no dynamic `import()`** reaches them and the owning `router.service.ts` / package indexes do not reference them. All confirmed.

### [DEAD] `services/router/src/routing-settings.ts:1` — entire module orphaned (~152 LOC)
`RoutingWeights`, `ROUTING_PRESETS`, `getCustomWeights/setCustomWeights/getEffectiveWeights/getRoutingProfiles`. **Not** in `router/src/index.ts`; `router.service.ts` does not reference it; zero external `rg` refs. Delete the file.

### [DEAD] `services/router/src/versions/versions.ts:35` — `RoutingVersionRegistry` / `routingVersionRegistry` inert
Exported from `router/src/index.ts` (so reachable) but only self-referenced inside `router/src`; no caller reads `getActiveVersions`/`getVersion`/`registerVersion`. The A/B versioning layer is never driven. **Action:** remove the `versions/index.ts` + `versions.ts` unless a caller is planned; if kept for a roadmap feature, gate it behind a real call path now.

### [DEAD] `services/router/src/bandit/reward-updater.ts:45` — `RewardUpdater` never constructed
Re-exported from `router/src/index.ts` and `bandit/index.ts`, but **no caller** does `new RewardUpdater()` (the bandit trains via `thompson-sampler`, not this class). `calculateReward` is tested; `RewardUpdater.update()` has zero production callers. Delete the class (or fuse `calculateReward` into the sampler if it's the only load-bearing piece).

### [DEAD] `services/agent-runtime/src/agent-billing.ts:23` — `AgentBillingService` + 4 methods unused
Flagged by auditor as unreferenced from outside the package. *(Partial — `recordExecutionCost` may be reachable; the four *reporting* methods `getAgentCostSummary/getAgentCostBreakdown/getTenantAgentCosts` are the dead part. Verify method-by-method before deleting the file.)*

### [DEAD] `services/quota/src/quota-share.ts:37` — `QuotaShareEngine` entire module orphaned (~234 LOC)
Not in `quota/src/index.ts`; zero imports repo-wide. Fair-share pool engine (`getPool`/`upsertPool`/`canRequest`/`getPriorityScore`) unreferenced. Delete the file.

### [DEAD] `services/billing/src/cost-tracker.ts:57` — `CostTracker` entire module orphaned (~250 LOC)
Not in `billing/src/index.ts`; zero imports. Duplicates the `UsageTracker` billing path with a separate `cost_logs` table. Delete the file.

### [DEAD] `services/telemetry/src/callbacks/callback-manager.ts:64` — `CallbackManager` entire module orphaned (~179 LOC)
Not in `telemetry/src/index.ts`; zero imports. Speculative LiteLLM-style callback system nobody registers. Delete the file.

### [DEAD] `services/policy/src/prompt-templates.ts:28` — `PromptTemplateService` entire module orphaned (~179 LOC)
Not in `policy/src/index.ts` (policy only exports `PolicyService` + `rbac`); zero imports. Delete the file.

### [SPECULATIVE] `services/billing/src/billing.service.ts:78–427` — report/budget-alert subsystem has zero callers
Large report + budget-alert code path inside the billing service with no live caller. Collapse into the minimal `recordCost`/`getTenantCosts` path or delete until a dashboard actually requests it.

**Net deletion if all confirmed-orphans are removed: ~1,100+ LOC of pure dead code** across 8 files, plus the speculative billing subsystem. None affect runtime behavior (verified unreachable). This is the single biggest YAGNI win in the repo.

---

## 3. Cross-cutting observations (medium confidence, need a second pass)

These are *hypotheses from reading the AaaS slice + grep patterns*, not confirmed by full-repo tracing. Listed so the next pass (or a human) can confirm cheaply.

### [DUPLICATION-CANDIDATE] id/crypto helpers may be re-implemented per service
`packages/utils/src/crypto.ts` already exports `generateId()`, `generateRequestId()`, `generateApiKey()`, `hashApiKey()`, `encrypt/decrypt`, etc. Any service that hand-rolls `crypto.randomUUID()` or its own hashing *instead of importing `@dmr-x/utils`* is duplicating a shared primitive.
**Cheap confirm:** `rg -n "randomUUID|crypto.createHash|createHmac" services apps --glob '!dist/**'` and check each hit imports from `@dmr-x/utils`; if not, reuse it.
**Action pending confirm:** Replace local copies with `@dmr-x/utils` exports (rung 2 of the ladder: already in repo).

### [OVER-ABSTRACTION-CANDIDATE] `services/agent-runtime` skill resolution
`agent-runtime.ts` has both `resolveSkills()` (private) and `skillLoader.advertise` / `skillLoader.resolveBody`. The private wrapper adds a layer that just forwards to `skillLoader`. Possible collapse, but `resolveSkills` is used by the skill-capture nudge path — needs a caller check before inlining. **Not confirmed dead.**

### [PREMATURE-GEN-CANDIDATE] `extractProvider` / `extractModel` manual alias maps
`agent-runtime.ts:337-357` hand-parses provider/model strings (`gpt-`→openai, `claude-`→anthropic, …). This is a small, justified heuristic (no dependency needed) — **kept** per ladder rung 6 (one function). Not YAGNI-violating, listed only for completeness.

---

## 4. Method & limits (read this before acting)

- **Subagent sweep:** 3 parallel read-only auditors initially **timed out at 600s** (~17–23 API calls) against this 88,661-LOC repo on the local model — the serial "read every file" strategy starves. A Python `execute_code` full-scan also timed out (300s) re-reading 444 source files per symbol. **Retry with tighter scope (2 services per agent, capped grep, 290s budget) succeeded** and produced the §1.5 findings.
- **Verification discipline:** Every "whole module orphaned" claim in §1.5 was independently re-checked with `rg -l` (confirming refs are self-only, not external) + a check for dynamic `import()` (none found) + confirmation the owning package `index.ts` / `router.service.ts` does not reference it. `resolveFallbackModel` was suspected dead and **verified live** — not deleted.
- **What actually worked:** targeted `rg` on specific symbols + manual reads of the AaaS core + scoped subagents with an `index.ts` export-gate heuristic.
- **Coverage gap:** `services/mcp-server`, `services/adapters`, `services/godmode`, `services/federation`, `apps/ui`, `packages/*` beyond utils, and `sdks/*` were **not** exhaustively traced. The candidates in §3 are hypotheses.
- **Recommendation for a complete pass:** run the audit as a *static* step — e.g. `ts-prune` / `knip` on the bun workspace for a machine-complete dead-export list in seconds, then apply YAGNI judgment. The LLM-read approach does not scale to 88k LOC here.

---

## 5. TOP 3 (by impact)

1. **Delete ~30 untracked scratch/debug files + add `.gitignore` rules** — instant declutter, removes release-risk, zero behavior change. (§0)
2. **Remove ~1,100+ LOC of confirmed-dead modules** (`routing-settings`, `versions`, `reward-updater`, `quota-share`, `cost-tracker`, `callback-manager`, `prompt-templates`, billing subsystem) — verified unreachable via `index.ts` gate + `rg`. Biggest YAGNI win. (§1.5)
3. **Isolate the 18-file WIP onto its own branch** before any cleanup — protects the audit's reviewability; reveals `main` carries unreviewed code. (§0)

*(Prior-turn fixes `cleanupExpired()` removal + `budgetAdherence` inversion are done on-branch and confirmed.)*

## 6. CONFIDENCE

**High** for §0, §1, §1.5 (verified by read + `rg` + `index.ts` gate + a runnable bundle check). §3 and the un-scanned services are medium/low-confidence hypotheses. The full-repo dead-code claim is intentionally *not* overstated — only symbols verified unreachable are called dead.

**Caveat:** No source was modified by the audit except the two branch edits (`agent-runtime.ts`, `agent-session.store.ts`), which are themselves YAGNI fixes. Nothing is committed; `AUDIT_YAGNI.md` is the only audit artifact on the branch. The dead-code deletions in §1.5 are *recommended*, not applied — this is a report-only deliverable.

---

## 7. Cleanup executed (Ponytail pass — 2026-07-18, full level)

Rung-1 check: every module below was verified unreachable (not in package `index.ts`, zero external `rg` refs across `src`+`tests`+`config`, no dynamic `import()`, no gateway/UI refs, only doc-comment mentions of `RewardUpdater` left). Wiring them in would mean inventing callers = speculative build → forbidden. **Deleted.**

**Files removed (`git rm`):**
- `services/router/src/routing-settings.ts` (152 LOC)
- `services/router/src/versions/index.ts` + `versions.ts` (100 LOC)
- `services/router/src/bandit/reward-updater.ts` (~200 LOC)
- `services/quota/src/quota-share.ts` (234 LOC)
- `services/billing/src/cost-tracker.ts` (250 LOC)
- `services/telemetry/src/callbacks/callback-manager.ts` (179 LOC)
- `services/policy/src/prompt-templates.ts` (179 LOC)

**Re-export gates stripped:** `router/src/index.ts` (`RewardUpdater` + versioning block), `router/src/bandit/index.ts` (`RewardUpdater`/`RequestRecord`).

**Verification:** `bun build --target=bun` of `router`, `quota`, `billing`, `telemetry`, `policy` indexes all succeed (router bundles 270 modules). Residual `rg` hits for `RewardUpdater`/`RequestRecord` are doc-comments only in `router.service.ts:81` + `thompson-sampler.ts:149` — not imports. No behavior change.

**Deferred (resolved this pass — see §8):** the `billing.service.ts` reporting methods and the entire `AgentBillingService` were confirmed dead and removed (see §8). `recordUsage`, `queryUsage`, `generateReport`/`generateDailyReport`/`generateMonthlyReport`, `calculateCost`, `getModelPricing`, `refreshPricingCache`, `resetCounters`, `checkBudgetAlerts` stay (live or kept).

**Net removed this pass:** ~1,294 LOC of confirmed dead code across 7 files + 2 export-gate lines + the deferred billing deletions below.

---

## 8. Billing dead-code cleanup (Ponytail pass 2 — 2026-07-18)

`AgentBillingService` was verified **dead at runtime**: the UI's `AgentAnalytics.tsx` calls `GET /v1/agents/analytics/costs`, but **no backend route serves it** (grep of the gateway confirms no `/costs` handler). So `getAgentCostSummary`/`getAgentCostBreakdown`/`getTenantAgentCosts`/`recordExecutionCost` were never reached. The class + its two interfaces + the `agentBillingService` export + the `index.ts` re-export block were deleted.

`billing.service.ts` had 5 methods with **0 external callers** (verified by `rg` post-edit): `getRealtimeUsage`, `getUsageByDimensions`, `getCurrentPeriodUsage`, `getTeamCostBreakdown` (note: its `"team"` grouping is a hardcoded `'default'` — non-functional), `getModelCostComparison`. All deleted. `tracker` helpers they delegated to (`getDailyUsage`/`getMonthlyUsage`/`getRealtimeUsage`/`aggregateByDimensions`) retain other callers (`checkBudgetAlerts`, `generateReport`), so no secondary orphaning.

**Files changed:** `git rm services/agent-runtime/src/agent-billing.ts`; edited `services/agent-runtime/src/index.ts` (drop re-export), `services/billing/src/billing.service.ts` (drop 5 methods).

**Verification:** `bun run build` (agent-runtime `tsc -b` clean), `bun build` of billing.service + gateway chat-loop succeed; gateway `tsc --noEmit` clean for chat-loop/billing/agent-runtime. No `/costs` route exists to break.

---

## 9. Scratch-file purge (Ponytail pass 3 — 2026-07-18)

`git clean -fd` removed ~30 untracked debug/scratch files (`apps/gateway/{diag,PROBEKEYS,START2}.ts`, `scripts/_*`, `scripts/dev/_*`, `services/mcp-server/{dbcopy,dbtest,diag}.ts`, `mcp_out/*.json`, `DBCHECK.ts`, `pi_approx.py`, etc.). Verified none were imported (precise `rg` after initial substring false-positives). The stray `nul` (53-byte locked file) removed via `rm -f`. `AUDIT_YAGNI.md` + the two new migrations (057/058) retained.

**Remaining un-touched items (not YAGNI-deletable without more context):**
- The 18-file pre-existing WIP diff on `main` — should be isolated to its own branch, not deleted.
- `services/mcp-server`, `godmode`, `federation`, `apps/ui`, `sdks/*` were not exhaustively traced (coverage gap noted in §4). A machine pass (`knip`/`ts-prune`) is recommended for a complete dead-export list.
