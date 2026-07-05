# DMR-X SDK Benchmarks

Benchmark suite for measuring the DMR-X Python SDK performance.

## Prerequisites

- A running DMR-X gateway (default: http://localhost:3000)
- A valid API key
- Python 3.10+

## Quick Start

```bash
# Install dependencies
pip install dmrx

# Smoke test (5 requests)
python benchmarks/benchmark_sdk.py --count 5

# Full benchmark (100 requests, 10 parallel)
python benchmarks/benchmark_sdk.py --count 100 --parallel 10

# Streaming benchmark
python benchmarks/benchmark_sdk.py --stream --count 20

# Run everything
python benchmarks/benchmark_sdk.py --all --count 30 --parallel 5
```

## Output

Results show latency percentiles (P50, P95, P99), error count, and requests per second:

```
Benchmark                       |    n | err |      avg |      p50 |      p95 |      p99 |    rps
-----------------------------------------------------------------------------------------------
  chat/auto-fast                |   20 |   0 |    245.3 |    210.5 |    410.2 |    520.1 |   81.5
  chat/auto                     |   20 |   0 |    380.1 |    350.0 |    620.8 |    810.3 |   52.6
  chat/auto-smart               |   20 |   0 |    890.5 |    720.3 |   1520.4 |   2100.2 |   22.4
  stream/auto                   |   10 |   0 |   1200.5 |   1100.2 |     -    |     -    |    -

Time-to-First-Token (TTFT): avg=180.2ms
```

## Interpreting Results

- **P50 < 300ms** — Good for interactive use
- **P95 < 1000ms** — Acceptable for most production use
- **TTFT < 200ms** — Good streaming experience
- **Error rate > 1%** — Investigate gateway health
