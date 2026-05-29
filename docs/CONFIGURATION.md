# Configuration

Use `.env.example` as the authoritative template. Values are read from `process.env` in Node packages and `import.meta.env` in the Vite UI.

## Gateway

- `NODE_ENV`: `development` or `production`.
- `PORT`: gateway port, default `3000`.
- `LOG_LEVEL`: logger level, default `info`.
- `DMRX_DATA_DIR`: local data directory.
- `DMRX_UI_DIR`: static UI directory.
- `DMRX_LOCAL_MODE`: `true` skips tenant API key auth for local use.
- `DMRX_ADMIN_API_KEY`: required for admin routes outside local mode.
- `DMRX_CORS_ORIGIN`: allowed origin, default `*`.
- `DMRX_RATE_LIMIT_MAX`: Fastify rate-limit max.
- `DMRX_RATE_LIMIT_WINDOW`: Fastify rate-limit window.
- `DMRX_FREE_TIER_STRATEGY`: `none`, `prioritize`, `load_balance`, or `fallback`.

## UI

- `VITE_API_BASE`: browser API base URL. Empty means same origin.

## Providers

Provider keys are optional unless you want that provider enabled. Examples include `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `STABILITY_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`, `COHERE_API_KEY`, and `JINA_API_KEY`.

## MCP

- `DMRX_MCP_TRANSPORT`: `stdio`, `sse`, or `http`.
- `DMRX_MCP_PORT`: MCP HTTP/SSE port, default `3100`.
- `DMRX_MCP_HOST`: MCP HTTP/SSE host, default `0.0.0.0`.
