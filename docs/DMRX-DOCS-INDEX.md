# DMR-X Documentation Index

**Canonicalized:** 2026-09-06

This index establishes the current documentation hierarchy. Older documents remain useful for implementation detail, but when they conflict with the canonical documents below, the canonical documents win.

## Start here

1. **[DMRX-PRODUCT-AND-ARCHITECTURE.md](./DMRX-PRODUCT-AND-ARCHITECTURE.md)** — product definition, boundaries and target architecture.
2. **[DMRX-RESEARCH-2026-09.md](./DMRX-RESEARCH-2026-09.md)** — current competitive/standards research and resulting decisions.
3. **[DMRX-ROADMAP-2026-09.md](./DMRX-ROADMAP-2026-09.md)** — current execution roadmap and build gates.
4. `DMRX-ROADMAP.md` — earlier roadmap retained for historical continuity.

## Core architecture

- `ARCHITECTURE.md` — detailed existing implementation architecture.
- `CONFIGURATION.md` — configuration reference.
- `DEPLOYMENT.md` — deployment options.
- `DISTRIBUTION.md` — binary/distribution design.
- `AI_PROVIDER_REFERENCE.md` — provider catalog.
- `FREE_API_PROVIDERS_REPORT.md` — free-provider research/catalog.

## Interfaces and agent infrastructure

- **`MCP-2026.md`** — current MCP architecture, security and conformance target.
- **`A2A.md`** — current A2A v1.x integration and conformance target.
- **`AGENT-RUNTIME.md`** — canonical reusable Agent Runtime specification.
- `MCP.md` — existing MCP implementation/reference details; use `MCP-2026.md` for current protocol direction.
- `AGENTS_PLUGANDPLAY.md` — existing agent import/provisioning details.
- `AGENT-FLEET-LOAD-FINDINGS.md` — fleet/load findings.

## Product/API documentation

- `API_USAGE_GUIDE.md` — API and client usage.
- `QUICK-START.md` — quick setup.
- `QUICK-START-DEMO.md` — demo walkthrough.
- `PRODUCTION-READINESS-AUDIT.md` — implementation audit.
- `CHANGELOG.md` — historical changes.

## Source of truth

- Product boundaries: `DMRX-PRODUCT-AND-ARCHITECTURE.md`
- Research/standards decisions: `DMRX-RESEARCH-2026-09.md`
- Roadmap: `DMRX-ROADMAP-2026-09.md`
- MCP: `MCP-2026.md`
- A2A: `A2A.md`
- Agent Runtime: `AGENT-RUNTIME.md`
- Current implementation details: `ARCHITECTURE.md` and source code

## Boundary that must appear consistently

DMR-X is independent.

`Application/Agent -> DMR-X -> model/provider`

or:

`Application/Agent -> DMR-X Runtime -> DMR-X Gateway -> model/provider`

ATHENA, ARGUS, Ghost Factory and other systems are consumers, not dependencies.

SMS/Sovereign Mind is not required by DMR-X.

## Documentation maintenance

When a feature changes:

1. update implementation docs;
2. update the canonical architecture if the boundary changes;
3. update the roadmap if the feature changes priorities;
4. update research when an external standard/provider changes the design;
5. update examples and API docs;
6. add or update tests before claiming the capability is complete.
