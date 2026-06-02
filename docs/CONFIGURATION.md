# Configuration

DMR-X is configured via environment variables. Copy `.env.example` to `.env` for local development. Values are read from `process.env` in Bun/Node packages and `import.meta.env` in the Vite UI.

## Gateway

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `NODE_ENV` | `development` | Production | `development` or `production` |
| `PORT` | `3000` | No | Gateway listen port |
| `LOG_LEVEL` | `info` | No | Logger level: `debug`, `info`, `warn`, `error` |
| `DMRX_DATA_DIR` | `~/.dmr-x` | No | Directory for SQLite database and data files |
| `DMRX_UI_DIR` | `apps/gateway/public` | No | Static UI directory served by the gateway |

## Authentication

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DMRX_LOCAL_MODE` | `false` | No | Skip tenant API key auth for local dev. **Never use in production.** |
| `DMRX_ADMIN_API_KEY` | — | Production | Admin API key for `/v1/admin/*` routes. Required unless `DMRX_LOCAL_MODE=true`. |
| `DMRX_ENCRYPTION_KEY` | — | No | AES-256-GCM key for encrypting provider API keys at rest (64 hex characters). If unset, keys are stored in plaintext. |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## CORS and Security

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DMRX_CORS_ORIGIN` | `http://localhost:4200`, `http://localhost:5173` | Production | Comma-separated allowed CORS origins. Never use `*` in production. |

Security headers are automatically applied:
- `Content-Security-Policy` — restricts script/style sources
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` (production only)
- `X-XSS-Protection: 0`

## Rate Limiting

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DMRX_RATE_LIMIT_MAX` | `100` | No | Maximum requests per window |
| `DMRX_RATE_LIMIT_WINDOW` | `1 minute` | No | Rate limit window duration |

## Routing

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DMRX_FREE_TIER_STRATEGY` | `none` | No | Free-tier routing strategy: `none`, `prioritize`, `load_balance`, `fallback` |

Strategies:
- `none` — ignore free-tier status, select by cost/latency/quality
- `prioritize` — prefer free-tier providers when available
- `load_balance` — distribute across free-tier providers
- `fallback` — use free-tier first, fall back to paid if unavailable

## Provider Keys

All provider keys are optional. Set the ones you want to use:

### Major Providers

| Variable | Provider | Format |
|----------|----------|--------|
| `OPENAI_API_KEY` | OpenAI | `sk-...` |
| `ANTHROPIC_API_KEY` | Anthropic | `sk-ant-...` |
| `GOOGLE_API_KEY` | Google Gemini | API key |
| `MISTRAL_API_KEY` | Mistral AI | API key |
| `DEEPSEEK_API_KEY` | DeepSeek | API key |
| `XAI_API_KEY` | xAI (Grok) | API key |

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

### Local Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `VLLM_BASE_URL` | `http://localhost:8000` | vLLM endpoint |
| `LLAMACPP_BASE_URL` | `http://localhost:8080` | llama.cpp endpoint |

### Provider Base URLs

Override default provider API base URLs:

| Variable | Default |
|----------|---------|
| `OPENAI_BASE_URL` | `https://api.openai.com` |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` |
| `STABILITY_BASE_URL` | `https://api.stability.ai` |

## MCP Server

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DMRX_MCP_TRANSPORT` | `stdio` | No | Transport: `stdio`, `sse`, `http` |
| `DMRX_MCP_PORT` | `3100` | No | MCP HTTP/SSE port |
| `DMRX_MCP_HOST` | `127.0.0.1` | No | MCP HTTP/SSE host. Use `0.0.0.0` for remote access. |
| `DMRX_MCP_API_KEY` | — | Production | API key for MCP server authentication |

**Security:** The MCP server binds to `127.0.0.1` by default. Only change to `0.0.0.0` if you need remote access, and always set `DMRX_MCP_API_KEY` when exposing externally.

## UI

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `VITE_API_BASE` | (empty) | No | Browser API base URL. Empty means same origin (gateway serves UI). |

In development, the Vite dev server runs at `:4200` and proxies `/v1/*` to the gateway at `:3000`. In production, the UI is served by the gateway itself from `apps/gateway/public`.
