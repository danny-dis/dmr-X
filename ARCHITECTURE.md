# DMR-X Production Architecture Blueprint

DMR-X is a universal AI routing and orchestration platform exposing a unified API while dynamically routing requests across local models, remote providers, and temporary workers.

## Core Principles
- Unified OpenAI-compatible API
- Local-first execution
- Dynamic routing
- Multi-provider orchestration
- Self-learning benchmarking
- Quota-aware execution
- Federated intelligence
- Five-layer intelligence hierarchy
- Multimodal support
- SaaS-ready multi-tenancy

## Intelligence Layers
1. Brain
2. Thinkers
3. Executers
4. Workers
5. Temporary Workers

## Primary Stack
- TypeScript
- Python
- PostgreSQL
- pgvector
- Redis
- Docker
- Kubernetes
- OpenTelemetry
- Prometheus
- Grafana

## Core Services
- Gateway
- Router
- Policy
- Registry
- Quota
- Memory
- Adapters
- Validation
- Billing
- Benchmarking
- Telemetry
- Federation
- Sandbox
- Scheduler

## Capabilities
- Text routing
- Code routing
- Image routing
- Audio routing
- Video routing
- Music routing
- Embeddings routing
- Structured outputs
- Streaming
- Tool execution
- Temporary local worker spawning
- Provider fallback chains
- Predictive quota planning
- Cost optimization

## Deployment Goals
- Single-node local deployment
- Hybrid local/cloud execution
- Multi-node Kubernetes scaling
- Tenant isolation
- Provider abstraction
- Enterprise observability

## Repository Layout
```text
apps/
services/
workers/
packages/
infra/
docs/
```

## Operational Philosophy
DMR-X acts as the intelligent execution fabric between clients and AI providers. Clients never directly select providers. The router dynamically determines the best execution path based on quality, cost, latency, quotas, modality, and policy.
