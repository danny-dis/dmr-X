# ⚡ DMR-X

<p align="center">
  <strong>The AI Gateway · Adaptive Router · Agent Runtime</strong><br/>
  One interface for models, providers, inference economics, and agent execution.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-active-00c853?style=for-the-badge" alt="status" />
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?style=for-the-badge&logo=bun&logoColor=black" alt="Bun" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/MCP-compatible-7c3aed?style=for-the-badge" alt="MCP" />
  <img src="https://img.shields.io/badge/A2A-ready-2563eb?style=for-the-badge" alt="A2A" />
</p>

DMR-X is an **independent, local-first AI infrastructure platform** between applications/agents and AI execution. It normalizes provider interfaces, selects the best execution path for each request, manages cost/quality/latency/privacy trade-offs, and can optionally run isolated agents.

**ATHENA, ARGUS, Ghost Factory, Claude Code, Codex, and unrelated applications can all use DMR-X. None are dependencies.**

---

## 🧠 What DMR-X does

```text
Application / Agent / Coding Agent
              │
              ▼
       ┌──────────────┐
       │    DMR-X     │
       │              │
       │ Gateway      │
       │ Policy       │
       │ Capabilities │
       │ Router       │
       │ Economics    │
       │ Reliability  │
       │ Evaluation   │
       └──────┬───────┘
              │
       ┌──────┼──────────────┐
       ▼      ▼              ▼
     Local  Economy       Frontier
     models models         models

Optional:
Application → Agent Runtime → DMR-X Gateway → model/provider
```

The core question is:

> **Given an AI workload and its constraints, what is the best way to execute it?**

DMR-X optimizes across **capability, quality, cost, latency, reliability, privacy, locality, modality, context, and historical performance**.

---

## ✨ Core capabilities

- 🔀 **Adaptive model routing** — capability-aware selection, constraints, fallbacks, reliability and learned performance.
- 💸 **Inference economics** — free-only, free-first, cheapest-acceptable and quality-per-dollar strategies.
- 🏠 **Local-first execution** — route sensitive or cost-sensitive workloads to local infrastructure.
- 🛡️ **Privacy-aware routing** — sensitivity classification, PII redaction/tokenization and fail-closed privacy constraints.
- 🌐 **Provider abstraction** — one gateway across cloud, local, frontier and specialist providers.
- 🔌 **MCP** — expose DMR-X capabilities and optionally aggregate external MCP tools.
- 🤝 **A2A** — communicate with independent agents using the Agent2Agent protocol.
- 🤖 **Agent Runtime** — persistent or ephemeral agents with isolation, sessions, skills, scheduling and resource controls.
- 📊 **Evaluation + observability** — routing traces, cost, latency, reliability, outcomes and audit.
- 🧪 **Benchmarking** — compare models/providers by task and capability instead of one global leaderboard.
- 🎛️ **Multi-tenant controls** — keys, quotas, policies, budgets and usage accounting.
- 🎨 **Multimodal infrastructure** — text, vision, embeddings, reranking, speech and specialist generation workloads.

---

## 💰 Free and cheap inference

Cheap inference is a **first-class DMR-X use case**.

A caller can express an objective such as:

```text
free-only
free-first
cheapest-acceptable
best-quality-per-dollar
lowest-latency
local-only
privacy-required
best-available
```

DMR-X then searches the eligible model/provider pool instead of forcing the application to maintain its own provider logic.

This is particularly valuable for coding agents and autonomous systems where hundreds or thousands of inference calls can dominate operating cost.

---

## 🤖 Agent Runtime

The Runtime is optional reusable execution infrastructure. It does **not** turn DMR-X into an application-level sovereign orchestrator.

A workload can request an ephemeral specialist:

```text
Create temporary research agent
        ↓
Provision isolated workspace/browser
        ↓
Attach scoped tools + capabilities
        ↓
Run with TTL + resource/budget limits
        ↓
Use DMR-X for inference
        ↓
Return results/artifacts
        ↓
Destroy agent
```

Runtime responsibilities include lifecycle, isolation, sessions, checkpoint/recovery, scheduling, skills, subagents, resource limits, evaluation and portability.

**Runtime executes. Gateway routes. The calling application remains responsible for its own higher-level authorization/governance.**

---

## 🔌 MCP and 🤝 A2A

### MCP

DMR-X exposes routing and agent capabilities through MCP and can optionally aggregate external MCP servers.

MCP is an **interface/tool interoperability layer**, not DMR-X's internal decision-making brain.

