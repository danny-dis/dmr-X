# DMR-X SDKs — Roadmap

## Phase 1: Python + Go SDKs (done)

- Python SDK with sync/async clients, streaming, Pydantic v2 types
- Go SDK with channel-based streaming, context support
- Chat, models, embeddings, images, audio endpoints
- Meta-model alias support (`auto`, `auto-coding`, etc.)
- DMR-X routing parameters (`quality`, `provider_preference`, etc.)
- Typed error hierarchies for both SDKs
- CI/CD via GitHub Actions (multi-version testing, linting, vet)

## Phase 2: MIT Core Types Extraction

- Extract shared request/response types into an **MIT-licensed core types package** usable by any SDK or third-party tool
- Generate types from the DMR-X gateway OpenAPI / JSON Schema spec
- Publish as:
  - `@dmr-x/core-types` (npm / TypeScript)
  - `dmrx-core` (PyPI / Python)
  - `github.com/dmr-x/core-types` (Go module)
- Version independently from the SDKs with lockstep releases

## Phase 3: Langfuse / MLflow Observability ✅

- **Langfuse integration**: auto-instrument SDK calls with Langfuse traces, spans, and generations
  - `DMRXClient(api_key="...", observe=LangfuseCallback())` — drop-in observability
  - Creates Langfuse traces (``dmrx.<endpoint>``) and generation spans automatically
  - Automatic span nesting for streaming: tokens accumulated, generation finalized at stream end
  - Error handling: failed requests logged with ERROR level, error details in metadata
  - ``_langfuse.flush()`` called after each request for prompt delivery
- **MLflow tracking**: log prompts, completions, and routing decisions as MLflow runs
  - Each API call creates an MLflow run under ``dmrx`` experiment (configurable)
  - Logs model params, token usage, latency metrics, input/output artifacts
  - Streaming: accumulates output, logs metrics and artifacts on completion
- **Configurable via**:
  - Explicit: ``observe=LangfuseCallback()`` or ``observe=MLflowCallback()``
  - List: ``observe=[LangfuseCallback(), MLflowCallback()]`` for multiple backends
  - String: ``observe="langfuse"`` or ``observe="mlflow"`` auto-creates from env
  - Auto-detect: ``observe=True`` reads ``DMRX_OBSERVABILITY_BACKEND`` env var
- **Custom callbacks**: extend ``DMRXCallback`` (8 lifecycle methods: request start/end/error, stream start/chunk/end/error)
- **Resilience**: callback errors are logged and swallowed — never crash the caller's request
- **Binary endpoints**: audio speech returns metadata (content type, size) to callbacks instead of raw bytes
- Python SDK complete; Go SDK is follow-up

## Phase 4: Guardrails

- **Input guardrails**: pre-flight content moderation, PII detection, prompt injection detection
  - `client.chat.completions.create(..., guardrails=["pii", "moderation"])`
- **Output guardrails**: post-flight response validation, format enforcement, safety checks
- Local guardrail runners (regex-based, lightweight) and cloud-backed (via DMR-X gateway guardrail policies)
- Guardrail events exposed in streaming chunks for real-time monitoring
- Python SDK first; Go SDK follows

## Phase 5: Enterprise (SSO / RBAC)

- **SSO support**: propagate OIDC/SAML tokens from the SDK to the DMR-X gateway
  - `DMRXClient(api_key=..., id_token="...")` or `client.set_auth_token(token)`
- **RBAC helpers**: typed methods to check permissions, list accessible providers/models
  - `client.tenants.list()`, `client.policies.list()`, `client.quotas.get()`
- **Admin SDK methods**: manage tenants, API keys, providers, policies, quotas programmatically
  - Full coverage of the DMR-X admin API surface
- **Audit logging**: structured audit events for all SDK-initiated mutations
  - `client.audit.events.list(filters=...)`
- Python and Go SDKs in parallel

## Milestone Timeline (target)

| Phase | Target | Status |
|-------|--------|--------|
| 1 — Python + Go SDKs | Q1 2025 | ✅ Done |
| 2 — Core types extraction | Q2 2025 | 🔜 Planned |
| 3 — Observability | Q3 2025 | ✅ Done |
| 4 — Guardrails | Q4 2025 | 📋 TBD |
| 5 — Enterprise | Q1 2026 | 📋 TBD |
