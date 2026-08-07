# The Receptionist — Multi-Agent Job Delegation for DMR-X

> Status: **design, not implemented**. Written 2026-08-04.
> Nothing in this document exists in the codebase yet unless explicitly
> marked "EXISTS TODAY".

## 0. Positioning — the four doors

DMR-X is **the thing an external agent calls when it needs something outside
itself**. Four doors, one address:

| Door | What an outside agent gets | State today |
|---|---|---|
| **Inference** | Any model, in *its own* wire format (OpenAI / Anthropic / Gemini) | **Shipped.** The original product |
| **Tools** | ~45 MCP tools without wiring up 45 integrations | **Shipped.** `services/mcp-server` |
| **Skills** | Reusable instruction bundles it can load into its own context | **Half-built.** Real internally, not exposed outward — see below |
| **Labour** | Delegate a whole job; DMR-X picks who does it | **Designed only.** This document |

The four are one proposition, not four products: *an agent hits its own
limits, and DMR-X is the single endpoint that extends it* — with a bigger
brain, more hands, new instructions, or someone else's expertise entirely.

### The skills gap

Corrected 2026-08-04 after reading the code — an earlier draft of this
section claimed no skill tools existed over MCP. That was wrong.

**What exists:** `dmrx_list_skills` (`tools.ts:405`, implemented
`server.ts:4491`) and `dmrx_import_repo`. Backed by real gateway routes in
`apps/gateway/src/routes/skill.routes.ts` — full CRUD plus import.

**What is actually broken, and it is worse than a missing tool:**

1. `dmrx_list_skills` maps its results to `{ id, name }` only
   (`server.ts:4527-4530`), **discarding description and tags** that the
   gateway already returned. A caller sees a list of bare names and cannot
   tell what any skill does. The door is open but the room is dark.
2. There is no `dmrx_get_skill`. Even having chosen a name, a caller cannot
   fetch the skill body — despite `GET /v1/skills/:id` existing and working
   (`skill.routes.ts:68`).

