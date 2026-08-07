# Configuration

DMR-X is configured via environment variables. Copy `.env.example` to `.env` for local development. Values are read from `process.env` in Bun/Node packages and `import.meta.env` in the Vite UI.

This page documents the stable, supported `DMRX_*` environment variables. `.env.example` is the authoritative list and may include experimental variables not covered here. Provider key variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) are listed at the bottom in [Provider Keys](#provider-keys) — they are not `DMRX_`-prefixed.

## Quick Reference

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `NODE_ENV` | `development` | Production | `development` or `production` |
| `PORT` | `3000` | No | Gateway listen port |
| `LOG_LEVEL` | `info` | No | Logger level: `debug`, `info`, `warn`, `error` |
| `DMRX_DATA_DIR` | `~/.dmr-x` | No | Directory for SQLite database and data files. The MCP server uses `~/.dmr-x/mcp` if this is unset. |
| `DMRX_UI_DIR` | `apps/gateway/public` | No | Static UI directory served by the gateway |
| `DMRX_LOCAL_MODE` | `false` | No | Skip tenant API key auth for local dev. **Never use in production.** |
| `DMRX_ALLOW_LOCAL_MODE` | `false` | No | Permits `DMRX_LOCAL_MODE=true` in production. Used by tests/CI only. |
| `DMRX_ADMIN_API_KEY` | — | Production | Admin API key for `/v1/admin/*` routes. Required unless `DMRX_LOCAL_MODE=true`. Minimum 32 characters. |
| `DMRX_ENCRYPTION_KEY` | — | Production | AES-256-GCM key for encrypting provider API keys at rest (64 hex characters). If unset in development, keys are stored in plaintext. |
| `DMRX_CORS_ORIGIN` | `http://localhost:4200`, `http://localhost:5173` | Production | Comma-separated allowed CORS origins. Never use `*` in production. |
| `DMRX_RATE_LIMIT_MAX` | `600` (gateway) | No | Maximum requests per window (parsed as int). |
| `DMRX_RATE_LIMIT_WINDOW` | `1 minute` | No | Rate limit window duration (Fastify rate-limit syntax). |
| `DMRX_BODY_LIMIT` | `10485760` (10 MB) | No | Max JSON request body size in bytes. Accepts `10mb`, `1024kb`, plain numbers. Must be between 1 KB and 100 MB. |
| `DMRX_REQUEST_TIMEOUT` | `60000` (60 s) | No | Max time to receive a full request, in ms. Must be 1 000 – 600 000. Streaming responses are not affected. |
| `DMRX_KEEPALIVE_TIMEOUT` | `65000` (65 s) | No | HTTP keep-alive timeout, in ms. Must be 1 000 – 600 000. Stay just above your reverse proxy's `keepalive_timeout`. |
| `DMRX_CONNECTION_TIMEOUT` | `10000` (10 s) | No | Slow-loris defense: time to receive request headers, in ms. Must be 1 000 – 300 000. |
| `DMRX_MAX_PARAM_LENGTH` | `200` | No | Max length of a single URL-encoded path/query parameter. Must be 1 – 4 096. |
| `DMRX_TRUST_PROXY` | `loopback` | No | When to trust `X-Forwarded-*`. Accepts `true`, `false`, `loopback`, `linklocal`, `uniquelocal`, or a CIDR / IP list. Set to `true` if behind nginx/Cloudflare. |
| `DMRX_MEMORY_LIMIT` | `1572864000` (1.5 GB) | No | RSS threshold for `/healthz` to report `memory: fail`. Accepts `1.5gb`, `512mb`, plain numbers. Must be 64 MB – 16 GB. |
| `DMRX_COMPRESS_THRESHOLD` | `1024` (1 KB) | No | Response compression threshold in bytes. Responses smaller than this are sent uncompressed. Set to `0` to disable compression. SSE streams are skipped regardless. Must be 0 – 1 048 576. |
| `DMRX_FREE_TIER_STRATEGY` | `none` | No | Free-tier routing strategy: `none`, `prioritize`, `load_balance`, `fallback`. |
| `DMRX_META_MODEL_COST_FILTER` | `all` | No | Default cost filter for meta-model aliases (`auto`, `auto-fast`, etc.). `all` routes through all providers (paid + free); `free` restricts to zero-cost providers only. Per-request override via `x-cost-filter` header. |
| `DMRX_WORKER_POOL_FANOUT` | `false` | No | Opt-in flag that wires `WorkerPoolFanout` into the router pipeline for parallel sub-task dispatch. Set to `true` to enable. |

## Server Limits (production hardening)

These seven variables are validated at boot by `validateStartupConfig()` in `apps/gateway/src/main.ts`. An invalid value causes the gateway to refuse to start.

| Variable | Default | Description / Validation |
|----------|---------|-------------|
| `DMRX_BODY_LIMIT` | `10485760` (10 MB) | Max JSON request body size in bytes. Must be 1 KB – 100 MB. |
| `DMRX_REQUEST_TIMEOUT` | `60000` (60 s) | Max time to receive a full request. Must be 1 000 – 600 000 ms. |
| `DMRX_KEEPALIVE_TIMEOUT` | `65000` (65 s) | HTTP keep-alive timeout. Must be 1 000 – 600 000 ms. |
| `DMRX_CONNECTION_TIMEOUT` | `10000` (10 s) | Slow-loris defense. Must be 1 000 – 300 000 ms. |
| `DMRX_MAX_PARAM_LENGTH` | `200` | Max URL-encoded path/query parameter length. Must be 1 – 4 096. |
| `DMRX_TRUST_PROXY` | `loopback` | When to trust `X-Forwarded-*`. See `Fastify` docs. |
| `DMRX_MEMORY_LIMIT` | `1572864000` (1.5 GB) | RSS threshold for `/healthz` `memory` check. Must be 64 MB – 16 GB. |
| `DMRX_COMPRESS_THRESHOLD` | `1024` (1 KB) | Response compression threshold. Must be 0 – 1 048 576. |

## Authentication

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DMRX_LOCAL_MODE` | `false` | No | Skip tenant API key auth for local dev. **Never use in production.** When `NODE_ENV=production`, the gateway refuses to start with `DMRX_LOCAL_MODE=true` unless `DMRX_ALLOW_LOCAL_MODE=true` is also set. |
| `DMRX_ALLOW_LOCAL_MODE` | `false` | No | Permits `DMRX_LOCAL_MODE=true` to survive the production boot-time check. Tests/CI only. |
| `DMRX_ADMIN_API_KEY` | — | Production | Admin API key for `/v1/admin/*` routes. Required unless `DMRX_LOCAL_MODE=true`. Minimum 32 characters in production. |
| `DMRX_ENCRYPTION_KEY` | — | Production | AES-256-GCM key for encrypting provider API keys at rest. **Must be 64 hex characters** (32 bytes) in production. If unset in development, keys are stored in plaintext. |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## CORS and Security

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DMRX_CORS_ORIGIN` | `http://localhost:4200`, `http://localhost:5173` | Production | Comma-separated allowed CORS origins. Must be set to explicit origins in production — wildcard is never allowed. |

Security headers are automatically applied:
- `Content-Security-Policy` — restricts script/style sources
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` (production only)
- `X-XSS-Protection: 0`

## Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_RATE_LIMIT_MAX` | `600` (gateway) | Maximum requests per window. |
| `DMRX_RATE_LIMIT_WINDOW` | `1 minute` | Rate limit window duration. |

## Routing

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_FREE_TIER_STRATEGY` | `none` | Free-tier routing strategy: `none`, `prioritize`, `load_balance`, `fallback`. |
| `DMRX_META_MODEL_COST_FILTER` | `all` | Default cost filter for meta-model aliases (`auto`, `auto-fast`, etc.). `all` routes through all providers (paid + free); `free` restricts to zero-cost providers only. Per-request override via `x-cost-filter` header. |
| `DMRX_WORKER_POOL_FANOUT` | `false` | Opt-in Worker-Pool Fanout layer — when `true`, the router dispatches parallel sub-task groups via `WorkerPoolFanout` and records each as a `WorkerJob` in the `workers` / `worker_jobs` tables. |

Strategies:
- `none` — ignore free-tier status, select by cost/latency/quality
- `prioritize` — prefer free-tier providers when available
- `load_balance` — distribute across free-tier providers
- `fallback` — use free-tier first, fall back to paid if unavailable

## Audio Separation Providers

These three URLs configure the audio-source-separation adapter, which can route to multiple upstream services:

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_DEMUCS_BASE_URL` | — | Optional local Demucs instance. If set, the audio-separation adapter will prefer it. |
| `DMRX_AUDIO_SHAKE_BASE_URL` | `https://api.audioshake.com/v1` | AudioShake API base URL. |
| `DMRX_STEMSPLIT_BASE_URL` | `https://api.stemsplit.com/v1` | StemSplit API base URL. |

The adapter also uses `AUDIO_SHAKE_API_KEY` and `STEMSPLIT_API_KEY` (see [Provider Keys](#provider-keys)).

## MCP Server

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DMRX_MCP_TRANSPORT` | `stdio` | No | Transport: `stdio`, `sse`, `http`. |
| `DMRX_MCP_PORT` | `3100` | No | MCP HTTP/SSE port. |
| `DMRX_MCP_HOST` | `127.0.0.1` | No | MCP HTTP/SSE host. Use `0.0.0.0` only for remote access. |
| `DMRX_MCP_API_KEY` | — | Production | API key for MCP server authentication. Comma-separated for multiple keys. Required when transport is `sse` or `http` in production. |
| `DMRX_MCP_CORS_ORIGIN` | `*` (dev only) | Production | CORS origin for SSE/HTTP transports. Tighten to explicit origins in production. |
| `DMRX_MCP_RATE_LIMIT` | `none` | No | Per-tool rate limit. Format: `tool:N/window` (e.g. `chat:5/minute,image:50/hour`). Windows: `second`, `minute`, `hour`, `day` (or `s`/`m`/`h`/`d`). |
| `DMRX_MCP_SESSION_TIMEOUT_MS` | `300000` (5 min) | No | Session timeout in ms. |
| `DMRX_MCP_MAX_BODY_BYTES` | `10485760` (10 MB) | No | Max request body size for MCP HTTP/SSE transports, in bytes. |
| `DMRX_MCP_CONFIG` | — | No | Path to an MCP server config JSON file. If unset, only env vars are used. |
| `DMRX_MCP_CLIENT_SERVERS` | — | No | JSON array of external MCP servers to aggregate. Example: `'[{"id":"higgsfield","name":"Higgsfield","transport":"sse","url":"https://mcp.higgsfield.ai/mcp"}]'`. |
| `DMRX_MCP_UPSTREAM_TIMEOUT_MS` | `30000` (30 s) | No | Per-request timeout when calling an external MCP upstream, in ms. |
| `DMRX_MCP_UPSTREAM_MAX_RETRIES` | `3` | No | Max retry attempts for upstream MCP calls. |
| `DMRX_MCP_CIRCUIT_BREAKER_THRESHOLD` | `5` | No | Consecutive failures before the upstream circuit opens. |
| `DMRX_MCP_CIRCUIT_BREAKER_TIMEOUT_MS` | `60000` (60 s) | No | Time in ms before the circuit transitions from open to half-open. |
| `DMRX_MCP_AUTOSTART` | `true` | No | When the gateway boots, spawn the MCP HTTP server (with A2A) as a sidecar if `:DMRX_MCP_PORT` is not already healthy. |
| `DMRX_A2A_ENABLED` | `true` (sidecar) | No | Enable A2A agent-card + task endpoints on the MCP server. |
| `DMRX_A2A_AGENT_URL` | `http://127.0.0.1:3100` | No | Public URL advertised in the A2A agent card. |
| `DMRX_GODMODE_AUTOSTART` | `false` | No | When the gateway boots, start the local G0DM0D3 proxy in relay mode if it is not already healthy. **Off by default:** enabling it makes the gateway clone and execute a third-party GitHub repo at boot, so it must be opted into explicitly with `DMRX_GODMODE_AUTOSTART=true`. |
| `DMRX_GODMODE_REPO` | `https://github.com/danny-dis/G0DM0D3.git` | No | Repo the managed G0DM0D3 server is cloned from. Defaults to DMR-X's own fork, not upstream, so `.github/workflows/godmode-fork-sync.yml` controls when upstream changes reach it. |
| `DMRX_GODMODE_REF` | pinned commit SHA | No | Commit SHA (or branch/tag) the clone is pinned to. Fetched directly (works for a branch, tag, or SHA), so every fresh install is byte-identical regardless of when it runs. See `patches/g0dm0d3/README.md`. |
| `DMRX_GODMODE_UPSTREAM` | `https://github.com/elder-plinius/G0DM0D3` | No | The project `DMRX_GODMODE_REPO` is a fork of. Reported by `GET /v1/godmode/server/updates` and shown in the UI so users can see how far their pinned copy trails upstream. Only change this if you re-point `DMRX_GODMODE_REPO` at a fork of something else. **Both repos must be on github.com and use `main` as their default branch** — otherwise the update check reports "could not check" and the rest of godmode is unaffected. |

**Data Directory Isolation:** The MCP server uses an isolated SQLite database to avoid contending with the gateway's encrypted DB file lock. If `DMRX_DATA_DIR` is unset, the MCP server automatically uses `~/.dmr-x/mcp` as its data directory. If you set `DMRX_DATA_DIR` explicitly (e.g., in `.env`), both the gateway and MCP server will use that same directory — override this by setting `DMRX_DATA_DIR` only when running the gateway, and leaving it unset when running the MCP server separately.

**Security:** The MCP server binds to `127.0.0.1` by default. Only change to `0.0.0.0` if you need remote access, and always set `DMRX_MCP_API_KEY` when exposing externally.

## G0DM0D3

Runtime connection settings for the managed G0DM0D3 sidecar (in addition to
`DMRX_GODMODE_AUTOSTART`, `DMRX_GODMODE_REPO`, and `DMRX_GODMODE_REF` above):

| Variable | Default | Description |
|----------|---------|-------------|
| `GODMODE_API_URL` | `http://localhost:7860` | Base URL the gateway uses to reach the G0DM0D3 API server. |
| `GODMODE_API_KEY` | — | API key for the G0DM0D3 instance, only needed if it requires auth. |
| `GODMODE_OPENROUTER_API_KEY` | — | OpenRouter key for G0DM0D3 to route via OpenRouter; falls back to `OPENROUTER_API_KEY` when unset. |

## Federation

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_FEDERATION_ENABLED` | `false` | Enable cross-instance federation. |
| `DMRX_FEDERATION_INSTANCE_ID` | — | Unique ID for this instance in the federation. |
| `DMRX_FEDERATION_INSTANCE_NAME` | — | Human-readable instance name. |
| `DMRX_FEDERATION_DISCOVERY_METHOD` | — | Discovery mechanism (`mdns`, `static`, etc.). |
| `DMRX_FEDERATION_MDNS_SERVICE_NAME` / `DMRX_FEDERATION_MDNS_SERVICE_TYPE` | — | mDNS service name/type for discovery. |
| `DMRX_FEDERATION_HEARTBEAT_INTERVAL` | — | Heartbeat interval (ms). |
| `DMRX_FEDERATION_SYNC_INTERVAL` | — | State sync interval (ms). |
| `DMRX_FEDERATION_PEER_TIMEOUT` | — | Peer timeout (ms). |
| `DMRX_FEDERATION_MAX_REMOTE_TOOLS` | — | Cap on tools proxied from remote peers. |
| `DMRX_FEDERATION_ENABLE_TOOL_PROXY` | `false` | Proxy tools from federation peers as local MCP tools. |

## RBAC

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_RBAC_ENABLED` | `false` | Enable the RBAC policy engine for MCP/admin access. |
| `DMRX_RBAC_DEFAULT_EFFECT` | `deny` | Default effect when no policy matches (`allow`/`deny`). |
| `DMRX_RBAC_POLICIES_PATH` | — | Path to the RBAC policy document. |
| `DMRX_RBAC_AUDIT_LOGGING` | `false` | Audit RBAC decisions. |

## Guardrails

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_GUARDRAILS_ENABLED` | `false` | Enable guardrails (PII redaction, content filtering). |
| `DMRX_GUARDRAILS_PII_REDACTION` | `false` | Redact PII from prompts/responses. |
| `DMRX_GUARDRAILS_CONTENT_FILTERING` | `false` | Apply content filtering. |
| `DMRX_GUARDRAILS_BLOCKED_KEYWORDS` | — | Comma-separated blocked keywords. |
| `DMRX_GUARDRAILS_LOG_DETECTIONS` | `false` | Log guardrail detections. |

## Audit Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_AUDIT_ENABLED` | `false` | Enable audit event logging. |
| `DMRX_AUDIT_INCLUDE_BODIES` | `false` | Include request/response bodies in audit records. |
| `DMRX_AUDIT_RETENTION_DAYS` | — | Audit record retention period (days). |

## Tool Search

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_TOOL_SEARCH_ENABLE_BM` | `true` | Enable BM25 lexical tool search. |
| `DMRX_TOOL_SEARCH_ENABLE_SEMANTIC` | `false` | Enable semantic (embedding) tool search. |
| `DMRX_TOOL_SEARCH_MAX_RESULTS` | — | Max results returned. |
| `DMRX_TOOL_SEARCH_MIN_SCORE` | — | Minimum relevance score. |
| `DMRX_TOOL_SEARCH_RRF_CONSTANT` | — | Reciprocal Rank Fusion constant. |
| `DMRX_TOOL_SEARCH_SEMANTIC_WEIGHT` | — | Weight for the semantic score in RRF. |
| `DMRX_TOOL_SEARCH_EMBEDDING_PROVIDER` / `DMRX_TOOL_SEARCH_OPENAI_MODEL` / `DMRX_TOOL_SEARCH_OLLAMA_URL` / `DMRX_TOOL_SEARCH_OLLAMA_MODEL` | — | Embedding backend config for semantic search. |
| `DMRX_TOOL_SEARCH_REMOTE_URL` / `DMRX_TOOL_SEARCH_REMOTE_API_KEY` | — | Remote tool-search service. |

## Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_OTEL_TRACING` | `false` | Enable OpenTelemetry tracing. |
| `DMRX_OTEL_METRICS` | `false` | Enable OTel metrics. |
| `DMRX_OTLP_ENDPOINT` | — | OTLP exporter endpoint. |

## Router Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_ROUTER_EPSILON` | — | Epsilon for epsilon-greedy selection (overrides default). |
| `DMRX_ENABLE_DECOMPOSITION` | `false` | Enable task decomposition / specialist routing. |
| `DMRX_DEFAULT_QUALITY_TARGET` | `balanced` | Default quality target (`frontier`/`balanced`/`economy`). |

## MCP Server (additional)

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_MCP_ALLOWED_TOOLS` | — | Comma-separated allowlist of tool names the server may expose. |
| `DMRX_MCP_API_KEYS_CONFIG` | — | Path to a file with multiple MCP API keys. |
| `DMRX_MCP_METRICS_PORT` / `DMRX_MCP_METRICS_PATH` | — | Port/path for the MCP server's own metrics endpoint. |

## Testing (opt-in)

These variables control the opt-in E2E test suite. They have no effect on production behaviour.

| Variable | Default | Description |
|----------|---------|-------------|
| `DMRX_RUN_E2E` | `false` | Set to `true` to enable the `tests/e2e/` suites (`bun run test:e2e`). |
| `DMRX_GATEWAY_URL` | `http://localhost:3000` | Base URL the E2E tests target. |

## Provider Keys

All provider keys are optional. Set the ones you want to use. None of these are `DMRX_`-prefixed — they are vendor-defined.

### Major Providers

| Variable | Provider | Format |
|----------|----------|--------|
| `OPENAI_API_KEY` | OpenAI | `sk-...` |
| `ANTHROPIC_API_KEY` | Anthropic | `sk-ant-...` |
| `GOOGLE_API_KEY` | Google Gemini / Veo | API key |
| `MISTRAL_API_KEY` | Mistral AI | API key — *no dedicated adapter; reach Mistral via `GenericOpenAI`/`OpenRouter` with a Mistral base URL* |
| `DEEPSEEK_API_KEY` | DeepSeek | API key |
| `XAI_API_KEY` | xAI (Grok) | API key |
| `OLLAMA_CLOUD_API_KEY` | Ollama Cloud (hosted models at ollama.com) | API key |
| `OLLAMA_CLOUD_BASE_URL` | `https://ollama.com/v1` | Ollama Cloud endpoint |

### Cloud / Aggregator

| Variable | Provider | Format |
|----------|----------|--------|
| `GROQ_API_KEY` | Groq | API key |
| `CEREBRAS_API_KEY` | Cerebras | API key |
| `SAMBANOVA_API_KEY` | SambaNova | API key |
| `NVIDIA_NIM_API_KEY` | NVIDIA NIM | API key |
| `OPENROUTER_API_KEY` | OpenRouter | API key |
| `TOGETHER_API_KEY` | Together AI | API key |
| `FIREWORKS_API_KEY` | Fireworks AI | API key |
| `CLOUDFLARE_AI_TOKEN` | Cloudflare Workers AI | API token |
| `HF_TOKEN` | Hugging Face | `hf_...` |
| `GITHUB_TOKEN` | GitHub Models | GitHub token |
| `FAL_KEY` | FAL.ai | API key (Seedance, Wan, Kling) |
| `RUNWAY_API_KEY` | RunwayML | API key (Gen-4.5, Seedance, Veo) |
| `LUMA_API_KEY` | Luma Dream Machine | API key (Ray 3.2/2) |
| `DASHSCOPE_API_KEY` | Alibaba DashScope (Qwen, Wan) | API key |

### Specialized

| Variable | Provider | Format |
|----------|----------|--------|
| `COHERE_API_KEY` | Cohere | API key |
| `JINA_API_KEY` | Jina AI | API key |
| `REPLICATE_API_TOKEN` | Replicate | `r8_...` |
| `STABILITY_API_KEY` | Stability AI | API key |
| `ELEVENLABS_API_KEY` | ElevenLabs | API key |
| `DEEPGRAM_API_KEY` | Deepgram | API key |
| `VOYAGE_API_KEY` | Voyage AI | API key |
| `ZHIPU_API_KEY` | Zhipu AI | API key |
| `UPSTAGE_API_KEY` | Upstage | API key |
| `SCALEWAY_API_KEY` | Scaleway | API key |

### Audio Separation

| Variable | Provider | Format |
|----------|----------|--------|
| `AUDIO_SHAKE_API_KEY` | AudioShake | API key |
| `STEMSPLIT_API_KEY` | StemSplit | API key |

### OCR

| Variable | Provider | Format |
|----------|----------|--------|
| `TESSERACT_BASE_URL` | Tesseract | Base URL of self-hosted instance |
| `PADDLEOCR_BASE_URL` | PaddleOCR | Base URL of self-hosted instance |
| `PADDLEOCR_API_KEY` | PaddleOCR Cloud | API key |
| `HF_INFERENCE_URL` | Hugging Face Inference Endpoint | Base URL (default `http://localhost:8000`) |

### Local Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `VLLM_BASE_URL` | `http://localhost:8000` | vLLM endpoint |
| `LLAMACPP_BASE_URL` | `http://localhost:8080` | llama.cpp endpoint |
| `COMFYUI_BASE_URL` | `http://localhost:8188` | ComfyUI local video generation |
| `COMFYUI_MAX_CONCURRENT` | `1` | Max concurrent ComfyUI jobs |
| `TEI_BASE_URL` | `http://localhost:8090` | Text Embeddings Inference (embeddings + reranking) |
| `PIPER_BASE_URL` | `http://localhost:5000` | Piper TTS (local text-to-speech) |
| `KOKORO_BASE_URL` | `http://localhost:8880` | Kokoro TTS (local text-to-speech) |
| `ORPHEUS_BASE_URL` | `http://localhost:5005` | Orpheus TTS (emotional expression) |
| `FASTER_WHISPER_BASE_URL` | `http://localhost:8000` | Faster-Whisper ASR (local speech-to-text) |
| `ULTRALYTICS_BASE_URL` | `http://localhost:8080` | Ultralytics YOLO (local vision/detection) |

### Provider Base URLs

Override default provider API base URLs:

| Variable | Default |
|----------|---------|
| `OPENAI_BASE_URL` | `https://api.openai.com` |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` |
| `STABILITY_BASE_URL` | `https://api.stability.ai` |

## UI

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `VITE_API_BASE` | (empty) | No | Browser API base URL. Empty means same origin (gateway serves UI). |

In development, the Vite dev server runs at `:4200` and proxies `/v1/*` to the gateway at `:3000`. In production, the UI is served by the gateway itself from `apps/gateway/public`.
