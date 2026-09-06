# DMR-X Documentation

**Canonicalized: 2026-09-06**

This directory is intentionally small and opinionated. The canonical documents define what DMR-X is and where it is going; implementation references document code that actually exists.

## Start here

1. `DMRX-PRODUCT-AND-ARCHITECTURE.md` — canonical product definition, boundaries and architecture.
2. `DMRX-RESEARCH-2026-09.md` — current research, standards and competitive decisions.
3. `DMRX-ROADMAP-2026-09.md` — current build plan and acceptance gates.

## Protocols and runtime

4. `MCP-2026.md` — current MCP architecture, security and conformance target.
5. `A2A.md` — A2A architecture and conformance target.
6. `AGENT-RUNTIME.md` — reusable Agent Runtime specification.

## Implementation reference

7. `ARCHITECTURE.md` — detailed implementation architecture.
8. `API_USAGE_GUIDE.md` — API/client usage.
9. `CONFIGURATION.md` — configuration reference.
10. `DEPLOYMENT.md` — deployment options.
11. `DISTRIBUTION.md` — distribution/build packaging.
12. `AI_PROVIDER_REFERENCE.md` — provider/model adapter reference.
13. `AGENTS_PLUGANDPLAY.md` — agent import/provisioning implementation reference.
14. `CHANGELOG.md` — historical release/change record.

## Intentionally removed

Superseded, duplicated, or time-sensitive research is not kept as parallel sources of truth. In particular, old roadmap/MCP documents, obsolete free-provider catalogs, demo-only documentation, and point-in-time audits should not be used to define current behavior.

## Source-of-truth rules

- Product/boundaries → `DMRX-PRODUCT-AND-ARCHITECTURE.md`
- Research/standards decisions → `DMRX-RESEARCH-2026-09.md`
- Build priorities → `DMRX-ROADMAP-2026-09.md`
- MCP → `MCP-2026.md`
- A2A → `A2A.md`
- Runtime → `AGENT-RUNTIME.md`
- Actual implementation → source code + `ARCHITECTURE.md`
- API usage → `API_USAGE_GUIDE.md`

If an implementation differs from documentation, **source code is reality and the documentation must be corrected**. If two documents disagree, the canonical document wins until the implementation is updated.

## Architectural boundary

```text
Application / Agent / Coding Agent
              │
              ▼
            DMR-X
       ┌──────┴──────┐
       ▼             ▼
    Gateway       Runtime
       │             │
       └──────┬──────┘
              ▼
       Model / Provider
```

DMR-X is independent infrastructure.

- ATHENA, ARGUS and Ghost Factory are consumers, not dependencies.
- SMS/Sovereign Mind is not required.
- DMR-X does not own application governance or ATHENA's lattice.
- Gateway owns model/provider routing.
- Runtime owns reusable agent execution infrastructure.
- MCP provides capability/tool interoperability.
- A2A provides agent interoperability.

## Documentation discipline

Every substantive feature change should update:

1. implementation documentation;
2. canonical architecture when boundaries change;
3. roadmap when priorities/status change;
4. research when external standards or ecosystem facts change;
5. examples/API documentation;
6. tests and acceptance gates.

Do not create another "current roadmap", "latest architecture", or provider catalog beside these files. Update the canonical document instead.
