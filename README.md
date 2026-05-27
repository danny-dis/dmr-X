# DMR-X

Universal AI routing and orchestration platform. One unified API, intelligent routing across local models, remote providers, and temporary workers.

## Vision

Modern AI systems are fragmented across:
- different providers
- different APIs
- different quotas
- different model capabilities
- different pricing structures
- different hardware environments

DMR-X unifies them behind one intelligent routing layer.

Clients connect to one endpoint. DMR-X handles the rest.

---

## Core Features

### Unified AI Gateway
- OpenAI-compatible API
- One API key
- One endpoint
- Multi-provider execution

### Intelligent Routing
DMR-X dynamically selects:
- the best provider
- the best model
- local vs remote execution
- fallback chains
- execution priority

Routing decisions are based on:
- quality
- latency
- cost
- quotas
- modality
- hardware availability
- benchmark history
- policy rules

### Five-Layer Intelligence Hierarchy

| Layer | Role | Description |
|-------|------|-------------|
| **Brain** | Frontier reasoning | Strategic cognition, complex problem solving |
| **Thinkers** | Deep reasoning | Research, architecture, planning |
| **Executers** | Implementation | Coding, transformations, tool execution |
| **Workers** | Lightweight processing | Cheap retrieval, simple tasks |
| **Temporary Workers** | Ephemeral | Local workers spawned dynamically from local models |

---

## Multimodal Support

DMR-X supports:
- text
- code
- images
- audio / speech
- video / music
- embeddings
- retrieval
- tool execution

---

## Architecture

### Core Services

| Service | Purpose |
|---------|---------|
| Gateway | API entry point, authentication |
| Router | Intelligent request routing |
| Registry | Model and provider management |
| Policy Engine | Routing rules and constraints |
| Quota Manager | Usage tracking and limits |
| Billing Engine | Cost tracking and metering |
| Benchmark Engine | Model performance evaluation |
| Memory System | Context and session persistence |
| Telemetry | Observability and monitoring |
| Federation | Multi-node coordination |
| Sandbox | Secure code execution |
| Scheduler | Task and worker orchestration |

### Stack
- TypeScript
- Python
- PostgreSQL + pgvector
- Redis
- Docker
- Kubernetes
- OpenTelemetry
- Prometheus + Grafana

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/danny-dis/DMR-X.git
cd DMR-X

# Install dependencies
npm install

# Copy environment config
cp .env.example .env

# Start development
npm run dev
```

### Environment Variables

```env
GATEWAY_PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/dmr-x
REDIS_URL=redis://localhost:6379

# Provider API Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=sk-...
```

---

## API Usage

DMR-X exposes an OpenAI-compatible endpoint:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Set `model: "auto"` to let DMR-X route intelligently, or specify a model/provider explicitly.

---

## Routing Philosophy

DMR-X does not bind agents to fixed models.

Agents request capabilities. DMR-X determines the optimal execution path.

This allows:
- provider abstraction
- automatic failover
- quota optimization
- cost reduction
- adaptive intelligence
- hardware-aware execution

---

## Local-First Design

DMR-X prioritizes:
1. Local execution
2. Temporary local workers
3. Hybrid execution
4. Remote escalation only when necessary

This reduces:
- cost
- latency
- vendor lock-in
- privacy exposure

---

## Self-Learning System

DMR-X continuously benchmarks models using:
- latency
- hallucination rate
- tool success rate
- reasoning quality
- multimodal accuracy
- user satisfaction
- provider reliability

The router evolves dynamically over time.

---

## Federated Intelligence

Deployments can optionally share:
- anonymized benchmark signals
- routing heuristics
- provider reliability metrics
- optimization patterns

Without sharing raw tenant data.

---

## Repository Structure

```
apps/           # Client applications
services/       # Core microservices
workers/        # Background workers
packages/       # Shared libraries
infra/          # Infrastructure as code
docs/           # Documentation
tests/          # Integration tests
```

---

## Project Status

Current phase:
- production architecture
- routing engine design
- provider abstraction layer
- local-first execution fabric
- SaaS platform foundation

---

## Goals

- Universal AI execution fabric
- Provider-agnostic orchestration
- Autonomous routing intelligence
- Scalable multimodal infrastructure
- Local-first AI systems
- Enterprise-grade AI gateway

---

## License

TBD
