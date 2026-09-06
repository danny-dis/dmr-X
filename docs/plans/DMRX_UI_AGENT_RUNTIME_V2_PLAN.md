# DMR-X UI + Agent Runtime V2 Implementation Plan

## Purpose

Turn the DMR-X UI into a coherent product surface for routing, free inference, agent execution, observability, and integrations. The implementation must preserve the existing React architecture and reuse existing components, API/query hooks, state, and design primitives wherever possible.

This document is an implementation contract for coding agents. Do not treat it as a mockup-only exercise: use real DMR-X APIs and existing typed query layers. Do not introduce fake production data.

## Product model

DMR-X should answer four questions immediately:

1. Is DMR-X healthy?
2. Where is each request being routed and why?
3. What are my agents doing right now?
4. How much latency/cost/free-tier capacity am I saving?

Core mental model:

- **Agents** = the fleet/definitions a user owns.
- **Runtime** = live agent instances/workers and their current execution state.
- **Tasks/Jobs** = work assigned to agents.
- **Runs** = historical executions.
- **Trace** = step-by-step explanation of one execution and its routing decisions.
- **Router** = the decision engine selecting model/provider/fallbacks.
- **Providers/Models** = the available inference capacity.
- **Free Inference** = the capacity/quota/savings optimization layer.

## Target information architecture

Replace the current feature-heavy grouping with a task-oriented hierarchy:

```text
HOME
  Dashboard

BUILD
  Playground
  Agents
  Runtime
  Jobs

ROUTE
  Router
  Models
  Providers
  Policies
  Free Inference

OBSERVE
  Requests
  Performance
  Costs
  Health

CONNECT
  MCP
  A2A
  Integrations

SYSTEM
  Settings
```

Do not blindly delete existing routes. Preserve backwards-compatible routes where practical and redirect/consolidate duplicate surfaces instead of breaking existing clients/bookmarks.

## Phase 1 — Navigation and shell

### Goals

- Make the product hierarchy obvious.
- Reduce sidebar cognitive load.
- Make Runtime a first-class destination.
- Avoid exposing every backend capability as a peer-level menu item.
- Keep nested routes highlighted correctly.

### Requirements

- Update the navigation configuration to the target IA.
- Add `/runtime` as a first-class route.
- Keep `/agents/:id`, `/agents/new`, `/agents/analytics`, and nested agent routes correctly owned/highlighted.
- Preserve existing routes for compatibility; use redirects or secondary navigation where appropriate.
- Add breadcrumbs for nested pages.
- Add a consistent page-header pattern: title, concise description, primary action, status/context actions.
- Add global command/search affordance if the existing shell supports it without a large dependency.
- Mobile navigation must expose the primary five areas without requiring a desktop sidebar.
- Keep keyboard navigation and accessible labels/tooltips.

### Acceptance criteria

- A new user can identify Dashboard, Playground, Agents, Runtime, Router, Free Inference, Requests, and Connect surfaces without reading documentation.
- Current nested route highlighting remains correct.
- No dead navigation links.
- Existing valid URLs remain reachable or redirect cleanly.

## Phase 2 — Dashboard redesign

Keep the existing live data/SSE and polling fallback. Recompose the screen around four operational questions.

### Above the fold

- Overall gateway health.
- Active requests.
- Active agent runs.
- Average/streaming latency.
- Cost today.
- Free-tier savings today.
- Provider capacity/health summary.

### Main panels

1. **Live routing activity** — recent requests, selected model/provider, latency, status.
2. **Routing quality** — success rate, fallback rate, latency, model selection distribution.
3. **Free inference** — free capacity used/remaining, providers/models, predicted exhaustion.
4. **Savings** — free-vs-paid avoided spend and cost trend.
5. **Active agents** — currently running agents and current tasks.

### UX

- Prefer progressive disclosure over dense charts.
- Every metric should link to the relevant detailed surface.
- Preserve real-time updates and make connection state visible.
- Loading, empty, degraded, and error states must explain what the user can do next.

## Phase 3 — Agent Workspace

Transform `/agents` from a CRUD registry into the user's agent fleet/workspace.

