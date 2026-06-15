# SLOs (Service Level Objectives)

DMR-X's commitments to its users, the metrics we use to measure
them, and how we report them.

## Availability

| Tier | SLO | Window | Error budget (30d) |
|------|-----|--------|---------------------|
| **Free / local** | Best effort | n/a | No commitment |
| **Production (default)** | 99.9% (8.77 h downtime / 30d) | Rolling 30 days | 43.83 minutes |
| **Production (multi-region)** | 99.95% (4.38 h / 30d) | Rolling 30 days | 21.92 minutes |

### Measurement

Availability is measured as the fraction of 1-minute windows where
`/healthz` returns 200 from at least one healthy gateway replica.
Windows where the gateway is intentionally down for maintenance do
NOT count against the SLO if announced ≥ 24h in advance.

The error budget is the time we can be down before breaching the
SLO. At 99.9%, that's **43.83 minutes per 30-day window**.

### Burn rate alerts

The Prometheus alert rules file already implements multi-window,
multi-burn-rate alerts (Google SRE workbook style). Add these to
`monitoring/prometheus-alerts.yml` for production:

```yaml
groups:
  - name: dmr-x.slo
    interval: 30s
    rules:
      # Fast burn: 14.4x of budget consumed in 1h, 2% SLO breach in <1d
      - alert: DmrxSloAvailabilityFastBurn
        expr: |
          (
            sum(rate(dmr_request_count_total{status_code=~"5.."}[1h]))
            /
            sum(rate(dmr_request_count_total[1h]))
          ) > (1 - 0.999) * 14.4
        for: 2m
        labels: { severity: page, slo: availability }
        annotations:
          summary: "Availability SLO fast burn (>14.4x budget in 1h)"
          description: "We're consuming error budget at 14.4x the steady-state rate. Page immediately."

      # Slow burn: 6x of budget consumed in 24h, 2% SLO breach in ~5d
      - alert: DmrxSloAvailabilitySlowBurn
        expr: |
          (
            sum(rate(dmr_request_count_total{status_code=~"5.."}[6h]))
            /
            sum(rate(dmr_request_count_total[6h]))
          ) > (1 - 0.999) * 6
        for: 30m
        labels: { severity: ticket, slo: availability }
        annotations:
          summary: "Availability SLO slow burn (>6x budget in 6h)"
          description: "Slow leak in availability. Investigate within the business day."
```

## Latency

| Endpoint class | SLO | Definition |
|----------------|-----|------------|
| **Chat (non-streaming)** | p99 < 15 s | All `/v1/chat/completions` requests with `stream: false` |
| **Chat (streaming)** | TTFT p95 < 3 s | Time-to-first-token for `stream: true` |
| **Embeddings** | p99 < 2 s | `/v1/embeddings` |
| **Image generation** | p99 < 60 s | `/v1/images/generations` |
| **Audio TTS** | p99 < 5 s for ≤ 500 chars | `/v1/audio/speech` |
| **Admin API** | p99 < 200 ms | `/v1/admin/*` |

### Measurement

Latency is measured from when Fastify receives the request
(`onRequest` hook) to when the response status is sent (`onResponse`
hook). Streaming requests measure TTFT (time to first SSE chunk)
and the *total* response time separately.

The SLOs are evaluated against `dmr_request_latency_ms` and
`dmr_ttft_latency_ms` histograms. p99 / p95 are computed with
`histogram_quantile()` in Prometheus.

## Cost

We commit to the following *operational* SLOs (not a per-user
spend cap — that's a quota, configured per-tenant):

| SLO | Definition |
|-----|------------|
| **No single tenant > 50% of daily spend** | Detect runaway clients |
| **Per-model error budget** | < 0.5% of requests to any model fail with provider_unavailable |

### Cost anomalies

`DmrxCostBurnHigh` and `DmrxCostSpike` in `prometheus-alerts.yml`
fire when the spend rate exceeds thresholds. These aren't strict
SLOs but they protect the customer billing account.

## Reporting

The Grafana dashboard (`monitoring/grafana-dashboard.json`) shows
real-time SLO compliance on the stat row. For historical reports:

```promql
# Availability over the last 30 days
1 - (
  sum(increase(dmr_request_count_total{status_code=~"5.."}[30d]))
  /
  sum(increase(dmr_request_count_total[30d]))
)

# Error budget remaining (1.0 = full, 0.0 = empty)
(1 - 0.001) * 30 * 24 * 60 - sum(increase(dmr_request_count_total{status_code=~"5.."}[30d])) / sum(rate(dmr_request_count_total[30d])) * 60
```

## Incident response

When the SLO is breached:

1. **Open an incident** in your incident tracker
2. **Page on-call** if it's a fast-burn alert
3. **Post in #incidents** with the alert name and dashboard link
4. **Track budget consumption** in the incident timeline
5. **Within 48h of resolution**: write a postmortem (template in
   `RUNBOOK.md`) and add preventive action items

The SLO budget is consumed by both real outages AND near-misses
(high error rate that didn't trigger an outage). Treat near-misses
as opportunities to harden, not as "we got lucky".
