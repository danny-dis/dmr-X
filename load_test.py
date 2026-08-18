#!/usr/bin/env python3
"""
DMR-X Gateway Load Stress Test
Tests stability under real concurrent load with realistic request patterns.
"""

import asyncio
import json
import os
import random
import statistics
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import urllib.request
import urllib.error

# --- Config ---
GATEWAY_URL = os.environ.get("DMRX_GATEWAY_URL", "http://127.0.0.1:47113")
ADMIN_KEY = os.environ.get("DMRX_ADMIN_API_KEY", "dmrx-local-admin-key-2026")

# Test parameters
CONCURRENCY_LEVELS = [1, 5, 10, 25, 50]
DURATION_SECONDS = 30  # sustained load duration
REQUEST_TIMEOUT = 120  # seconds per request
WARMUP_REQUESTS = 5

# Prompt variety to avoid cache hits
PROMPTS = [
    "Say 'alpha' and nothing else",
    "What is 2+2? Reply with just the number.",
    "Reply with the word 'bravo'",
    "Count to 3, comma separated",
    "Say 'charlie' then stop",
    "What color is the sky? One word.",
    "Reply: 'delta confirmed'",
    "Name one prime number under 10",
    "Say 'echo' followed by a period",
    "What is the capital of France? One word.",
]

MULTI_TURN_PROMPTS = [
    [{"role": "user", "content": "My name is Alice. Remember it."},
     {"role": "assistant", "content": "Got it, your name is Alice."},
     {"role": "user", "content": "What is my name?"}],
    [{"role": "system", "content": "You are a helpful coding assistant."},
     {"role": "user", "content": "Write a Python function that returns 'hello'"}],
]

# Models to test (mix of free providers)
MODELS = [
    "pollinations/openai-fast",
    "google/gemini-2.0-flash",
    "auto-free",
]


@dataclass
class RequestResult:
    status_code: int
    latency_ms: float
    success: bool
    model_used: Optional[str] = None
    error: Optional[str] = None
    provider_id: Optional[str] = None
    fallback_used: bool = False
    streaming: bool = False
    tokens: int = 0


@dataclass
class PhaseResult:
    name: str
    concurrency: int
    total_requests: int
    successful: int
    failed: int
    latencies: list = field(default_factory=list)
    errors: dict = field(default_factory=dict)
    start_time: float = 0
    end_time: float = 0
    results: list = field(default_factory=list)

    @property
    def duration(self):
        return self.end_time - self.start_time

    @property
    def rps(self):
        return self.total_requests / self.duration if self.duration > 0 else 0

    @property
    def success_rate(self):
        return self.successful / self.total_requests * 100 if self.total_requests > 0 else 0

    @property
    def p50(self):
        return statistics.median(self.latencies) if self.latencies else 0

    @property
    def p95(self):
        if not self.latencies:
            return 0
        s = sorted(self.latencies)
        idx = int(len(s) * 0.95)
        return s[min(idx, len(s) - 1)]

    @property
    def p99(self):
        if not self.latencies:
            return 0
        s = sorted(self.latencies)
        idx = int(len(s) * 0.99)
        return s[min(idx, len(s) - 1)]


def make_request(model: str, messages: list, stream: bool = False) -> RequestResult:
    """Make a single request to the gateway."""
    url = f"{GATEWAY_URL}/v1/chat/completions"
    body = json.dumps({
        "model": model,
        "messages": messages,
        "modality": "llm",
        "stream": stream,
        "metadata": {}
    }).encode()

    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {ADMIN_KEY}",
    })

    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            body = resp.read().decode()
            latency = (time.monotonic() - start) * 1000

            if stream:
                # For streaming, just check we got some data
                lines = [l for l in body.split('\n') if l.startswith('data: ')]
                has_content = any('content' in l or 'stop' in l for l in lines)
                return RequestResult(
                    status_code=200,
                    latency_ms=latency,
                    success=has_content,
                    streaming=True,
                    tokens=len(lines),
                )

            data = json.loads(body)
            if "error" in data:
                return RequestResult(
                    status_code=data.get("error", {}).get("code", 500),
                    latency_ms=latency,
                    success=False,
                    error=data["error"].get("message", str(data["error"])),
                )

            choice = data.get("choices", [{}])[0]
            msg = choice.get("message", {})
            content = msg.get("content", "")
            usage = data.get("usage", {})
            fallback = data.get("dmrx_fallback")

            return RequestResult(
                status_code=200,
                latency_ms=latency,
                success=True,
                model_used=data.get("model"),
                tokens=usage.get("total_tokens", 0),
                fallback_used=bool(fallback),
                provider_id=choice.get("message", {}).get("extra_content", {}).get("google", {}).get("thought_signature", "")[:20] if msg.get("extra_content") else None,
            )

    except urllib.error.HTTPError as e:
        latency = (time.monotonic() - start) * 1000
        body = e.read().decode() if e.fp else ""
        return RequestResult(
            status_code=e.code,
            latency_ms=latency,
            success=False,
            error=f"HTTP {e.code}: {body[:200]}",
        )
    except Exception as e:
        latency = (time.monotonic() - start) * 1000
        return RequestResult(
            status_code=0,
            latency_ms=latency,
            success=False,
            error=str(e)[:300],
        )


