# DMR-X: Borrowed Capabilities from workweave/router

> Checklist for implementing features inspired by workweave/router into DMR-X.
> Source: https://github.com/workweave/router
> Paper: Avengers-Pro (arXiv:2508.12631)

---

## Phase 1 — Quick Wins (Week 1-2)

- [ ] **Semantic Response Cache**
  - Use embeddings for cache lookup instead of exact-match hashing
  - Leverage existing `services/memory/` vector search infrastructure
  - New `services/cache/semantic-cache.ts` module
  - Configurable via `DMRX_SEMANTIC_CACHE_ENABLED` + `DMRX_SEMANTIC_CACHE_THRESHOLD`
  - Streaming requests bypass cache entirely (same as workweave/router)
  - Per-(tenant, request-type) isolation

- [ ] **Handover Summarization**
  - When switching models mid-conversation, summarize prior conversation
  - Use cheapest available model for summarization
  - New `services/router/src/handover/` module
  - Timeout/error → fall back to full history (never silently drop)
  - Bounds switch-turn input cost

- [ ] **STAY vs SWITCH Planner**
  - EV math comparing cache-warmth savings vs eviction cost
  - Tier-upgrade guard (force switch when fresh decision is strictly higher tier)
  - Extend `services/router/src/sticky/` with planner logic
  - New `services/router/src/planner/` module
  - Pure function, no I/O

- [ ] **Install CLI Commands**
  - `dmrx setup --claude` / `--opencode` / `--codex`
  - `dmrx off --claude` / `--opencode` / `--codex`
  - `dmrx status`
  - Extend `packages/cli/` with setup commands
  - Config file patching for Claude Code, opencode, Codex, Cursor

---

## Phase 2 — Core Intelligence (Week 3-4)

- [ ] **Embedding-Based Cluster Scorer**
  - Small ONNX/WASM embedder (`@xenova/transformers` or similar)
  - Prompt embedding → cosine similarity against pre-computed centroids
  - Training pipeline (Python script) to create centroids from historical data
  - Configurable via `DMRX_ROUTER_STRATEGY=cluster|heuristic`
  - New `services/router/src/cluster-scorer/` module

- [ ] **Multi-Binding Model Catalog**
  - Each model can list multiple provider bindings with ordering
  - Smart 404 → cross-binding failover (not same-binding retry)
  - Extend `@dmr-x/core` types (CandidateSet entries)
  - Update `services/registry/` and `services/router/src/fallback/`

- [ ] **High-Fidelity Content Capture**
  - `router.call` log records with full request/response bodies
  - Configurable via `DMRX_CAPTURE_CONTENT=off|hashed|full`
  - ML-ready event stream for training/analysis
  - Extend `services/telemetry/`

---

## Phase 3 — Advanced (Week 5-6)

- [ ] **Cluster Versioning & A/B Eval**
  - Versioned routing strategy bundles in SQLite
  - `x-dmrx-route-version` header for per-request strategy pinning
  - Evaluation scripts (Python benchmark suite)
  - New `services/router/versions/` infrastructure

- [ ] **Training Pipeline**
  - Python script: `train_cluster_router.py`
  - Analyze historical requests → create centroids → produce rankings
  - Model registry JSON with cost values baked at training time
  - Versioned artifact bundles

---

## What DMR-X Already Has That workweave/router Doesn't

| Feature | Status |
|---------|--------|
| 18+ provider adapters (image, audio, video, 3D, OCR) | ✅ |
| Multi-tenant with RBAC, quotas, billing | ✅ |
| MCP Server (stdio/SSE/HTTP) | ✅ |
| Task decomposition for complex prompts | ✅ |
| Zero-deps SQLite deployment | ✅ |
| Helm chart + Docker Compose | ✅ |
| Federation (cross-instance routing) | ✅ |
| Thompson Sampling bandit at runtime | ✅ |
| Agentic workflows with tool loops | ✅ |
| Sandboxed code execution | ✅ |
| Memory service with vector search | ✅ |
