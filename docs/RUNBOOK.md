# DMR-X Operational Runbook

This is the incident-response playbook for on-call. Each section maps
to a specific alert from `monitoring/prometheus-alerts.yml`. The format
is **Alert → Diagnose → Mitigate → Recover → Postmortem**.

**When in doubt, page someone.** Most alerts here are SLO-bound —
delaying action burns the error budget.

---

## Page-severity alerts

### `DmrxAllProvidersUnhealthy`

> All upstream providers are reporting unhealthy. The gateway returns
> 503 for every request.

**Diagnose**

```sh
# 1. Check which providers are down
curl -s http://gateway:3000/v1/admin/providers | jq '.[] | {name, is_healthy}'

# 2. Pick the first unhealthy one and test the upstream directly
PROVIDER=openai
curl -fsS -o /dev/null -w '%{http_code}\n' \
  "https://api.openai.com/v1/models" \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# 3. Check egress from the gateway host
docker exec dmr-x-gateway curl -fsS -o /dev/null -w '%{http_code}\n' \
  https://api.openai.com/v1/models
```

**Mitigate**

| Cause | Action |
|-------|--------|
| Provider outage (e.g. OpenAI down) | Page their status page. Switch primary to backup provider via admin UI or `PUT /v1/admin/providers/{id}`. |
| Egress blocked | Check firewall / NAT / VPC routing. The gateway needs HTTPS to upstream hosts. |
| Bad credentials | Verify the API keys in `/v1/admin/providers/{name}`. Rotate if compromised. |
| Local mode accidentally on in prod | `DMRX_LOCAL_MODE=false` and restart. |

**Recover**

- Run `PUT /v1/admin/providers/{id}/reactivate` to re-mark providers healthy
- Watch `dmr_provider_health` gauge return to 1
- `dmr_request_count_total` rate should resume within 5 minutes

**Postmortem trigger**: Any time this fires in production.

---

### `DmrxProviderDown`

> One specific provider has been unhealthy for 2 minutes.

**Diagnose**

```sh
# Get the provider row
curl -s http://gateway:3000/v1/admin/providers | \
  jq '.[] | select(.is_healthy == 0) | {id, name, last_health_check, consecutive_failures}'
```

**Mitigate**

- If transient (network blip): wait — the health checker will recover it
- If sustained: rotate the API key, then re-activate:
  ```sh
  curl -X POST http://gateway:3000/v1/admin/providers/{id}/rotate \
    -H "X-Admin-Key: $DMRX_ADMIN_API_KEY" \
    -d '{"newKey": "sk-..."}'
  curl -X POST http://gateway:3000/v1/admin/providers/{id}/reactivate \
    -H "X-Admin-Key: $DMRX_ADMIN_API_KEY"
  ```
- If the upstream is down: disable routing to it via
  `PATCH /v1/admin/providers/{id} {is_active: false}`. The bandit will
  reroute traffic.

**Recover**: `dmr_provider_health{provider_id="X"} == 1`

**Postmortem trigger**: Recurring (3+ times in 24h).

---

### `DmrxHighErrorRate`

> A single provider's error rate has been > 10% for 5 minutes.

**Diagnose**

```sh
# 1. Top error codes for the affected provider
curl -s http://gateway:9464/metrics | \
  awk '/^dmr_error_count_total/ && $0 ~ /provider_id="openai"/' | head

# 2. In Grafana: open the Error rate by error code panel
# 3. Sample failing requests via the admin log API:
curl -s "http://gateway:3000/v1/admin/requests?provider=openai&status=5xx&limit=10"
```

**Mitigate**

