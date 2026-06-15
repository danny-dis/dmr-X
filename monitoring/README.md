# DMR-X Production Monitoring

DMR-X exports Prometheus metrics on a separate port (default `:9464/metrics`)
via the `TelemetryService`. This directory contains the recommended monitoring
configuration for a production deployment.

## Files

| File | Purpose |
|------|---------|
| `prometheus-alerts.yml` | 11 alert rules across 4 groups (availability, latency, cost, health) |
| `grafana-dashboard.json` | 10-panel Grafana dashboard (importable, no manual config) |
| `README.md` | This file |

## Prometheus scrape config

```yaml
scrape_configs:
  - job_name: dmr-x
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets: ['dmr-x.internal:9464']
        labels:
          service: dmr-x
          env: production
```

## Metric reference

All metrics are prefixed with `dmr_` and labeled by `provider_id`, `model_id`,
and (where applicable) `modality` and `token_type`.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `dmr_request_count_total` | counter | provider_id, model_id, modality, status_code | Total requests routed |
| `dmr_request_latency_ms` | histogram | provider_id, model_id, modality | Request latency distribution |
| `dmr_ttft_latency_ms` | histogram | provider_id, model_id | Time to first token (streaming) |
| `dmr_token_usage_total` | counter | provider_id, model_id, token_type | Tokens consumed (prompt/completion/total) |
| `dmr_cost_estimate_usd_total` | counter | provider_id, model_id | Estimated USD spend |
| `dmr_error_count_total` | counter | provider_id, model_id, error_code, modality | Errors by code |
| `dmr_provider_health` | gauge | provider_id | 1 = healthy, 0 = unhealthy |

## Alert summary

| Alert | Severity | Fires when |
|-------|----------|------------|
| `DmrxHighErrorRate` | page | > 10% errors over 5m on a single provider |
| `DmrxProviderDown` | page | Health gauge reads 0 for 2m |
| `DmrxAllProvidersUnhealthy` | page | Every provider unhealthy for 1m |
| `DmrxHighP99Latency` | page | p99 > 30s for 10m |
| `DmrxHighP95Latency` | ticket | p95 > 15s for 15m |
| `DmrxSlowTTFT` | ticket | p95 TTFT > 5s for 10m |
| `DmrxCostBurnHigh` | page | > $5/min sustained for 5m |
| `DmrxCostSpike` | ticket | 3x hourly baseline for 10m |
| `DmrxGatewayDown` | page | Scrape fails for 1m |
| `DmrxHighMemory` | ticket | RSS > 80% of 1.5GB limit for 5m |

## Grafana dashboard

Import `grafana-dashboard.json` via the Grafana UI (Dashboards → Import → Upload
JSON file). The dashboard uses a `Prometheus` datasource — change the UID/name
if your datasource is named differently.

The dashboard includes:
- **Stat row**: healthy providers, RPS, error rate, cost/min (with thresholds)
- **Request rate** by provider (top 8 width)
- **Latency percentiles** p50/p95/p99 (top 8 width)
- **TTFT p95** by provider
- **Tokens/min** by prompt/completion/total
- **Error rate** by error code
- **Cost rate** by provider

## Recommended deployment

1. Run DMR-X behind a reverse proxy (nginx/Caddy) that handles TLS and adds
   `X-Forwarded-For` (set `DMRX_TRUST_PROXY=true` in the gateway env)
2. Scrape `:9464/metrics` from Prometheus with 15s interval
3. Forward `page` alerts to PagerDuty / Opsgenie
4. Forward `ticket` alerts to a shared Slack channel
5. Review the dashboard during weekly ops review
