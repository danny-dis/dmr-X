# Issue #15 — Architecture Completion Backlog

You are in the `dmrx-issue15-architecture` worktree on branch `fix/issue15-architecture-closeout`. Base: `268394b`.

## Context

DMR-X has infrastructure across routing, quota (~4800 lines in `services/quota/src/`), adapters, MCP, A2A, and agent runtime. The quota package is being worked on by another session — DO NOT modify it.

## Task

1. **Explore first.** Map which checklist items below are implemented and which need work.
2. Implement missing items with tests.
3. Verify existing items have tests.
4. Run `bun test` to confirm no regressions.
5. Commit incrementally.

## Checklist

### P0 — Routing
- Capability ontology and model capability profiles (`packages/core/src/`)
- Request Requirement Vector
- Declarative routing policy engine (`services/routing/` or `packages/routing/`)
- Routing Decision Trace (traceable reasoning)
- Provider/model reliability distributions
- Privacy/PII-aware routing with fail-closed constraints

### P0 — Economics
- Budget reservation/reconciliation (`billing/`, `budget` services)
- Free-tier allocator (integration with quota service)
- Free-only/free-first/cheapest-acceptable objectives
- Quality-per-dollar objective
- Coding-agent integration test matrix

### P1 — Agent Runtime
- Formal lifecycle manager
- Ephemeral agents with TTL/budgets
- Container/microVM isolation
- Checkpoint/resume/leases/idempotency
- Resource-aware scheduling
- Versioned skill promotion
- Portable agent packages

### P1 — MCP (2026-07-28 compatibility)
- `packages/mcp/` or `services/mcp/`
- Stateless remote operation validation
- Capability-aware tool discovery
- Tool identity/provenance/side-effect metadata
- Upstream health/circuit breakers

### P1 — A2A (v1.x conformance)
- `packages/a2a/` or `services/a2a/`
- Agent identity/authz
- Idempotency/replay protection
- Distributed task ownership
- Artifact store/integrity
- End-to-end tracing

### P2 — Scale
- Semantic cache with tenant/privacy boundaries
- Adaptive concurrency
- Multi-instance consistency
- Chaos/load/failure testing
- Automated model/provider discovery

## Boundary rules
- DMR-X stays independent. No ATHENA/SMS dependencies.
- Do NOT modify `services/quota/src/` — parallel session owns that.
