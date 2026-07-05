"""
DMR-X Python SDK Benchmark Suite.

Measures latency, throughput, and streaming performance against
a live DMR-X gateway.

Usage:
    # Quick smoke test (5 requests)
    python benchmarks/benchmark_sdk.py --count 5

    # Full benchmark (100 requests, parallel)
    python benchmarks/benchmark_sdk.py --count 100 --parallel 10

    # Streaming benchmark
    python benchmarks/benchmark_sdk.py --stream --count 20
"""

import argparse
import asyncio
import statistics
import time
from dataclasses import dataclass, field
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed


@dataclass
class BenchmarkResult:
    """Results from a benchmark run."""

    label: str
    latencies_ms: List[float] = field(default_factory=list)
    errors: int = 0
    total_tokens: int = 0
    time_to_first_token_ms: List[float] = field(default_factory=list)

    @property
    def total_requests(self) -> int:
        return len(self.latencies_ms) + self.errors

    @property
    def p50(self) -> float:
        return statistics.median(self.latencies_ms) if self.latencies_ms else 0

    @property
    def p95(self) -> float:
        if not self.latencies_ms:
            return 0
        sorted_lats = sorted(self.latencies_ms)
        idx = int(len(sorted_lats) * 0.95)
        return sorted_lats[min(idx, len(sorted_lats) - 1)]

    @property
    def p99(self) -> float:
        if not self.latencies_ms:
            return 0
        sorted_lats = sorted(self.latencies_ms)
        idx = int(len(sorted_lats) * 0.99)
        return sorted_lats[min(idx, len(sorted_lats) - 1)]

    @property
    def avg(self) -> float:
        return statistics.mean(self.latencies_ms) if self.latencies_ms else 0

    @property
    def rps(self) -> float:
        total_time = sum(self.latencies_ms) / 1000
        return len(self.latencies_ms) / total_time if total_time > 0 else 0

    def summary(self) -> str:
        return (
            f"  {self.label:30s} | "
            f"n={self.total_requests:4d} | "
            f"err={self.errors:2d} | "
            f"avg={self.avg:8.1f}ms | "
            f"p50={self.p50:8.1f}ms | "
            f"p95={self.p95:8.1f}ms | "
            f"p99={self.p99:8.1f}ms | "
            f"rps={self.rps:6.1f}"
        )


def run_chat_benchmark(
    api_key: str,
    base_url: str,
    model: str = "auto",
    count: int = 20,
    parallel: int = 1,
    max_tokens: int = 50,
) -> BenchmarkResult:
    """Run a synchronous chat completion benchmark."""
    from dmrx import DMRXClient

    client = DMRXClient(api_key=api_key, base_url=base_url)
    result = BenchmarkResult(label=f"chat/{model}")

    def do_request() -> Optional[float]:
        try:
            start = time.perf_counter()
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "Say 'hello' and count to 5."}],
                max_tokens=max_tokens,
            )
            elapsed = (time.perf_counter() - start) * 1000
            result.latencies_ms.append(elapsed)
            if resp.usage:
                result.total_tokens += resp.usage.total_tokens
            return elapsed
        except Exception:
            result.errors += 1
            return None

    with ThreadPoolExecutor(max_workers=parallel) as pool:
        futures = [pool.submit(do_request) for _ in range(count)]
        for f in as_completed(futures):
            f.result()

    client.close()
    return result


def run_stream_benchmark(
    api_key: str,
    base_url: str,
    model: str = "auto",
    count: int = 10,
    parallel: int = 1,
    max_tokens: int = 100,
) -> BenchmarkResult:
    """Run a streaming benchmark, measuring TTFT and total latency."""
    from dmrx import DMRXClient

    client = DMRXClient(api_key=api_key, base_url=base_url)
    result = BenchmarkResult(label=f"stream/{model}")

    def do_stream() -> None:
        try:
            start = time.perf_counter()
            first_token = True
            stream = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "Write a paragraph about AI."}],
                max_tokens=max_tokens,
                stream=True,
            )
            for chunk in stream:
                if first_token:
                    ttft = (time.perf_counter() - start) * 1000
                    result.time_to_first_token_ms.append(ttft)
                    first_token = False
            elapsed = (time.perf_counter() - start) * 1000
            result.latencies_ms.append(elapsed)
        except Exception:
            result.errors += 1

    with ThreadPoolExecutor(max_workers=parallel) as pool:
        futures = [pool.submit(do_stream) for _ in range(count)]
        for f in as_completed(futures):
            f.result()

    client.close()
    return result


def run_embedding_benchmark(
    api_key: str,
    base_url: str,
    count: int = 20,
    parallel: int = 1,
) -> BenchmarkResult:
    """Run an embedding benchmark."""
    from dmrx import DMRXClient

    client = DMRXClient(api_key=api_key, base_url=base_url)
    result = BenchmarkResult(label="embedding")

    def do_request() -> None:
        try:
            start = time.perf_counter()
            client.embeddings.create(
                input=["Hello world", "Benchmark test"],
                model="auto",
            )
            elapsed = (time.perf_counter() - start) * 1000
            result.latencies_ms.append(elapsed)
        except Exception:
            result.errors += 1

    with ThreadPoolExecutor(max_workers=parallel) as pool:
        futures = [pool.submit(do_request) for _ in range(count)]
        for f in as_completed(futures):
            f.result()

    client.close()
    return result


def main():
    parser = argparse.ArgumentParser(description="DMR-X SDK Benchmark Suite")
    parser.add_argument("--api-key", default=None, help="DMR-X API key")
    parser.add_argument("--base-url", default="http://localhost:3000", help="Gateway URL")
    parser.add_argument("--count", type=int, default=20, help="Number of requests")
    parser.add_argument("--parallel", type=int, default=1, help="Parallel workers")
    parser.add_argument("--stream", action="store_true", help="Run streaming benchmark")
    parser.add_argument("--model", default="auto", help="Model or meta-model alias")
    parser.add_argument("--all", action="store_true", help="Run all benchmarks")
    args = parser.parse_args()

    api_key = args.api_key or "dmrx_dev_key"

    print("╔══════════════════════════════════════════════════════════╗")
    print("║           DMR-X Python SDK Benchmark Suite             ║")
    print("╠══════════════════════════════════════════════════════════╣")
    print(f"║  Gateway: {args.base_url}")
    print(f"║  Count:   {args.count}  |  Parallel: {args.parallel}")
    print("╚══════════════════════════════════════════════════════════╝")
    print()
    print(f"{'Benchmark':30s} | {'n':>4s} | {'err':>2s} | {'avg':>8s} | {'p50':>8s} | {'p95':>8s} | {'p99':>8s} | {'rps':>6s}")
    print("-" * 95)

    results: List[BenchmarkResult] = []

    if args.all or (not args.stream):
        for model in ["auto-fast", "auto", "auto-smart"]:
            r = run_chat_benchmark(
                api_key, args.base_url, model, args.count, args.parallel
            )
            results.append(r)
            print(r.summary())

    if args.all or args.stream:
        r = run_stream_benchmark(
            api_key, args.base_url, args.model, max(5, args.count // 2), min(args.parallel, 5)
        )
        results.append(r)
        print(r.summary())

        if r.time_to_first_token_ms:
            avg_ttft = statistics.mean(r.time_to_first_token_ms)
            print(f"\n  Time-to-First-Token (TTFT): avg={avg_ttft:.1f}ms")

    if args.all:
        r = run_embedding_benchmark(api_key, args.base_url, args.count, args.parallel)
        results.append(r)
        print(r.summary())

    print("\n✅ Benchmark complete.")


if __name__ == "__main__":
    main()