async def async_request(model: str, messages: list, stream: bool = False) -> RequestResult:
    """Async wrapper for make_request."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, make_request, model, messages, stream)


async def run_concurrent_phase(concurrency: int, duration: float, label: str) -> PhaseResult:
    """Run a phase of sustained concurrent requests for a given duration."""
    phase = PhaseResult(name=label, concurrency=concurrency, total_requests=0, successful=0, failed=0)
    phase.start_time = time.monotonic()
    deadline = phase.start_time + duration
    counter = {"n": 0}
    lock = asyncio.Lock()

    async def worker():
        while time.monotonic() < deadline:
            prompt = random.choice(PROMPTS)
            model = random.choice(MODELS)
            messages = [{"role": "user", "content": prompt}]

            result = await async_request(model, messages)

            async with lock:
                counter["n"] += 1
                phase.total_requests += 1
                phase.latencies.append(result.latency_ms)
                phase.results.append(result)
                if result.success:
                    phase.successful += 1
                else:
                    phase.failed += 1
                    err_key = result.error[:80] if result.error else f"status_{result.status_code}"
                    phase.errors[err_key] = phase.errors.get(err_key, 0) + 1

    workers = [asyncio.create_task(worker()) for _ in range(concurrency)]
    await asyncio.gather(*workers)

    phase.end_time = time.monotonic()
    return phase


async def run_burst_phase(concurrency: int, label: str) -> PhaseResult:
    """Run a burst of exactly `concurrency` requests simultaneously."""
    phase = PhaseResult(name=label, concurrency=concurrency, total_requests=0, successful=0, failed=0)
    phase.start_time = time.monotonic()

    async def single_request(i):
        prompt = PROMPTS[i % len(PROMPTS)]
        model = MODELS[i % len(MODELS)]
        return await async_request(model, [{"role": "user", "content": prompt}])

    results = await asyncio.gather(*[single_request(i) for i in range(concurrency)])

    phase.end_time = time.monotonic()
    phase.total_requests = len(results)
    for r in results:
        phase.latencies.append(r.latency_ms)
        phase.results.append(r)
        if r.success:
            phase.successful += 1
        else:
            phase.failed += 1
            err_key = r.error[:80] if r.error else f"status_{r.status_code}"
            phase.errors[err_key] = phase.errors.get(err_key, 0) + 1

    return phase


def print_phase(p: PhaseResult):
    """Print phase results."""
    print(f"\n{'='*60}")
    print(f"Phase: {p.name} | Concurrency: {p.concurrency}")
    print(f"{'='*60}")
    print(f"Duration:      {p.duration:.1f}s")
    print(f"Total:         {p.total_requests}")
    print(f"Successful:    {p.successful} ({p.success_rate:.1f}%)")
    print(f"Failed:        {p.failed}")
    print(f"Throughput:    {p.rps:.1f} req/s")
    if p.latencies:
        print(f"Latency mean:  {statistics.mean(p.latencies):.0f}ms")
        print(f"Latency med:   {p.p50:.0f}ms")
        print(f"Latency p95:   {p.p95:.0f}ms")
        print(f"Latency p99:   {p.p99:.0f}ms")
        print(f"Latency min:   {min(p.latencies):.0f}ms")
        print(f"Latency max:   {max(p.latencies):.0f}ms")
    if p.errors:
        print(f"\nErrors (top 5):")
        for err, count in sorted(p.errors.items(), key=lambda x: -x[1])[:5]:
            print(f"  [{count}x] {err}")


def get_gateway_stats():
    """Get gateway health stats."""
    try:
        req = urllib.request.Request(f"{GATEWAY_URL}/healthz")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None


def get_gateway_pid():
    """Get gateway PID."""
    try:
        import subprocess
        out = subprocess.check_output(
            ['wmic', 'process', 'where', "Name='bun.exe'", 'get', 'ProcessId,CommandLine'],
            text=True
        )
        for line in out.splitlines():
            if 'apps/gateway/src/main.ts' in line:
                parts = line.strip().split()
                if parts:
                    return int(parts[0])
    except Exception:
        pass
    return None


def monitor_resource_usage(pid: int, duration: int) -> dict:
    """Monitor CPU and memory usage of a process."""
    samples = []
    start = time.monotonic()
    while time.monotonic() - start < duration:
        try:
            import subprocess
            out = subprocess.check_output(
                ['wmic', 'process', 'where', f'ProcessId={pid}', 'get', 'WorkingSetSize,UserModeTime,KernelModeTime'],
                text=True, timeout=5
            )
            for line in out.splitlines():
                line = line.strip()
                if line and line[0].isdigit():
                    parts = line.split()
                    if len(parts) >= 3:
                        samples.append({
                            'time': time.monotonic() - start,
                            'rss_mb': int(parts[0]) / (1024 * 1024),
                            'cpu_time': int(parts[1]) + int(parts[2]),
                        })
        except Exception:
            pass
        time.sleep(1)
    return {
        'samples': samples,
        'avg_rss_mb': statistics.mean([s['rss_mb'] for s in samples]) if samples else 0,
        'max_rss_mb': max([s['rss_mb'] for s in samples]) if samples else 0,
    }


async def main():
    print("=" * 60)
    print("DMR-X GATEWAY LOAD STRESS TEST")
    print(f"Target: {GATEWAY_URL}")
    print(f"Time:   {datetime.now().isoformat()}")
    print("=" * 60)

    # Pre-flight: health check
    print("\n[PRE-FLIGHT] Health check...")
    stats = get_gateway_stats()
    if not stats:
        print("FATAL: Gateway is not responding. Aborting.")
        sys.exit(1)
    print(f"  Status:      {stats.get('status')}")
    print(f"  Candidates:  {stats.get('checks', {}).get('candidates', {}).get('detail', 'unknown')}")
    print(f"  Memory:      {stats.get('checks', {}).get('memory', {}).get('detail', 'unknown')}")
    print(f"  Uptime:      {stats.get('uptime', 'unknown')}s")

    pid = get_gateway_pid()
    print(f"  PID:         {pid}")

    # Warmup
    print(f"\n[WARMUP] {WARMUP_REQUESTS} requests...")
    for i in range(WARMUP_REQUESTS):
        r = make_request("pollinations/openai-fast", [{"role": "user", "content": "warmup"}])
        sys.stdout.write(f"  [{i+1}/{WARMUP_REQUESTS}] {'OK' if r.success else 'FAIL'} ({r.latency_ms:.0f}ms)\n")

    all_phases = []

    # Phase 1: Burst tests at increasing concurrency
    print("\n" + "=" * 60)
    print("PHASE 1: BURST TESTS (simultaneous requests)")
    print("=" * 60)
    for conc in CONCURRENCY_LEVELS:
        p = await run_burst_phase(conc, f"burst_{conc}")
        print_phase(p)
        all_phases.append(p)
        await asyncio.sleep(1)  # brief recovery between bursts

    # Phase 2: Sustained load (30s at concurrency 10)
    print("\n" + "=" * 60)
    print("PHASE 2: SUSTAINED LOAD TEST")
    print("=" * 60)
    sustained_concurrency = 10
    print(f"Running {sustained_concurrency}-concurrent requests for {DURATION_SECONDS}s...")

    # Start resource monitor in background
    if pid:
        import threading
        resource_result = {}
        def monitor_thread():
            resource_result.update(monitor_resource_usage(pid, DURATION_SECONDS + 5))
        t = threading.Thread(target=monitor_thread, daemon=True)
        t.start()

    p = await run_concurrent_phase(sustained_concurrency, DURATION_SECONDS, f"sustained_{sustained_concurrency}c_{DURATION_SECONDS}s")
    print_phase(p)
    all_phases.append(p)

    if pid and 'samples' in resource_result:
        print(f"\n  Resource usage during sustained load:")
        print(f"    Avg RSS: {resource_result['avg_rss_mb']:.0f} MB")
        print(f"    Max RSS: {resource_result['max_rss_mb']:.0f} MB")

    # Phase 3: Streaming test
    print("\n" + "=" * 60)
    print("PHASE 3: STREAMING TEST (concurrent streams)")
    print("=" * 60)
    STREAM_CONCURRENCY = 10
    print(f"Running {STREAM_CONCURRENCY} concurrent streaming requests...")

    async def stream_request(i):
        return await async_request(
            MODELS[i % len(MODELS)],
            [{"role": "user", "content": f"Count to 5 slowly. Stream #{i}"}],
            stream=True,
        )

    stream_start = time.monotonic()
    stream_results = await asyncio.gather(*[stream_request(i) for i in range(STREAM_CONCURRENCY)])
    stream_duration = time.monotonic() - stream_start

    stream_success = sum(1 for r in stream_results if r.success)
    stream_latencies = [r.latency_ms for r in stream_results]
    print(f"  Completed:  {stream_success}/{STREAM_CONCURRENCY} successful")
    print(f"  Duration:   {stream_duration:.1f}s")
    print(f"  Latency:    mean={statistics.mean(stream_latencies):.0f}ms p95={sorted(stream_latencies)[int(len(stream_latencies)*0.95)]:.0f}ms")

    # Phase 4: Multi-turn / longer context
    print("\n" + "=" * 60)
    print("PHASE 4: MULTI-TURN CONVERSATION TEST")
    print("=" * 60)
    MULTI_CONCURRENCY = 10

    async def multi_turn_request(i):
        messages = MULTI_TURN_PROMPTS[i % len(MULTI_TURN_PROMPTS)]
        return await async_request(MODELS[i % len(MODELS)], messages)

    multi_start = time.monotonic()
    multi_results = await asyncio.gather(*[multi_turn_request(i) for i in range(MULTI_CONCURRENCY)])
    multi_duration = time.monotonic() - multi_start

    multi_success = sum(1 for r in multi_results if r.success)
    multi_latencies = [r.latency_ms for r in multi_results]
    print(f"  Completed:  {multi_success}/{MULTI_CONCURRENCY} successful")
    print(f"  Duration:   {multi_duration:.1f}s")
    print(f"  Latency:    mean={statistics.mean(multi_latencies):.0f}ms p95={sorted(multi_latencies)[int(len(multi_latencies)*0.95)]:.0f}ms")

    # Post-test health check
    print("\n[POST-TEST] Health check...")
    after_stats = get_gateway_stats()
    if after_stats:
        print(f"  Status:      {after_stats.get('status')}")
        print(f"  Memory:      {after_stats.get('checks', {}).get('memory', {}).get('detail', 'unknown')}")
        print(f"  Uptime:      {after_stats.get('uptime', 'unknown')}s")

    # Final summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    total_requests = sum(p.total_requests for p in all_phases)
    total_successful = sum(p.successful for p in all_phases)
    total_failed = sum(p.failed for p in all_phases)
    all_latencies = [ms for p in all_phases for ms in p.latencies]

    print(f"Total requests (burst + sustained): {total_requests}")
    print(f"  Successful: {total_successful} ({total_successful/total_requests*100:.1f}%)")
    print(f"  Failed:     {total_failed}")
    if all_latencies:
        print(f"Overall latency: mean={statistics.mean(all_latencies):.0f}ms p50={statistics.median(all_latencies):.0f}ms p95={sorted(all_latencies)[int(len(all_latencies)*0.95)]:.0f}ms")

    # Fallback analysis
    fallbacks = sum(1 for p in all_phases for r in p.results if r.fallback_used)
    print(f"Fallbacks triggered: {fallbacks}/{total_requests} ({fallbacks/total_requests*100:.1f}%)" if total_requests else "No fallbacks")

    # Verdict
    print("\n" + "=" * 60)
    if total_successful / total_requests >= 0.99 and sorted(all_latencies)[int(len(all_latencies)*0.95)] < 10000:
        print("VERDICT: PASS — Gateway is stable under load")
    elif total_successful / total_requests >= 0.90:
        print("VERDICT: DEGRADED — Functional but some requests failing or slow")
    else:
        print("VERDICT: FAIL — Too many failures under load")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
