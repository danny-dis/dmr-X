# DMR-X Documentation

**Canonicalized: 2026-09-07**

This directory is intentionally small and opinionated. The canonical documents define what DMR-X is and where it is going; implementation references document code that actually exists.

## Start here

1. `DMRX-PRODUCT-AND-ARCHITECTURE.md` — canonical product definition, boundaries and architecture.
2. `DMRX-RESEARCH-2026-09.md` — current research, standards and competitive decisions.
3. `DMRX-ROADMAP-2026-09.md` — current build priorities and acceptance gates.
4. `DMRX-SPECIALIZED-MODEL-CAPABILITY-PLAN-2026-09.md` — detailed plan for heterogeneous specialist models, inference workers, capability routing, APIs, benchmarks and integration of OCR, vision, retrieval, forecasting, tabular, audio and evaluator models.

## Protocols and runtime

5. `MCP-2026.md` — current MCP architecture, security and conformance target.
6. `A2A.md` — A2A architecture and conformance target.
7. `AGENT-RUNTIME.md` — reusable Agent Runtime specification.

## Implementation reference

8. `ARCHITECTURE.md` — detailed implementation architecture.
9. `API_USAGE_GUIDE.md` — API/client usage.
10. `CONFIGURATION.md` — configuration reference.
11. `DEPLOYMENT.md` — deployment options.
12. `DISTRIBUTION.md` — distribution/build packaging.
13. `AI_PROVIDER_REFERENCE.md` — provider/model adapter reference.
14. `AGENTS_PLUGANDPLAY.md` — agent import/provisioning implementation reference.
15. `CHANGELOG.md` — historical release/change record.

## Specialized-model architecture

`DMRX-SPECIALIZED-MODEL-CAPABILITY-PLAN-2026-09.md` is the detailed implementation plan for making non-LLM and multimodal models first-class DMR-X capabilities. It covers capability contracts, model/provider/worker registry extensions, vLLM/OpenAI-compatible serving, Triton workers and pipelines, native Python/Rust workers, OCR/document models, vision/segmentation/tracking/depth, audio separation, embeddings, ColPali-style retrieval, reranking, tabular/time-series models, evaluators, artifact handling, resource-aware routing, benchmarks and lifecycle management, plus integration contracts for ATHENA, ARGUS, NOESIS, Ghost Factory and DANNY.

The document is a build plan, not a claim that every listed model is already implemented. Catalog eligibility requires runtime, provenance, license and benchmark validation.

## Source-of-truth rules

- Product/boundaries → `DMRX-PRODUCT-AND-ARCHITECTURE.md`
- Research/standards decisions → `DMRX-RESEARCH-2026-09.md`
- Build priorities → `DMRX-ROADMAP-2026-09.md`
- Specialist model implementation plan → `DMRX-SPECIALIZED-MODEL-CAPABILITY-PLAN-2026-09.md`
- MCP → `MCP-2026.md`
- A2A → `A2A.md`
- Runtime → `AGENT-RUNTIME.md`
- Actual implementation → source code + `ARCHITECTURE.md`
- API usage → `API_USAGE_GUIDE.md`
- Provider/model catalog → `AI_PROVIDER_REFERENCE.md` plus the live registry/source code

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
    Capability / Model / Worker
              │
       ┌──────┼──────────┐
       ▼      ▼          ▼
      LLM  Specialist  Tools
           models
```

DMR-X is independent infrastructure.

- ATHENA, ARGUS, NOESIS, Ghost Factory and DANNY are consumers, not dependencies.
- SMS/Sovereign Mind is not required.
- DMR-X does not own application governance or ATHENA's lattice.
- Gateway owns model/provider/capability routing.
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