### Fleet view

Each agent card/row should expose:

- Name and status.
- Description.
- Model policy/tier.
- Tool/MCP count.
- Runtime instance count.
- Active task count.
- Runs in recent period.
- Cost.
- Last run.
- Health/deployment state.

Actions:

- Open.
- Chat/run.
- Runtime.
- Deploy/start.
- Pause/resume where supported.
- Configure.
- Delete with confirmation.

### Agent detail

Use a consistent agent detail layout:

```text
Overview
Configuration
Model Policy
Tools
MCP
Memory
Permissions
Runtime
Runs
```

Do not duplicate the entire configuration UI on every subpage. Use tabs/sections with stable URLs.

## Phase 4 — Agent Runtime (critical)

Create a first-class `/runtime` control center and an agent-scoped runtime view.

### Runtime overview

Show:

- Runtime/gateway health.
- Running instances.
- Active tasks.
- Queued tasks.
- Success/failure rate.
- Average run latency.
- Tokens consumed.
- Cost today.
- Provider/model utilization.
- Recent runtime events.

Use live updates where APIs support them.

### Instances

An instance represents a real running workload, not an agent definition.

Display:

- Agent.
- Instance/worker ID.
- Status: starting/running/waiting/blocked/failed/stopped.
- Current task.
- Start time/uptime.
- Worker/host/region when available.
- CPU/memory/resource usage when available.
- Tokens and cost.
- Current model/provider.

Controls must be capability-aware and server-backed:

- Pause/resume.
- Stop/terminate.
- Restart.
- Open logs.
- Open trace.

Never display a control that cannot actually be executed by the backend.

### Tasks

Separate task state from instance state.

Support:

- Queue/running/blocked/completed/failed/cancelled.
- Agent.
- Priority.
- Created/started/completed timestamps.
- Current step.
- Retry count.
- Cost.
- Open run/trace.

### Runs

Historical execution list with filters for agent, status, model, provider, time, and task.

### Execution trace

For a selected run, render an understandable execution timeline/graph:

```text
User request
  -> Agent planner
  -> Tool/MCP selection
  -> DMR-X router
  -> Candidate models
  -> Selected provider/model
  -> Tool call(s)
  -> Additional model calls
  -> Synthesis
  -> Response
```

Expose routing evidence where available:

- policy used.
- candidate models.
- selected model/provider.
- fallback attempts.
- latency breakdown.
- token counts.
- estimated/actual cost.
- free-tier eligibility and capacity decision.
- errors/retries.

Avoid exposing hidden chain-of-thought. Show operational events, tool calls, routing metadata, and concise decision reasons only.

### Logs/events

Provide structured event logs with timestamps, severity, component, run/instance IDs, and correlation IDs. Support filtering and copy/export where existing APIs permit.

## Phase 5 — Router experience

Rename/reframe the routing surface around explainability rather than raw configuration.

### Router page

Show:

- Current routing strategy.
- Active policies.
- Provider/model health.
- Recent decisions.
- Fallback rate.
- Routing latency overhead.
- Cost/free-tier impact.

### Routing decision drawer/page

For a request:

```text
Request
  -> Policy match
  -> Capability filters
  -> Candidate set
  -> Scoring
  -> Selected model/provider
  -> Fallback chain
  -> Result
```

The UI should make DMR-X's value visible: users should understand why a model was selected and what happened when the preferred path was unavailable.

## Phase 6 — Providers, Models, and Free Inference

### Providers

Separate these concepts visually:

- Configured.
- Healthy.
- Usable.
- Preferred.
- Rate limited.
- Quota exhausted.

Show health, latency, capacity/quota, free/paid status, priority, and recent failures.

### Models

Show:

- Capabilities.
- Context window where known.
- Performance metrics.
- Cost.
- Router score.
- Health.
- Provider availability.
- Why DMR-X may select it.

### Free Inference

Treat this as a flagship DMR-X differentiator, not a secondary resource page.

Show:

- Providers/models offering free capacity.
- Remaining quota/capacity.
- Rate-limit state.
- Current routing distribution.
- Savings.
- Predicted exhaustion.
- Automatic fallback path.
- Reliability over time.