| Error code | Action |
|------------|--------|
| `429` rate_limit | Slow down. Increase quota or raise `DMRX_RATE_LIMIT_MAX` (only if you're being throttled *by the gateway*, not the upstream). |
| `401` auth | Rotate the API key. |
| `500` upstream_bug | Page the provider. Disable routing to this provider until they recover. |
| `503` provider_unavailable | The bandit already moved on. Verify the next provider is healthy. |

**Recover**: Error rate < 5% sustained for 10 minutes.

---

### `DmrxHighP99Latency`

> p99 latency > 30s for 10 minutes on a specific provider.

**Diagnose**

```sh
# Compare p50/p95/p99 in Grafana — is it a tail issue or everything?
# If p50 is also high: upstream is slow.
# If only p99: a few requests are timing out, possibly due to retries.
```

**Mitigate**

- Upstream is slow → nothing to do at our layer. Page the provider.
- Tail is high → check `DMRX_REQUEST_TIMEOUT` (default 60s) — may be too high,
  letting requests pile up. Lower to 30s as a stopgap.
- Bandit fallback: if the slow provider is also erroring, the bandit
  will start preferring faster providers automatically.

**Recover**: p99 < 15s sustained for 10 minutes.

---

### `DmrxCostBurnHigh`

> Spend rate > $5/min for 5 minutes.

**Diagnose — this is the most important alert for protecting the
billing account.**

```sh
# 1. Find the top consumer RIGHT NOW
curl -s http://gateway:9464/metrics | grep '^dmr_cost_estimate_usd_total'

# 2. Find the top tenant
curl -s "http://gateway:3000/v1/admin/usage?groupBy=tenant&window=1h" | \
  jq 'sort_by(-.costUsd) | .[0:5]'

# 3. Check for runaway loops in /v1/requests
curl -s "http://gateway:3000/v1/admin/requests?window=10m&orderBy=cost&limit=10"
```

**Mitigate**

- If a single tenant is responsible: suspend their API key
  ```sh
  curl -X POST http://gateway:3000/v1/admin/tenants/{id}/suspend \
    -H "X-Admin-Key: $DMRX_ADMIN_API_KEY"
  ```
- If a single model is responsible: deactivate it
  ```sh
  curl -X PATCH http://gateway:3000/v1/admin/models/{id} \
    -H "X-Admin-Key: $DMRX_ADMIN_API_KEY" \
    -d '{"is_active": false}'
  ```
- If a key is leaked: rotate the provider key, then issue new tenant
  keys and revoke the old ones.

**Recover**: Spend rate < $1/min for 15 minutes.

**Postmortem trigger**: Always. Run a credit memo if customer-facing.

---

### `DmrxGatewayDown`

> Prometheus cannot scrape the gateway for 1 minute.

**Diagnose**

```sh
# Is the container running?
docker ps | grep dmr-x-gateway
# What does its log say?
docker logs --tail 200 dmr-x-gateway
# Did it OOM?
docker inspect dmr-x-gateway | grep -A 5 OOMKilled
```

**Mitigate**

| Cause | Action |
|-------|--------|
| OOMKilled | Increase memory limit in `docker-compose.prod.yml` from 2g to 4g. Look for a leak (check `dmr_request_count_total` rate vs memory). |
| Crashloop | Read the logs. Most common: bad `DMRX_ENCRYPTION_KEY` (decryption fails on every request), or DB corruption. |
| Network issue | Check docker network: `docker network inspect dmr-x_dmr-x`. |
| Disk full | `df -h` on the host. The `dmr-x-data` volume needs space for SQLite WAL. |

**Recover**: `/healthz` returns 200, scrape resumes.

---

## Ticket-severity alerts

These don't page but should be investigated within a business day.

| Alert | What to check |
|-------|---------------|
| `DmrxHighP95Latency` | Same as `DmrxHighP99Latency` but earlier warning. |
| `DmrxSlowTTFT` | Time-to-first-token high — usually means streaming responses are slow. Could indicate OTel exporter hanging. |
| `DmrxCostSpike` | Spend > 3x baseline. Lower priority than `DmrxCostBurnHigh`. |
| `DmrxHighMemory` | RSS > 80% of limit. Trending toward OOM. Investigate before it pages. |

---

## Pre-flight checklist (before deployments)

- [ ] `gitnexus_detect_changes` ran and only expected files changed
- [ ] New version is on `ghcr.io/danny-dis/dmr-x:<version>`
- [ ] `.env.prod` has all required keys (`DMRX_ADMIN_API_KEY`,
      `DMRX_ENCRYPTION_KEY`, `DMRX_CORS_ORIGIN`,
      `GRAFANA_ADMIN_PASSWORD`)
- [ ] S3 backup bucket is reachable and credentials are valid
- [ ] Provider API keys are still valid (rotation cycle)
- [ ] Slack / PagerDuty integrations still work (test alert)
- [ ] Database backup from within the last hour exists

## Deployment

```sh
# 1. Pull the new image
docker compose -f docker-compose.prod.yml pull gateway

# 2. Rolling restart (gateway is stateless, just bounce it)
docker compose -f docker-compose.prod.yml up -d gateway

# 3. Wait for healthcheck
docker compose -f docker-compose.prod.yml ps gateway

# 4. Verify metrics are flowing
curl -s http://gateway:9464/metrics | grep dmr_request_count_total
```

## Postmortem template

After any production incident, fill out a postmortem within 48 hours.
The template lives in `docs/POSTMORTEMS/`. Use the format:

```md
# Incident YYYY-MM-DD: <one-line summary>

## Impact
- Duration: <X minutes>
- Users affected: <N tenants, M requests>
- SLO budget consumed: <X%>
- Revenue impact: $<Y>

## Timeline (all times UTC)
- HH:MM <event>
- HH:MM <event>
- HH:MM <event>

## Root cause
<one paragraph>

## Why we didn't catch it earlier
<one paragraph>

## Action items
- [ ] <preventive action> (owner: @someone, due: YYYY-MM-DD)
- [ ] <detection action> (owner: @someone, due: YYYY-MM-DD)
```

## Escalation

| Severity | First responder | Escalation |
|----------|----------------|------------|
| Page (cost, all-providers-down, gateway down) | On-call engineer | Engineering lead within 30 min if not resolved |
| Ticket | On-call engineer | No escalation; resolve within business day |
| Info | None | Review in next weekly ops |

## Useful commands

```sh
# Tail gateway logs
docker logs -f dmr-x-gateway | npx pino-pretty

# Tail recent 5xx error logs only
docker logs dmr-x-gateway --since 10m 2>&1 | \
  jq -r 'select(.level >= 50) | "\(.time) [\(.level)] \(.msg)"'

# List running conversations
curl -s http://gateway:3000/v1/conversations?limit=20 \
  -H "Authorization: Bearer $DMRX_ADMIN_API_KEY" | jq

# List recent requests with errors
curl -s "http://gateway:3000/v1/admin/requests?status=5xx&window=1h" \
  -H "Authorization: Bearer $DMRX_ADMIN_API_KEY" | jq

# Re-activate a provider
curl -X POST http://gateway:3000/v1/admin/providers/{id}/reactivate \
  -H "X-Admin-Key: $DMRX_ADMIN_API_KEY"

# Suspend a tenant (stops all their requests)
curl -X POST http://gateway:3000/v1/admin/tenants/{id}/suspend \
  -H "X-Admin-Key: $DMRX_ADMIN_API_KEY"
```
