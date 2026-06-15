# DMR-X Load Tests

k6 load tests for validating production readiness. Three scripts at
increasing intensity:

| Script | Profile | What it tests |
|--------|---------|---------------|
| `smoke.js` | 1 VU, 10s | Basic gateway liveness |
| `baseline.js` | 10 RPS constant, 60s | Steady-state chat completions |
| `stress.js` | Ramp 1→50 RPS, 4m | Saturation point, graceful degradation |
| `streaming.js` | 10 VU constant, 60s | SSE stream integrity under load |

## Prerequisites

```sh
# Install k6
brew install k6          # macOS
choco install k6         # Windows
sudo apt-get install k6  # Linux
```

## Running

All scripts read `GATEWAY_URL` and `OPENAI_API_KEY` from the environment.

```sh
# Smoke test (no API key required, just hits /healthz)
GATEWAY_URL=http://localhost:3000 k6 run scripts/loadtest/smoke.js

# Baseline (real upstream — uses OpenAI credits)
GATEWAY_URL=https://gateway.example.com \
  OPENAI_API_KEY=sk-... \
  TEST_MODEL=gpt-4o-mini \
  k6 run scripts/loadtest/baseline.js

# Stress
GATEWAY_URL=https://gateway.example.com \
  OPENAI_API_KEY=sk-... \
  k6 run scripts/loadtest/stress.js

# Streaming
GATEWAY_URL=https://gateway.example.com \
  OPENAI_API_KEY=sk-... \
  k6 run scripts/loadtest/streaming.js
```

## Output

`stress.js` writes `scripts/loadtest/results/stress-summary.json` with
the full metric dump — importable into Grafana as a `JSON` data source
or use the `xk6-summary` exporter.

## What "good" looks like

A healthy DMR-X deployment should hit these numbers on `gpt-4o-mini`:

| Metric | Acceptable | Investigate |
|--------|------------|-------------|
| p50 chat latency | < 1.5s | > 3s |
| p95 chat latency | < 8s | > 15s |
| p99 chat latency | < 25s | > 45s |
| p95 TTFT (streaming) | < 3s | > 5s |
| Error rate at 10 RPS | < 1% | > 5% |
| Error rate at 50 RPS | < 10% | > 20% |
| Saturation point | > 50 RPS | < 25 RPS |

If you're hitting the "investigate" thresholds, the runbook has
mitigation steps for each alert.

## CI integration

Wire `smoke.js` into your CI pipeline as a post-deploy smoke test:

```yaml
- name: Load test
  run: |
    GATEWAY_URL=https://staging.example.com k6 run scripts/loadtest/smoke.js
```

For full load tests, run them on a schedule (weekly) against a staging
environment that mirrors production capacity. Results should be
compared week-over-week — a 20% regression in p95 latency is a sign
something has changed.
