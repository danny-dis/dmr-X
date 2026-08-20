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

> **Implemented.** `monitoring/prometheus-alerts.yml` now contains multi-window
> burn-rate rules (fast burn: 14.4x in 1h; slow burn: 6x in 6h). These were
> added as part of the Tier 2 ops fixes. (O16)

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

## Benchmarks

Service-level objectives for the benchmark infrastructure: prompt evaluation,
arena battles, AI judge quality, and human validation.

### Benchmark execution latency

| Benchmark type | SLO | Definition |
|----------------|-----|------------|
| **Quick benchmark** (1 model, all 54 prompts) | p95 < 5 min | `/admin/benchmarks/run` with a single model |
| **Arena battle** (2 models + AI judge) | p95 < 3 min | `/admin/benchmarks/battle` — model responses + judge evaluation |
| **Tournament** (N models, round-robin) | p95 < 3 min × N² | `/admin/benchmarks/tournament` — O(N²) battles |
| **Multi-judge ensemble** (3 judges per battle) | p95 < 6 min | Adds 2 extra frontier-LLM judge calls per battle |

### Measurement

Benchmark latency is measured from when the admin endpoint receives the request
to when the final result set is persisted. It includes model inference time
(which varies by provider) and AI judge inference time.

The 95th percentile is evaluated from `dmr_benchmark_latency_ms` histogram data
in Prometheus. Benchmarks that time out (default: 10 min per individual run)
are counted as failures against the benchmark completion SLO.

### Judge quality

| Metric | SLO | Window | Source |
|--------|-----|--------|--------|
| **Judge-human agreement rate** | ≥ 80% | Rolling 30 days | `benchmark_validations` table |
| **Inter-rater reliability** (Cohen's Kappa) | ≥ 0.6 (substantial) | Per batch | `judge_reliability` table |
| **Regression detection sensitivity** | 100% of violations where \|Z\| > 3.0 | Per run | `BENCHMARK_REGRESSION` event |

The agreement rate measures how often the AI judge's winner matches the human
reviewer's verdict. A rate below 80% triggers investigation into judge prompt
quality, rubric calibration, or panel composition.

Cohen's Kappa is computed between every pair of judges in the default ensemble
(GPT-4o, Claude Sonnet 4, Gemini 2.5 Pro). Kappa < 0.6 indicates that judges
disagree more than expected — the rubric likely needs recalibration.

Regression detection fires `BENCHMARK_REGRESSION` when a model's score deviates
more than 2.0 Z-scores from its trailing 5-run average. All Critical-severity
(|Z| > 3.0) regressions must be detected without false negatives.

### Benchmark error budget

| SLO | Definition |
|-----|------------|
| **Benchmark completion rate** | ≥ 99% of all benchmark runs complete without error (timeout, judge failure, provider error) |
| **Judge service availability** | < 1% of judge evaluation calls fail due to downstream LLM unavailability |

Burn-rate alerts for benchmark completion use the same `monitoring/prometheus-alerts.yml`
framework (also **not yet implemented** — see the note under Availability):

```yaml
      # Benchmark failure rate > 5% in 1h
      - alert: DmrxSloBenchmarkFailures
        expr: |
          (
            sum(rate(dmr_benchmark_failures_total[1h]))
            /
            sum(rate(dmr_benchmark_attempts_total[1h]))
          ) > 0.05
        for: 5m
        labels: { severity: ticket, slo: benchmark }
        annotations:
          summary: "Benchmark failure rate > 5% in the last hour"
          description: "Elevated benchmark failures. Check provider health and judge availability."
```

### Benchmark reporting

```promql
# Judge agreement rate over the last 30 days
avg_over_time(dmr_judge_agreement_rate[30d])

# Benchmark P95 latency
histogram_quantile(0.95, sum(rate(dmr_benchmark_latency_ms_bucket[5m])))

# Regression events in the last 7 days
increase(dmr_regression_events_total[7d])
```

## Cost

We commit to the following *operational* SLOs (not a per-user
spend cap — that's a quota, configured per-tenant):

| SLO | Definition |
|-----|------------|
| **No single tenant > 50% of daily spend** | Detect runaway clients |
| **Per-model error budget** | < 0.5% of requests to any model fail with provider_unavailable |

### Cost anomalies

`DmrxCostBurnHigh` and `DmrxCostSpike` are the intended spend-rate alerts for
`prometheus-alerts.yml` (also **not yet implemented** — see the note under
Availability). They aren't strict SLOs but they protect the customer billing
account.

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
   `docs/RUNBOOK.md`) and add preventive action items

The SLO budget is consumed by both real outages AND near-misses
(high error rate that didn't trigger an outage). Treat near-misses
as opportunities to harden, not as "we got lucky".