The UI must make it obvious that DMR-X is actively managing free capacity rather than merely listing free models.

## Phase 7 — Observability and costs

Consolidate operational telemetry into:

- Requests.
- Performance.
- Costs.
- Health.

Each request should have a correlation ID and a path to its routing trace and, when applicable, agent run.

Avoid forcing users to jump between unrelated pages to answer why a request was slow/expensive/failed.

## Phase 8 — MCP, A2A, and integrations

Treat connectivity as one coherent Connect area.

### MCP

Show connected servers, health, tools, permissions, recent calls, and affected agents.

### A2A

Show peers, agent identity/capabilities, connection/health state, recent exchanges, and affected runs.

### Integrations

Make Claude Code, Codex, OpenClaw, SDK/API, and other clients feel like entry points into the same DMR-X gateway/runtime rather than unrelated products.

## Phase 9 — UX quality and reliability

### Required states

Every major page must have:

- Initial loading/skeleton.
- Empty state with next action.
- Partial/degraded state.
- Error state with recovery action.
- Permission/unauthorized state.
- Offline/reconnecting state for live views.

### Accessibility

- Keyboard navigation.
- Focus management for drawers/dialogs.
- Semantic buttons/links.
- Accessible names for icon-only controls.
- Sufficient non-color status indicators.
- Reduced-motion support.

### Responsive behavior

Desktop: sidebar + dense operational workspace.

Tablet: compact navigation + adaptive cards/tables.

Mobile: bottom/compact primary navigation, stacked operational cards, horizontal scrolling only for genuinely tabular data.

## Phase 10 — Testing

Add Vitest/RTL coverage for:

- Navigation and nested route ownership.
- Runtime loading/empty/error states.
- Runtime instance/task filters.
- Agent fleet actions.
- Agent detail routing.
- Routing decision/trace rendering.
- Free-tier status rendering.
- Provider degraded/rate-limited states.
- SSE reconnect + polling fallback.
- Responsive navigation behavior where practical.
- Accessibility smoke checks for key pages.

Do not ship a UI redesign without tests for the critical runtime and routing flows.

## Implementation constraints for coding agents

1. Inspect existing API types, query hooks, stores, and components before creating new abstractions.
2. Reuse existing design-system primitives and Tailwind conventions.
3. Prefer incremental changes over a UI rewrite.
4. Do not introduce mock backend data into production components.
5. Do not silently remove existing functionality; migrate/consolidate it.
6. Keep routes stable or provide redirects.
7. Keep API and domain logic outside presentational components.
8. Use typed interfaces; avoid `any` for new code.
9. Verify loading/error/empty states.
10. Run the relevant UI tests and typecheck/build before considering a phase complete.
11. Keep commits small and logically grouped.
12. Update this plan with checkboxes/status as phases are completed.

## Suggested execution order

- [ ] Phase 1: Navigation and shell
- [ ] Phase 2: Dashboard
- [ ] Phase 3: Agent Workspace
- [ ] Phase 4: Agent Runtime
- [ ] Phase 5: Router experience
- [ ] Phase 6: Providers / Models / Free Inference
- [ ] Phase 7: Observability / Costs
- [ ] Phase 8: MCP / A2A / Integrations
- [ ] Phase 9: UX quality / responsive / accessibility
- [ ] Phase 10: Testing and hardening

## Definition of done

DMR-X UI V2 is complete when a user can:

1. Open DMR-X and immediately understand gateway health and current activity.
2. Find their agents in one obvious Agent Workspace.
3. Open an agent and see both its definition and live runtime state.
4. Open Runtime and understand every active instance/task.
5. Inspect a run and understand the operational execution and routing path.
6. See why DMR-X selected a model/provider and what fallbacks occurred.
7. See free-tier capacity, reliability, and savings as first-class information.
8. Connect MCP/A2A/external coding clients without hunting through unrelated pages.
9. Recover from empty, failed, degraded, or disconnected states without guessing.
10. Use the core workflows on desktop and mobile.
11. Have automated coverage protecting navigation, runtime, routing, and live-data behavior.