### A2A

DMR-X can expose and consume agent capabilities through A2A, including task lifecycle, streaming, cancellation and artifacts.

A2A is an **interoperability boundary**, not a replacement for application orchestration.

---

## 🧩 Architecture boundaries

These rules are intentional and should not drift:

1. **DMR-X is independently deployable.**
2. **DMR-X does not require SMS/Sovereign Mind.**
3. **DMR-X does not own ATHENA's lattice or governance.**
4. **DMR-X does not replace application-level orchestration.**
5. **Gateway owns model/provider routing.**
6. **Runtime owns reusable agent execution infrastructure.**
7. **MCP exposes capabilities/tools.**
8. **A2A interoperates with independent agents.**
9. **Any application can consume DMR-X without adopting the rest of the ecosystem.**

---

## 🚀 Quick start

```bash
git clone https://github.com/danny-dis/dmr-X.git
cd dmr-X
bun install
cp .env.example .env
bun run dev:gateway
```

Gateway: `http://localhost:3000`

### Docker

```bash
docker compose up -d
```

Configure at least one provider, or connect local infrastructure such as Ollama or an OpenAI-compatible local server.

---

## 🧑‍💻 Coding-agent friendly

DMR-X is designed to sit **under** existing coding/agent clients:

```text
Claude Code ─┐
Codex ───────┼──→ DMR-X ──→ models/providers
Your App ────┘
```

The client keeps its own workflow and agent behavior. DMR-X provides the inference infrastructure beneath it, including model abstraction, routing, fallback and cost optimization.

---

## 🏗️ Repository

```text
dmr-X/
├── apps/                 # Gateway + web UI
├── packages/             # Shared libraries, CLI, secrets, catalogs
├── services/
│   ├── adapters/         # Provider adapters
│   ├── router/           # Routing intelligence
│   ├── registry/         # Models/providers
│   ├── policy/           # Policy + RBAC
│   ├── quota/            # Rate/quota controls
│   ├── billing/          # Usage/economics
│   ├── benchmark/        # Benchmark/evaluation
│   ├── telemetry/        # Metrics/tracing/audit
│   ├── mcp-server/       # MCP + A2A
│   ├── agent-runtime/    # Reusable agent execution
│   ├── agent-registry/   # Agent definitions
│   ├── skill-registry/   # Skills
│   └── tool-search/      # Tool discovery
├── tests/                # Unit + E2E
├── docs/                 # Canonical + implementation docs
├── helm/                 # Kubernetes
├── monitoring/           # Observability
└── infra/                # Infrastructure configuration
```

---

## 📚 Documentation

**Start here:**

| Document | Purpose |
|---|---|
| [`DMRX-PRODUCT-AND-ARCHITECTURE.md`](docs/DMRX-PRODUCT-AND-ARCHITECTURE.md) | Canonical product definition and architecture |
| [`DMRX-RESEARCH-2026-09.md`](docs/DMRX-RESEARCH-2026-09.md) | Current research and decisions |
| [`DMRX-ROADMAP-2026-09.md`](docs/DMRX-ROADMAP-2026-09.md) | Current implementation roadmap |
| [`MCP-2026.md`](docs/MCP-2026.md) | MCP architecture/conformance target |
| [`A2A.md`](docs/A2A.md) | A2A architecture/conformance target |
| [`AGENT-RUNTIME.md`](docs/AGENT-RUNTIME.md) | Agent Runtime specification |
| [`DMRX-DOCS-INDEX.md`](docs/DMRX-DOCS-INDEX.md) | Documentation source-of-truth map |

Implementation references are retained only where they describe code that still exists. Canonical documents win when there is a conflict.

---

## 🧭 Roadmap

**P0 — make routing excellent**

Capability ontology · requirement vectors · deterministic routing policies · privacy routing · reliability intelligence · routing decision traces · free/economy allocator.

**P1 — make it self-improving and production-grade**

Outcome evaluation · attribution · contextual learning · task-specific tournaments · Runtime lifecycle/isolation/recovery · MCP/A2A conformance · distributed reliability.

**P2 — scale and optimize**

Semantic caching · streaming optimization · model/provider lifecycle automation · federation · chaos/load testing.

See the canonical roadmap for the build order and acceptance gates.

---

## 📄 License

GPL-2.0

<p align="center">
  <strong>⚡ DMR-X</strong><br/>
  <sub>Route intelligence to the right model, at the right cost, through the right execution path.</sub>
</p>
