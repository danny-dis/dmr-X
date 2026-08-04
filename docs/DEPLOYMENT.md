# Deployment

DMR-X can be deployed as a Bun process, a Docker container, or a standalone binary. All modes require zero external infrastructure — SQLite handles persistence.

## Prerequisites

- [Bun](https://bun.sh) 1.0+ (recommended) or Node.js 18+
- At least one AI provider API key (or a local provider like Ollama)

## From Source

### Install and Build

```bash
bun install
bun run build
```

This builds all workspace packages and the UI. The UI bundles into `apps/gateway/public`.

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Required in production
NODE_ENV=production
DMRX_ADMIN_API_KEY=your-secure-admin-key

# Optional: encrypt provider keys at rest
DMRX_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Set at least one provider key
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=sk-ant-...
# or use a local provider
OLLAMA_BASE_URL=http://localhost:11434
```

See [CONFIGURATION.md](CONFIGURATION.md) for all variables.

### Run

```bash
bun run start
```

Gateway starts on `PORT` (default 3000). Open `http://localhost:3000` for the admin UI.

## Docker

### Docker Compose (Recommended)

```bash
docker compose up -d
```

This uses the root `Dockerfile` and `docker-compose.yml`:

- Multi-stage build (builder + production)
- `oven/bun:1-alpine` base image
- Non-root user (`dmrx`)
- Health check on `/healthz`
- Resource limits: 2GB memory, 2 CPUs
- Log rotation: 50MB max, 3 files
- Persistent volume for data at `/app/data` (the Dockerfile sets
  `DMRX_DATA_DIR=/app/data`; this is where the SQLite database is written)

> **Important:** Use `docker compose stop` (graceful) rather than `docker kill` (forced) to ensure SQLite data is properly flushed. The gateway handles SIGTERM with a 30-second grace period for clean shutdown.

### Environment Variables

Pass environment variables via `docker-compose.yml` or a `.env` file:

```yaml
# docker-compose.yml
services:
  gateway:
    environment:
      NODE_ENV: production
      DMRX_ADMIN_API_KEY: your-admin-key
      DMRX_ENCRYPTION_KEY: your-encryption-key
      OPENAI_API_KEY: sk-...
```

**Never bake `.env` into container images.** Use environment variables or a secrets manager.

### Custom Docker Build

```bash
docker build -t dmr-x .
docker run -d \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DMRX_ADMIN_API_KEY=your-admin-key \
  -e DMRX_DATA_DIR=/app/data \
  -v dmr-x-data:/app/data \
  dmr-x
```

## Standalone Binary

DMR-X compiles to a single standalone executable via `bun build --compile`. The binary includes the Bun runtime, all packages, and the UI assets.

### Build Binary

```bash
bun run build
cd apps/gateway
bun run build:exe          # Windows
bun run build:exe:linux    # Linux
bun run build:exe:macos    # macOS
```

### Run Binary

```bash
# Linux / macOS
./dmrx

# Windows
dmrx.exe
```

The binary creates its data directory at `~/.dmr-x/` on first run.

### Pre-Built Binaries

Download from the [Releases](https://github.com/dmr-x/dmr-x/releases) page:

| Platform | Archive |
|----------|---------|
| Linux x64 | `dmrx-linux-x64.tar.gz` |
| macOS x64 | `dmrx-darwin-x64.tar.gz` |
| Windows x64 | `dmrx-windows-x64.zip` |

Each archive contains the binary, UI assets, and an install script.

See [DISTRIBUTION.md](DISTRIBUTION.md) for install script details and CI/CD workflow.

## Production Checklist

### Security

- [ ] Set `NODE_ENV=production`
- [ ] Set `DMRX_ADMIN_API_KEY` to a strong random value
- [ ] Set `DMRX_ENCRYPTION_KEY` for provider key encryption at rest
- [ ] Set `DMRX_CORS_ORIGIN` to your actual UI origin(s)
- [ ] Set `DMRX_LOCAL_MODE=false`
- [ ] Configure provider API keys via the admin UI or environment variables

### Networking

- [ ] Expose port 3000 (or configured `PORT`)
- [ ] Configure reverse proxy (nginx, Caddy, etc.) if needed
- [ ] **If behind a reverse proxy, set `DMRX_TRUST_PROXY=true`** so the gateway honors `X-Forwarded-For` and `X-Forwarded-Proto`. Without this, client IPs will be wrong and rate-limiting/audit logs will misattribute requests.
- [ ] Set up TLS termination at the proxy layer
- [ ] Configure firewall rules

### Server Hardening

- [ ] `DMRX_BODY_LIMIT` matches your largest legitimate request (default 10 MB covers 256K-token prompts)
- [ ] `DMRX_REQUEST_TIMEOUT` matches your slowest legitimate model (default 60 s)
- [ ] `DMRX_KEEPALIVE_TIMEOUT` ≥ reverse proxy `keepalive_timeout` (default 65 s)
- [ ] `DMRX_MEMORY_LIMIT` matches the container memory limit (default 1.5 GB)

### Observability

- [ ] Verify health endpoint: `GET /health` (liveness), `GET /healthz` (subsystem health)
- [ ] **Scrape Prometheus metrics from `:9464/metrics`** (separate port, see below). Note: `/metrics` is only served if the telemetry service started successfully — it is best-effort and the gateway boots healthy even when it fails (a `warn` is logged). Verify it exists before wiring the scraper: `curl -s http://localhost:9464/metrics | head`; if empty, check the gateway log for "Failed to start telemetry service".
- [ ] Set up log aggregation (JSON logs to stdout)
- [ ] Monitor disk usage for SQLite data file
- [ ] Watch for `request_id` in 5xx error responses — quote it in incident reports

### Backup

- [ ] Back up the SQLite database. Plaintext installs write `~/.dmr-x/data.db`
      (or `$DMRX_DATA_DIR/data.db`); with `DMRX_ENCRYPTION_KEY` set the active
      file is `data.db.enc`. `scripts/backup/backup.sh` handles both.
- [ ] Back up `.env` or secrets manager configuration

## Health Checks

All endpoints return JSON:

```bash
# Basic health (liveness — always returns 200)
curl http://localhost:3000/health
# {"status":"ok"}

# Health with subsystem checks (returns 503 if any check fails)
curl http://localhost:3000/healthz
# {
#   "status": "ok",
#   "checks": {
#     "db_read":   { "status": "ok" },
#     "db_write":  { "status": "ok" },
#     "candidates":{ "status": "ok", "detail": "5 candidates" },
#     "memory":    { "status": "ok", "detail": "112MB / 1500MB" }
#   },
#   "uptime": 1234
# }

# Readiness probe (503 if router has no candidates)
curl http://localhost:3000/ready
# {"status":"ready"}

# Liveness probe
curl http://localhost:3000/livez
# {"status":"alive"}
```

## Metrics

DMR-X exposes Prometheus metrics on a **separate port** (default `:9464/metrics`) to keep the gateway's HTTP listener focused on user traffic.

> **The endpoint is not guaranteed to exist.** Telemetry starts in a best-effort
> background task (`server.ts`): if the OTel/Prometheus exporter fails to
> initialize, the gateway boots healthy with **no `/metrics`** and logs a single
> `warn` ("Failed to start telemetry service"). Before wiring a scraper, confirm
> it is present: `curl -s http://<host>:9464/metrics`. If it is empty/absent,
> check the gateway log for that warn line. (O7)

The metrics include:

- `dmr_request_count` — total requests by provider, model, modality, status
- `dmr_request_latency_ms` — request latency histogram
- `dmr_ttft_latency_ms` — time-to-first-token for streaming requests
- `dmr_token_usage_total` — token usage by provider, model, and type (prompt/completion/total)
- `dmr_cost_estimate_usd` — estimated cost in USD
- `dmr_error_count` — errors by provider, model, error code, modality
- `dmr_provider_health` — 1 = healthy, 0 = unhealthy, per provider

### Prometheus scrape config

```yaml
scrape_configs:
  - job_name: dmr-x
    scrape_interval: 15s
    static_configs:
      - targets: ['dmr-x:9464']
```

### Docker Compose note

The Prometheus port (`9464`) is **not** exposed in the default `docker-compose.yml` because metrics are intended for an in-cluster Prometheus. To scrape from outside the container, add a port mapping:

```yaml
services:
  gateway:
    ports:
      - "3000:3000"
      - "9464:9464"   # Prometheus metrics
```

## Reverse Proxy Configuration

### nginx

```nginx
server {
    listen 443 ssl;
    server_name dmrx.example.com;

    ssl_certificate /etc/ssl/certs/dmrx.pem;
    ssl_certificate_key /etc/ssl/private/dmrx.key;

    # Forward client IP and original protocol. The gateway must be told to
    # trust these headers — set DMRX_TRUST_PROXY=true (or "loopback" if nginx
    # runs on the same host). Without this, request.ip is the proxy's IP,
    # not the client's.
    real_ip_header X-Forwarded-For;
    set_real_ip_from 127.0.0.1;
    # add set_real_ip_from lines for any other trusted proxy CIDRs

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE streaming support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

### Caddy

```
dmrx.example.com {
    reverse_proxy localhost:3000
}
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `EADDRINUSE` on port 3000 | Kill the old process holding the port, or change `PORT` |
| `bun --watch` crashes | Use `bun run dev:gateway` instead — it handles watch mode correctly |
| `turbo build` fails on Windows | Build each package individually: `bun run build` |
| SQLite save errors | Check disk space and `DMRX_DATA_DIR` permissions |
| Provider keys not working | Check `/v1/admin/providers` for key status; ensure `DMRX_ENCRYPTION_KEY` is set if keys were encrypted |
| UI not loading | Ensure `bun run build` completed; check `apps/gateway/public/` exists |
