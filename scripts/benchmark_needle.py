#!/usr/bin/env python3
"""Needle pre-filter benchmark: OFF vs ON via the agentic path.

Tests:
  A) Direct Needle model — raw JAX latency baseline
  B) Agentic chat no tools — baseline
  C) Agentic chat 12 tools, needle OFF — full tool list → model
  D) Agentic chat 12 tools, needle ON — pre-filter → narrowed list → model

Run: python scripts/benchmark_needle.py
"""
import json
import time
import urllib.request
import urllib.error

GW = "http://127.0.0.1:47113"
NEEDLE = "http://127.0.0.1:8011"

# 12 tools so the pre-filter engages (>8 threshold in agentic.routes.js)
TOOLS = [
    {"type": "function", "function": {"name": "get_weather",        "description": "Get current weather for a city.",           "parameters": {"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}},
    {"type": "function", "function": {"name": "search_web",         "description": "Search the web for a query.",              "parameters": {"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}},
    {"type": "function", "function": {"name": "calculate",          "description": "Evaluate a math expression.",              "parameters": {"type":"object","properties":{"expr":{"type":"string"}},"required":["expr"]}}},
    {"type": "function", "function": {"name": "get_stock_price",    "description": "Get current stock ticker price.",          "parameters": {"type":"object","properties":{"ticker":{"type":"string"}},"required":["ticker"]}}},
    {"type": "function", "function": {"name": "translate_text",     "description": "Translate text to another language.",      "parameters": {"type":"object","properties":{"text":{"type":"string"},"lang":{"type":"string"}},"required":["text","lang"]}}},
    {"type": "function", "function": {"name": "get_news",           "description": "Get latest news headlines.",              "parameters": {"type":"object","properties":{"topic":{"type":"string"}},"required":["topic"]}}},
    {"type": "function", "function": {"name": "create_calendar_event","description": "Add an event to calendar.",             "parameters": {"type":"object","properties":{"title":{"type":"string"},"date":{"type":"string"}},"required":["title","date"]}}},
    {"type": "function", "function": {"name": "send_email",         "description": "Send an email to a recipient.",           "parameters": {"type":"object","properties":{"to":{"type":"string"},"subject":{"type":"string"},"body":{"type":"string"}},"required":["to","subject"]}}},
    {"type": "function", "function": {"name": "get_forex_rate",     "description": "Get currency exchange rate.",             "parameters": {"type":"object","properties":{"from":{"type":"string"},"to":{"type":"string"}},"required":["from","to"]}}},
    {"type": "function", "function": {"name": "lookup_definition",  "description": "Look up a word definition.",               "parameters": {"type":"object","properties":{"word":{"type":"string"}},"required":["word"]}}},
    {"type": "function", "function": {"name": "convert_units",      "description": "Convert between measurement units.",      "parameters": {"type":"object","properties":{"value":{"type":"number"},"from":{"type":"string"},"to":{"type":"string"}},"required":["value","from","to"]}}},
    {"type": "function", "function": {"name": "geocode_address",    "description": "Convert address to lat/long coordinates.",  "parameters": {"type":"object","properties":{"address":{"type":"string"}},"required":["address"]}}},
]

QUERY = "What's the weather like in San Francisco right now?"

def post(path, body, base=GW, timeout=180, retries=3):
    """POST with retry on transient connection errors."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                base + path,
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, ConnectionResetError, ConnectionRefusedError) as e:
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"    ⚠ retry {attempt+1}/{retries} after {wait}s: {str(e)[:60]}")
                time.sleep(wait)
            else:
                raise

def put(path, body, retries=3):
    """PUT with retry."""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                GW + path,
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json"},
                method="PUT",
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, ConnectionResetError, ConnectionRefusedError) as e:
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"    ⚠ retry {attempt+1}/{retries} after {wait}s: {str(e)[:60]}")
                time.sleep(wait)
            else:
                raise

def get(path, base=GW, retries=3):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(base + path, timeout=10) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, ConnectionResetError, ConnectionRefusedError) as e:
            if attempt < retries - 1:
                wait = 2 ** attempt
                time.sleep(wait)
            else:
                raise

def set_needle(enabled: bool):
    put("/v1/admin/settings", {"needleRouterEnabled": enabled})

def benchmark_direct_needle():
    """Raw Needle 2 model — C engine."""
    print("\n" + "─" * 72)
    print("A) DIRECT NEEDLE 2 (:8011) — C inference engine")
    print("   (this is what the gateway calls as a pre-filter)")
    body = {
        "model": "needle2",
        "messages": [{"role": "user", "content": QUERY}],
        "tools": TOOLS,
    }
    # cold start
    t0 = time.perf_counter()
    try:
        resp = post("/v1/chat/completions", body, base=NEEDLE, timeout=300)
        cold = time.perf_counter() - t0
        tool_calls = resp.get("choices", [{}])[0].get("message", {}).get("tool_calls", [])
        names = [tc.get("function", {}).get("name") for tc in tool_calls]
        print(f"   cold:  {cold:>7.2f}s  → tools={names}")
    except Exception as e:
        print(f"   cold:  FAILED — {e}")
        cold = None

    # warm (cached)
    t0 = time.perf_counter()
    try:
        resp = post("/v1/chat/completions", body, base=NEEDLE, timeout=300)
        warm = time.perf_counter() - t0
        print(f"   warm:  {warm:>7.2f}s  (worker-local TTL cache)")
    except Exception as e:
        print(f"   warm:  FAILED — {e}")
        warm = None

    return cold, warm

def run_agentic(label, with_tools=True):
    """Send one agentic chat request (non-streaming) and measure end-to-end latency."""
    body = {
        "model": "auto",
        "messages": [{"role": "user", "content": QUERY}],
        "max_steps": 1,
        "max_tokens": 150,
        "stream": False,
    }
    if with_tools:
        body["tools"] = TOOLS

    t0 = time.perf_counter()
    try:
        resp = post("/v1/agentic/chat", body)
        elapsed = time.perf_counter() - t0
        steps = resp.get("steps_completed", 0)
        all_steps = resp.get("all_steps", [])
        tool_calls = []
        if all_steps:
            for step in all_steps:
                for tc in (step.get("tool_calls") or []):
                    if isinstance(tc, dict):
                        name = tc.get("function", {}).get("name")
                        if name:
                            tool_calls.append(name)
        usage = resp.get("usage", {})
        return {
            "label": label,
            "latency_s": round(elapsed, 2),
            "steps": steps,
            "tool_calls": tool_calls,
            "total_tokens": usage.get("total_tokens", 0),
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "ok": True,
        }
    except Exception as e:
        elapsed = time.perf_counter() - t0
        return {
            "label": label,
            "latency_s": round(elapsed, 2),
            "steps": 0,
            "tool_calls": [],
            "total_tokens": 0,
            "prompt_tokens": 0,
            "ok": False,
            "error": str(e)[:80],
        }

def main():
    print("=" * 72)
    print("NEEDLE PRE-FILTER BENCHMARK")
    print(f"  Tools: {len(TOOLS)}  |  Query: {QUERY!r}")
    print(f"  Gateway: {GW}  |  Needle: {NEEDLE}")
    print("=" * 72)

    h = get("/health")
    nh = get("/v1/admin/needle/status")
    print(f"\nGateway: {h['status']}")
    print(f"Needle:  model_loaded={nh['modelLoaded']}, reachable={nh['reachable']}, enabled={nh['enabled']}")

    results = {}

    # ── A) Direct needle ──
    cold, warm = benchmark_direct_needle()
    results["needle_cold"] = cold
    results["needle_warm"] = warm

    # ── B) Agentic baseline (no tools, no needle) ──
    print("\n" + "─" * 72)
    print("B) AGENTIC — no tools (baseline, no needle involvement)")
    set_needle(False)
    time.sleep(0.5)
    baseline = run_agentic("baseline", with_tools=False)
    print(f"   {baseline['latency_s']:>6.2f}s  steps={baseline['steps']}  tokens={baseline['total_tokens']}  called={baseline['tool_calls']}")
    results["baseline"] = baseline

    # ── C) Agentic with tools, needle OFF ──
    print("\n" + "─" * 72)
    print("C) AGENTIC — 12 tools, Needle OFF (full tool list → model)")
    set_needle(False)
    time.sleep(0.5)
    off1 = run_agentic("off-1")
    off2 = run_agentic("off-2")
    print(f"   {off1['latency_s']:>6.2f}s  steps={off1['steps']}  tokens={off1['total_tokens']}  called={off1['tool_calls']}")
    print(f"   {off2['latency_s']:>6.2f}s  steps={off2['steps']}  tokens={off2['total_tokens']}  called={off2['tool_calls']}")
    results["off"] = off1
    results["off2"] = off2

    # ── D) Agentic with tools, needle ON ──
    print("\n" + "─" * 72)
    print("D) AGENTIC — 12 tools, Needle ON (pre-filter → narrowed list → model)")
    set_needle(True)
    time.sleep(0.5)
    on1 = run_agentic("on-1")
    on2 = run_agentic("on-2")
    print(f"   {on1['latency_s']:>6.2f}s  steps={on1['steps']}  tokens={on1['total_tokens']}  called={on1['tool_calls']}")
    print(f"   {on2['latency_s']:>6.2f}s  steps={on2['steps']}  tokens={on2['total_tokens']}  called={on2['tool_calls']}")
    results["on"] = on1
    results["on2"] = on2

    # ── Needle telemetry after ──
    tel = get("/v1/admin/needle/status")
    print(f"\n   Last needle outcome: {tel.get('lastOutcome')}  latency: {tel.get('lastLatencyMs')}ms  tools: {tel.get('lastToolCount')}/{tel.get('lastMatchedCount')}")

    # ── Summary ──
    print("\n" + "=" * 72)
    print("SUMMARY")
    print(f"{'Scenario':<35} {'Latency':>10} {'Tokens':>8} {'Tools called'}")
    print("─" * 72)
    if cold:
        print(f"{'A) Needle model (cold)':<35} {cold:>9.2f}s       —  (raw JAX)")
    if warm:
        print(f"{'A) Needle model (warm)':<35} {warm:>9.2f}s       —  (raw JAX, cache)")
    print(f"{'B) Agentic no tools':<35} {baseline['latency_s']:>9.2f}s {baseline['total_tokens']:>7}   {baseline['tool_calls']}")
    print(f"{'C) Agentic 12 tools, needle OFF':<35} {off1['latency_s']:>9.2f}s {off1['total_tokens']:>7}   {off1['tool_calls']}")
    print(f"{'D) Agentic 12 tools, needle ON':<35} {on1['latency_s']:>9.2f}s {on1['total_tokens']:>7}   {on1['tool_calls']}")

    if on1['ok'] and off1['ok']:
        delta = on1['latency_s'] - off1['latency_s']
        tax = on1['latency_s'] / off1['latency_s'] if off1['latency_s'] > 0 else float('inf')
        print(f"\n   Needle pre-filter tax: {delta:+.2f}s ({tax:.1f}x baseline)")
        if on1['total_tokens'] < off1['total_tokens']:
            print(f"   Token savings: -{off1['total_tokens'] - on1['total_tokens']} prompt tokens")
        elif on1['total_tokens'] > off1['total_tokens']:
            print(f"   Token cost: +{on1['total_tokens'] - off1['total_tokens']} prompt tokens")
        # Did needle correctly pick get_weather?
        if "get_weather" in on1['tool_calls']:
            print("   ✓ Needle correctly identified get_weather as the relevant tool")
        else:
            print(f"   ✗ Needle picked {on1['tool_calls']} instead of get_weather")

    # Restore
    set_needle(False)
    print(f"\n   Restored needleRouterEnabled=false")

if __name__ == "__main__":
    main()