So the skills door is *half-wired*: the gateway side is complete, the MCP
side truncates the payload and omits the fetch. Closing it is a small change
against endpoints that already work, and the industry shape is settled — a
skill is a fetchable instruction bundle the caller loads into *its own*
context (Anthropic's Agent Skills).

Worth doing **before** the Receptionist phases: days of work, makes the
"one-stop shop" claim true, needs nothing from §3–§12.

## 1. The Vision

DMR-X should behave like **a room full of the freelancers a company needs**.

- A company deploys DMR-X and defines its agents in the UI.
- Any person — or any *tool*, e.g. someone's Claude Code — sends DMR-X a
  **job**, not a prompt: *"build me this game"*, *"ship this service"*.
- DMR-X figures out internally **who is best suited**, assigns the work,
  lets those agents collaborate and re-delegate among themselves, and
  hands back a **delivered result**.
- Because the agent definitions are shared and versioned, the same job
  produces **consistent, reproducible results for everyone in the org**.

The unit of interaction is a *job with an outcome*, not a *chat turn*.
That single shift is what most of this design follows from.

## 2. What already exists vs. what's missing

### EXISTS TODAY (real, working)

| Capability | Where |
|---|---|
| Agent definitions: prompt, model policy, `allowedTools[]`, skills, triggers | `services/agent-registry/src/agent-schema.ts` |
| Instance deployment + CRUD + marketplace + import | `services/agent-registry/src/agent-registry.service.ts` |
| Real multi-turn tool-calling loop (the live one) | `apps/gateway/src/routes/agent-chat-loop.ts` |
| Durable, crash-safe, resumable sessions in SQLite | `services/agent-runtime/src/agent-session.store.ts` |
| Human-in-the-loop approval gate, checkpoint/resume | `agent-chat-loop.ts` |
| Point-to-point delegation to a **named** subagent | `services/agent-runtime/src/agent-delegate.ts` |
| External tool surface over MCP | `services/mcp-server/src/server.ts`, `tools.ts` |
| Per-execution scoring (tool success, budget, turn efficiency) | `evaluateExecution` |

So: the *execution substrate is solid*. Agents genuinely run, call tools,
persist, resume, and can hand off.

### MISSING — the four real gaps

1. **Capability routing exists in primitive form — but only for one agent.**
   Corrected 2026-08-04 after reading the code. `POST /agentic/dispatch`
   (`apps/gateway/src/routes/agent-dispatch.routes.ts:103`) already accepts a
   free-text `task` plus optional `category`/`tags`, selects an agent, and
   can `run` it. So "hand DMR-X a task, it picks who does it" **is real
   today** for a single agent.

   What is missing is everything above that line: it picks *one* agent for
   *one* task. There is no decomposition into a task graph, no multi-agent
   collaboration, no shared context, no integrate/verify step. §5.3's matcher
   should be built as an **upgrade to this endpoint's selection logic**, not
   a greenfield component — and §5.3 stages 1/2/4 (structured prefilter,
   deterministic single-candidate path, fail-loudly on zero) are the concrete
   improvements it needs.

2. **Delegation is single-shot and context-free by design.**
   `agent-delegate.ts` deliberately hides the parent conversation from the
   child and gives the child no tools. That was a sane safety/token choice
   for one-off lookups, but it makes *collaboration* impossible: no passing
   context, no returning partial work, no re-delegating a sub-piece.
   Fire-and-forget is not a team.

3. **The MCP door does not reach the agent layer at all.**
   Verified against `services/mcp-server/src/tools.ts`: the only agent-facing
   MCP tools are `dmrx_import_repo` (pull agents/skills from GitHub) and
   `dmrx_list_skills`. Both are *inbound* — they populate DMR-X or read its
   catalogue. Neither **invokes** anything. There is no `dmrx_run_agent`, no
   `dmrx_dispatch_task`, no job intake.

   So the agent layer is reachable over **raw HTTP only** —
   `POST /v1/agents/:instanceId/chat` for a named agent,
   `POST /agentic/dispatch` for auto-selection. An external Claude Code
   speaking MCP gets inference and tools, and **cannot see that DMR-X has
   agents at all.**

   This is the highest-leverage gap in the whole document. Two thin MCP
   tools wrapping endpoints that *already work* — `dmrx_run_agent` and
   `dmrx_dispatch_task` — would open the labour door before any Receptionist
   phase ships. Do this with the skill tools in §0.

4. **Reproducibility is per-run, not per-outcome.**
   Agent defs are versioned and model policy is pinned per agent — good.
   But `evaluateExecution` scores *a single execution*, and there is no
   acceptance-criteria/verification loop attached to a **job**. "Consistent
   and reproducible across everyone" needs the job, not the turn, to be the
   contract.

### Also worth fixing while we're here

`packages/utils/src/tool-orchestrator.ts` (`executeToolLoop`) is **dead
code** — nothing calls it; the live loop is `agent-chat-loop.ts`. Its test
file only covers string helpers, so coverage looks better than it is.
**Do not resurrect it for the Receptionist.** Either delete it or fold its
ideas into `agent-chat-loop.ts`, so there is exactly one tool loop.

## 3. Architecture

```
  external caller (Claude Code / UI / API)
              │  dmrx_delegate_job("build a 2D platformer …")
              ▼
    ┌───────────────────────┐
    │    THE RECEPTIONIST   │   meta-agent, hub-and-spoke coordinator
    │  intake → decompose   │
    │  → match → assign     │
    │  → integrate → verify │
    └───────────┬───────────┘
                │ reads
        ┌───────▼────────┐
        │ CapabilityIndex │  ← derived from agent definitions
        └───────┬────────┘
                │ assigns tasks
   ┌────────────┼────────────┬─────────────┐
   ▼            ▼            ▼             ▼
 gamedev-   backend-      qa-agent     art-agent
 agent      agent
   └────────────┴────────────┴─────────────┘
                │ all read/write
        ┌───────▼────────┐
        │  JOB WORKSPACE │  shared files + job board + artifacts
        └────────────────┘
```

### 3.1 Key architectural decision: hub-and-spoke, not a mesh

Agents do **not** freely call each other. They may *request* a specialist;
the Receptionist decides and dispatches.

Rationale — this is the load-bearing call in the whole design:

- **Termination.** A mesh of agents that can each delegate has no natural
  bound. A hub gives one place to enforce depth, budget, and wall-clock.
- **Reproducibility.** The org promise is "same job, same result for
  everyone." That requires *one* recorded decision log per job. A mesh
  produces a different emergent call graph every run.
- **Cost.** Every hop is an LLM call. A hub can dedupe and batch; a mesh
  multiplies.
- **Debuggability.** When a job goes wrong you read one coordinator
  transcript, not N interleaved ones.

Trade-off accepted: the Receptionist is a throughput bottleneck and a
single point of failure. Mitigated by making it *thin* — it decomposes and
routes, it does not do domain work — and by persisting job state so a
crashed Receptionist resumes (the session store already supports this).

## 4. Data model

### 4.1 Capability declaration (extends the agent schema)

Added to the agent definition in `services/agent-registry/src/agent-schema.ts`:

```ts
capabilities: {
  domains:      string[]   // ["game-dev", "gameplay-programming"]
  deliverables: string[]   // ["source-code", "design-doc", "test-suite"]
  languages:    string[]   // ["typescript", "gdscript"]
  seniority:    "junior" | "mid" | "senior" | "principal"
  summary:      string     // one paragraph, human-written, used for LLM ranking
  accepts:      string[]   // task kinds it will take: ["implement","review"]
  escalatesTo?: string[]   // agent names it may request as specialists
}
```

`domains` / `deliverables` / `accepts` come from a **controlled vocabulary**
(seeded table, extensible in the UI). Free-text tags do not match reliably
across an org — two teams will write `"gamedev"` and `"game_dev"` and the
router silently misses. Enforce the vocabulary at write time.

**Align this with the A2A Agent Card spec.** `agent-schema.ts:26-27` already
defines an `a2a` trigger carrying an `agentCardUrl`, so the concept is
present. Make `capabilities` serialise to a valid **A2A Agent Card** and
serve it at `/.well-known/agent.json` per agent. Two standards, two jobs:

- **MCP** — how an agent reaches *tools*. Already used.
- **A2A** — how an agent is *discovered and invoked by other agents*.

That is the pairing the industry has settled on, and it makes the Claude Code
story work without a bespoke protocol: an external agent reads the card,
sees what this DMR-X can do, and delegates. `dmrx_list_capabilities` (§8)
becomes a thin MCP-side view over the same card data rather than a
parallel invention.

### 4.2 The Job — new first-class entity

Distinct from an *execution*. An execution is one agent's one run; a job is
the delivered outcome and may span many executions.

```
jobs
  id, tenant_id, submitted_by, source ('mcp'|'ui'|'api')
  brief                TEXT     -- the raw ask
  acceptance_criteria  JSON     -- extracted at intake, see §6
  status               'intake'|'planning'|'running'|'blocked'
                       |'verifying'|'delivered'|'failed'|'cancelled'
  budget_usd, budget_tokens, deadline_at, max_depth
  spent_usd, spent_tokens
  plan                 JSON     -- task graph, §5.2
  result               JSON     -- artifacts + summary
  decision_log         JSON     -- why each agent was chosen, §7
  created_at, updated_at

job_tasks
  id, job_id, parent_task_id, seq
  title, description, deliverable, acceptance
  assigned_agent_def_id, assigned_agent_version   -- PINNED, §7
  assigned_instance_id, session_id                -- links to existing runtime
  status, depends_on JSON, attempt, output JSON
```

`job_tasks.session_id` points at the **existing** durable session store, so
every task inherits crash-safety, approval gates, and resume for free.

### 4.3 Job Workspace — how agents share context

This resolves gap #2 *without* dumping parent transcripts into children
(the reason the current design hides them: token blowup and prompt-injection
surface).

Two shared channels, both scoped to `job_id`:

1. **Shared filesystem scope.** Existing per-conversation workspace in
   `apps/gateway/src/routes/tools.routes.ts`, re-keyed to the job instead of
   the conversation. Agents on the same job read each other's files.
2. **The job board** — structured shared memory, not prose:
   ```ts
   { taskId, agent, status, summary, artifacts[], openQuestions[], forNext[] }
   ```
   Written by an agent on task completion, read by the next agent as part of
   its system prompt. Bounded and structured, so it cannot grow unboundedly
   or smuggle instructions the way a raw transcript can.

A child therefore sees: its task brief, the job board entries it depends on,
and the shared files — never the raw parent conversation.

## 5. The Receptionist

A regular DMR-X agent definition (`__receptionist`, system-owned,
non-deletable) running on the **existing** `agent-chat-loop.ts`. It is
distinguished only by its tool set. No new execution engine.

### 5.1 Its tools (new, gateway-side)

| Tool | Purpose |
|---|---|
| `job_decompose` | Persist a task graph onto the job |
| `find_agents` | Capability match → ranked shortlist (§5.3) |
| `assign_task` | Dispatch a task to an agent, returns handle |
| `read_job_board` | Read task outputs so far |
| `request_verification` | Send deliverable to a verifier agent |
| `deliver_job` | Close the job with a result |
| `escalate_to_human` | Block the job pending human input |

### 5.2 Flow

```
intake     → parse brief; extract acceptance criteria; ask clarifying
             questions ONLY if the job is un-actionable (see note)
planning   → job_decompose into a task DAG with explicit deliverables
matching   → find_agents per task, pick, record WHY in decision_log
running    → assign_task; tasks with satisfied deps run in parallel
             (capped); agents write to job board + workspace
integrate  → read_job_board; detect conflicts/gaps; re-assign or re-plan
verifying  → request_verification against acceptance criteria
delivering → deliver_job with artifacts + summary
```

Note on clarifying questions: for MCP/API callers there is often no human to
ask. Default is **assume-and-record** — the Receptionist states its
assumptions in `decision_log` and proceeds, only blocking via
`escalate_to_human` when the job is genuinely ambiguous at the outcome level.
UI callers get the interactive path.

### 5.3 Capability matching — hybrid, deliberately

Pure embedding search is fragile for "who is best suited"; pure LLM ranking
over every agent in the org does not scale and is not stable run-to-run.

```
stage 1  structured prefilter   — domain ∩ deliverable ∩ accepts, tenant +
                                  permission scoped. Cheap SQL. → candidates
stage 2  if 1 candidate         → assign. No LLM call. (deterministic path)
stage 3  if 2..N candidates     → rank the shortlist. Two signals combined:
                                  (a) LLM judgement over `capabilities.summary`
                                  (b) BANDIT score from past outcomes on
                                      similar tasks — reuse the EXISTING
                                      bandit in services/router, which already
                                      does exactly this for provider selection
stage 4  if 0 candidates        → widen (drop deliverable, then domain);
                                  still 0 → escalate_to_human / fail loudly.
                                  NEVER silently fall back to a generic agent
```

Stage 4's last line matters: silently routing a game-dev task to a generic
agent is exactly how "consistent and reproducible" dies. Same principle as
the existing router's meta-model rule — throw rather than quietly downgrade.

Stage 3's shortlist is capped (~8) and the ranking prompt is pinned. The
bandit arm is the *agent*, the reward is job outcome (§6 criteria met, cost,
turns). **Routing therefore improves over time** — see §7 for why that is
chosen over frozen behaviour.

`services/router` already ships a bandit for provider choice. Reusing it
means agent selection gets exploration/exploitation, decay, and cold-start
handling that are already written and already tested — do not write a second
one.

### 5.4 Specialist requests (bounded upward delegation)

A worker agent gets one new tool, `request_specialist(reason, capability)`.
It does **not** dispatch. It returns control to the Receptionist, which
decides whether to spawn a sub-task. Bounded by `job.max_depth`.

## 6. Acceptance criteria & verification

At intake the Receptionist converts the brief into explicit, checkable
criteria stored on the job:

```json
[ { "id":"ac1", "text":"Game runs in browser without errors",
    "check":"agent", "verifier":"qa-agent" },
  { "id":"ac2", "text":"Unit tests pass",
    "check":"command", "command":"bun run test" } ]
```

Two check kinds:
- `command` — deterministic, run in the existing sandbox. Preferred.
- `agent` — a verifier agent judges. Used only where no command exists.

A job cannot reach `delivered` with unmet criteria; it goes `failed` with the
unmet list. **Partial work is still returned** — a failed job hands back its
artifacts and an honest gap report rather than nothing.

## 7. Auditability over frozen reproducibility — and a system that improves

**Explicit owner decision (2026-08-04): getting better results matters more
than identical results.** A system frozen for reproducibility's sake cannot
learn, and a routing table that never updates is worth less than one that
gets smarter every week. So the goal is *not* bit-identical reruns.

What actually matters, and what the org promise reduces to:

- **Consistent quality**, not consistent bytes — the same job should meet the
  same acceptance criteria (§6) every time, by whatever path works best.
- **Full auditability** — you can always see exactly what happened and why.
- **Deliberate reproduction on demand** — you can pin and replay a specific
  run when debugging, without freezing the whole system to get it.

That is the industry-standard posture (bandit/eval-driven routing with
recorded decisions), and it is a strictly stronger position than freezing.

### 7.1 What still gets recorded (all of it)

1. **Version pinning at dispatch.** `job_tasks` records
   `assigned_agent_version`, not just the def id. Editing an agent tomorrow
   does not retroactively rewrite what a past job did.
2. **Model pinning.** Resolve `auto`/`auto-smart` to a concrete model at
   assign time and record it.
3. **Decision log.** Every routing choice records candidates considered, the
   bandit scores, the pick, and the reason.
4. **Replay.** `POST /jobs/:id/replay` re-runs the *recorded* plan and
   assignments rather than re-deciding — the debugging tool that separates
   "the plan was wrong" from "the agents were flaky". Replay is explicitly a
   **debug affordance, not the default execution mode.**

### 7.2 What makes it improve

5. **Outcome feedback → bandit.** Job completion emits a reward (criteria
   met, cost, turns, human thumbs) against the chosen agent for that task
   kind. §5.3 stage 3 consumes it. This is the loop that makes DMR-X better
   the more it is used.
6. **Golden jobs — the safety net that makes learning safe.** A curated eval
   set of jobs with known-good acceptance criteria, run on a schedule
   (the existing `agent-scheduler` already does cron) and on every agent-def
   change. Track pass rate and cost over time.

   This is what replaces frozen reproducibility. You are free to let routing
   drift *because* the golden set tells you the day quality regresses. Without
   it, "improvement" is unfalsifiable. **Build this in the same phase as the
   bandit, not later.**
7. **Per-tenant learning scope.** A tenant's outcomes train that tenant's
   routing. No cross-tenant leakage of what worked.

### 7.3 Guardrails on the learning

- **Shadow-first.** New agents get exploration traffic, not the critical path,
  until they have enough samples.
- **Pinned-agent escape hatch.** A job may specify `pin_agents: true` to force
  the recorded/declared assignment — for compliance-sensitive work that does
  need identical handling. Off by default.
- **Regression gate.** If the golden-set pass rate drops beyond a threshold,
  freeze bandit updates and alert rather than compounding a bad signal.

## 8. External surface (MCP) — the Claude Code path

New tools in `services/mcp-server/src/tools.ts`:

| Tool | Behaviour |
|---|---|
| `dmrx_delegate_job` | Submit brief (+ optional criteria, budget). Returns `job_id` immediately. **Async** — these run for minutes to hours; a blocking tool call would time out. |
| `dmrx_job_status` | Status, current tasks, spend, blockers |
| `dmrx_job_result` | Artifacts + summary + unmet criteria |
| `dmrx_job_cancel` | Cancel, return partial work |
| `dmrx_list_capabilities` | What this DMR-X can actually do — lets a caller decide *whether* to delegate |

`dmrx_list_capabilities` is what makes the Claude Code story work: the
external agent asks what's available before committing a job.

## 9. Safety, cost, failure

- **Budget.** Job-level `budget_usd` rolled up across all tasks. Existing
  stop conditions are per-execution; add a job-level rollup that halts and
  reports rather than overrunning.
- **Depth.** `max_depth` caps specialist chains. Default 3.
- **Wall-clock.** Deadline per job; blown deadline → partial delivery.
- **Concurrency.** Reuse `agent-concurrency.middleware.ts`; add a per-job cap
  so one job cannot starve a tenant.
- **Permissions.** A job runs with the *submitter's* scope. An agent must not
  gain reach by being delegated to. Enforce in `find_agents` (filter the
  candidate set) — not after assignment.
- **Prompt injection.** Job board entries are structured and rendered as
  data, never concatenated as instructions. Untrusted content from tools
  (fetched pages, imported repos) stays out of the board's instruction path.
- **Loops.** Cycle detection on the task DAG at `job_decompose` time.

## 10. Implementation phases

Each phase is independently useful and independently shippable.

| Phase | Scope | Touches |
|---|---|---|
| **P0** | Capability schema + controlled vocabulary + migration + UI fields + `find_agents` matcher with tests | `agent-schema.ts`, `packages/db/src/migrations/071_agent_capabilities.sql` (verify the number first), agent editor UI |
| **P1** | Receptionist agent def + `find_agents`/`assign_task` tools; **single**-agent routing. Replaces name-based delegation with capability-based. Already valuable alone. | `tools.routes.ts`, new `services/agent-runtime/src/receptionist.ts` |
| **P2** | `jobs`/`job_tasks` tables + job workspace + job board + sequential multi-task execution | migration `070_jobs.sql`, `tools.routes.ts`, job store |
| **P3** | MCP job tools — the external Claude Code path | `services/mcp-server/src/tools.ts`, `server.ts` |
| **P4** | Acceptance criteria + verification loop + honest partial delivery | Receptionist, sandbox |
| **P5** | Parallel fan-out via isolated task workspaces + merge, `request_specialist`, replay | Receptionist |
| **P6** | **Learning loop** — bandit-scored routing (reuse `services/router` bandit) + golden-job eval set. Ship both together; the eval set is what makes drift safe (§7.2) | `services/router`, scheduler |
| **P7** | **Channel adapters** — `services/channels/` + Slack driver, then Discord, then Telegram (§12) | new `services/channels/` |

P4 is a prerequisite for P6: the bandit needs a reward signal, and acceptance
criteria are that signal. Do not attempt the learning loop before verification
exists — you would be training on nothing.

Cleanup, do it in P1: delete or consolidate
`packages/utils/src/tool-orchestrator.ts` so there is one tool loop.

### Before starting P0 — verify

- `apps/gateway/src/routes/agent-dispatch.routes.ts` **already exists**.
  Read it first; it may already host part of this surface, and P1 might be
  an extension rather than a new file.
- **Migration numbering — check the database, not just the directory.**
  Migrations are keyed by version *number*. A number already recorded in an
  existing database is treated as applied and the file is silently skipped,
  even if it is an entirely different migration.

  This bit for real. The tree's highest file was `063_api_key_role.sql`, so
  the jobs migration was written as 064 — but a live database already had
  version 64 applied from a `064_api_key_lookup_hash.sql` that no longer
  exists in the tree. The migration never ran, and every job route failed
  with `no such table: jobs`. A fresh database did not reproduce it, which is
  exactly why it survived testing. It shipped as **`070_jobs.sql`**.

  P0's capability migration should take 071 or later. Before adding one,
  check both the directory *and* `schema_migrations` in a real database.
- Run `gitnexus_impact` on `agent-delegate.ts` and `agent-schema.ts` before
  editing — both are load-bearing.

## 11. Resolved decisions (were open questions)

Each resolved to the prevailing industry standard rather than left open.

1. **Receptionist model tier → fixed strong model. Not budget-tiered.**
   Standard orchestrator-worker practice (Anthropic's multi-agent research
   system, LangGraph supervisor, OpenAI Agents SDK): the coordinator gets the
   strong model, workers are tiered by task. A cheap orchestrator writes bad
   plans, and a bad plan costs more downstream than the model saving — the
   coordinator's tokens are a small fraction of total job spend.

2. **Cross-tenant marketplace agents → opt-in allowlist, pinned version,
   reduced scope.** The private-package-registry model. A tenant explicitly
   allowlists a marketplace agent; it is pinned to a version (no silent
   upstream updates); it runs with *narrower* permissions than first-party
   agents by default and never inherits the submitter's full scope.

3. **Conflicting outputs → isolate, then merge.** Each task gets an isolated
   workspace (git-worktree style branch off the job workspace); the
   Receptionist merges at integrate. This is what agentic coding systems
   converged on, and it beats locking: no contention, no deadlock, parallel
   work stays parallel. True merge conflicts fall back to Receptionist-
   mediated re-assignment with both versions in context.

4. **Streaming → async job + polling + webhook callback + SSE for UI.**
   Long-running jobs must not block a tool call. `dmrx_delegate_job` returns
   immediately; callers poll `dmrx_job_status`, register a completion webhook,
   or (UI) subscribe to SSE. Emit **MCP progress notifications** during the
   job so an MCP client shows live progress without polling — that is the
   protocol's intended mechanism.

5. **Learning → yes, on by default, per-tenant, gated by golden jobs.**
   Owner decision: better results beat identical results. Reuse the existing
   `services/router` bandit. Auditability and on-demand replay are preserved
   (§7.1); the golden-job eval set (§7.2) is what makes drift safe. Jobs
   needing fixed handling set `pin_agents: true`.

### Also adopted

- **Observability → OpenTelemetry GenAI semantic conventions.** Emit spans
  per job / task / LLM call / tool call using the standard attribute names
  rather than a bespoke schema. The emerging standard, and it means any
  OTel-compatible backend works without custom exporters.
- **Discovery → A2A Agent Cards** at `/.well-known/agent.json` (§4.1),
  MCP for tool access. Do not invent a third protocol.

## 12. Chat platforms — Slack, Discord, Telegram

**Yes, and DMR-X is unusually well-shaped for it.** Both modes work: talk to
the Receptionist to delegate a job, or talk to an individual agent directly.

Nothing exists today — the current Slack/Discord hits in the repo are
Alertmanager notification routes and MCP catalog entries, not an agent chat
surface. But three existing pieces do most of the work:

| Already exists | Why it matters here |
|---|---|
| Durable, resumable sessions keyed by id | A platform **thread maps 1:1 to a session** — persistent, resumable conversation per thread, free |
| Human-in-the-loop approval gate (`awaiting_approval` → `/resume`) | Renders natively as Slack Block Kit buttons / Discord components / Telegram inline keyboards. This is the standout fit — approve-a-tool-call becomes a button in chat |
| `webhook` + `event` triggers in `agent-schema.ts` | The inbound hook already has a home; no new trigger concept needed |

### 12.1 Architecture — one adapter layer, three thin drivers

```
Slack Events API ─┐
Discord Interactions ─┼─→ ChannelAdapter ─→ normalized ChannelMessage
Telegram Bot API ─┘         │
                            ├─ identity map: platform user → DMR-X user
                            ├─ thread map:   platform thread → session_id
                            ├─ target resolve: Receptionist or named agent
                            └─→ existing /v1/agents/:id/chat  OR  job intake
```

`services/channels/` with `slack.ts`, `discord.ts`, `telegram.ts` behind one
interface. Platform differences (Slack Block Kit vs Discord components vs
Telegram inline keyboards) live only in a `render()` method per driver.

### 12.2 Addressing — both modes

- **Receptionist (default):** message the bot, or `/dmrx build me a 2D
  platformer`. Full job pipeline; progress posts back into the thread.
- **Individual agent:** `@dmrx-backend`, or `/dmrx-agent backend <task>`,
  or bind a channel to one agent (`#design-team` → `design-agent`). Direct
  chat, no job machinery.
- **Thread continuity:** replying in a thread resumes that session. A thread
  is a conversation, which is exactly what the session store already models.

### 12.3 Per-platform notes

- **Slack** — Events API + slash commands; use the **Assistant / AI app
  surface** (native side-panel threads, status hints) rather than a plain
  bot. Socket Mode for dev, HTTP endpoint in prod. Block Kit for approvals.
- **Discord** — Interactions endpoint with signature verification; register
  application commands. Must ACK within **3 seconds** → defer immediately,
  then follow up. Threads per job. Buttons for approvals.
- **Telegram** — Bot API webhook, simplest of the three. Inline keyboards for
  approvals. No native threading → keep a session per chat (plus per topic in
  forum groups).

### 12.4 The parts that will actually bite

- **Identity mapping is the security boundary.** A Slack user must map to a
  DMR-X user so jobs run with *their* scope (§9). Unmapped user → refuse, not
  fall back to a default identity. Design this first, not last.
- **Ack deadlines.** Discord 3s, Slack 3s. Every platform needs
  ack-then-follow-up; jobs are async anyway (§11.4), so this aligns.
- **Streaming into chat** means edit-a-message, not append. Throttle edits
  (rate limits are strict) — update every ~1–2s or on tool boundaries.
- **Untrusted channel content.** Anyone in a public channel can type
  anything. Channel input is untrusted data, never instructions — same rule
  as the job board (§9). Bot must not act on messages it merely observes.
- **Noise.** Long jobs must post progress into a thread, never the channel.

### 12.5 Effort

Slack first (richest surface, clearest business case), then Discord (shared
component model), Telegram last (simplest, add when asked). The adapter layer
is the real work; each driver after the first is small.
