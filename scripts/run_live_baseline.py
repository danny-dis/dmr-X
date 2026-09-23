#!/usr/bin/env python
"""Reproducible black-box baseline for a live DMR-X gateway.

Measures the behavior users actually see from the three default meta-models:
availability, routing, latency, strict instruction following, coding, multi-turn
context, tool-call emission, and streaming. It intentionally uses deterministic,
locally-scored tasks so a future run can be compared without an LLM judge.

Usage:
  python scripts/run_live_baseline.py
  DMRX_BASE_URL=http://127.0.0.1:47113 python scripts/run_live_baseline.py

A timestamped JSON report is written to artifacts/baselines/ by default.
"""

from __future__ import annotations

import json
import os
import re
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

BASE_URL = os.environ.get("DMRX_BASE_URL", "http://127.0.0.1:47113").rstrip("/")
OUTPUT_DIR = Path(os.environ.get("DMRX_BASELINE_OUTPUT_DIR", "artifacts/baselines"))
REQUEST_TIMEOUT_SECONDS = int(os.environ.get("DMRX_BASELINE_TIMEOUT", "120"))
META_MODELS = ("auto-smart", "auto-agentic", "auto-coding")


def normalized(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip()).lower()


def json_check(text: str) -> tuple[bool, str]:
    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        return False, f"invalid JSON: {error.msg}"
    if value == {"status": "ok", "value": 17}:
        return True, "exact JSON object"
    return False, f"unexpected object: {value!r}"


def exact_math_check(text: str) -> tuple[bool, str]:
    if normalized(text) == "80":
        return True, "exact answer"
    return False, f"expected 80, got {text.strip()!r}"


def code_bug_check(text: str) -> tuple[bool, str]:
    lower = text.lower()
    signals = ("max_val = arr[0]", "max_val=arr[0]", "float('-inf')", "float(\"-inf\")", "return max(arr)")
    if any(signal in lower for signal in signals):
        return True, "handles all-negative input"
    return False, "does not show a valid all-negative fix"


def multi_turn_check(text: str) -> tuple[bool, str]:
    value = normalized(text)
    if value == "12":
        return True, "preserved prior turn value"
    return False, f"expected 12, got {text.strip()!r}"


def tool_check(message: dict[str, Any]) -> tuple[bool, str]:
    calls = message.get("tool_calls") or []
    if not calls:
        return False, "no tool call emitted"
    for call in calls:
        function = call.get("function") or {}
        if function.get("name") != "add":
            continue
        try:
            args = json.loads(function.get("arguments", "{}"))
        except json.JSONDecodeError:
            continue
        if args == {"a": 19, "b": 23}:
            return True, "correct add tool call"
    return False, f"unexpected tool calls: {calls!r}"


Task = dict[str, Any]
TASKS: tuple[Task, ...] = (
    {
        "id": "strict_json",
        "payload": {
            "messages": [{"role": "user", "content": "Return only this JSON object: {\"status\":\"ok\",\"value\":17}"}],
            "temperature": 0,
            "max_tokens": 512,
            "response_format": {"type": "json_object"},
        },
        "check": lambda message: json_check(str(message.get("content") or "")),
    },
    {
        "id": "exact_math",
        "payload": {
            "messages": [{"role": "user", "content": "A train travels 60 km in 45 minutes. What is its speed in km/h? Reply with only the number."}],
            "temperature": 0,
            "max_tokens": 512,
        },
        "check": lambda message: exact_math_check(str(message.get("content") or "")),
    },
    {
        "id": "code_bug_fix",
        "payload": {
            "messages": [{"role": "user", "content": "Fix this Python function so find_max([-5, -2, -10, -1]) returns -1. Return code only.\n\ndef find_max(arr):\n    max_val = 0\n    for x in arr:\n        if x > max_val:\n            max_val = x\n    return max_val"}],
            "temperature": 0,
            "max_tokens": 256,
        },
        "check": lambda message: code_bug_check(str(message.get("content") or "")),
    },
    {
        "id": "multi_turn_context",
        "payload": {
            "messages": [
                {"role": "user", "content": "Remember this number: 12. Reply only OK."},
                {"role": "assistant", "content": "OK"},
                {"role": "user", "content": "What number did I ask you to remember? Reply only with the number."},
            ],
            "temperature": 0,
            "max_tokens": 512,
        },
        "check": lambda message: multi_turn_check(str(message.get("content") or "")),
    },
    {
        "id": "tool_call",
        "payload": {
            "messages": [{"role": "user", "content": "Use the add tool to add 19 and 23. Do not answer in prose."}],
            "temperature": 0,
            "max_tokens": 512,
            "tools": [{"type": "function", "function": {"name": "add", "description": "Adds two integers.", "parameters": {"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}}, "required": ["a", "b"], "additionalProperties": False}}}],
            "tool_choice": {"type": "function", "function": {"name": "add"}},
        },
        "check": tool_check,
    },
)


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return round(ordered[index], 1)


def listener_pid() -> int | None:
    """Return the current Windows PID listening on the gateway's TCP port."""
    try:
        port = urllib.parse.urlparse(BASE_URL).port
        raw = subprocess.check_output(["netstat", "-ano"], text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return None
    for line in raw.splitlines():
        columns = line.split()
        if len(columns) >= 5 and columns[0].upper() == "TCP" and columns[1].endswith(f":{port}") and columns[3].upper() == "LISTENING":
            try:
                return int(columns[-1])
            except ValueError:
                return None
    return None


def request_json(path: str, payload: dict[str, Any], timeout: int = REQUEST_TIMEOUT_SECONDS) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{BASE_URL}{path}", data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return {"ok": 200 <= response.status < 300, "http_status": response.status, "latency_ms": round((time.perf_counter() - started) * 1000, 1), "body": json.loads(raw)}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1000]
        return {"ok": False, "http_status": error.code, "latency_ms": round((time.perf_counter() - started) * 1000, 1), "error": detail}
    except Exception as error:  # network/timeout must be baseline data, not runner crashes
        return {"ok": False, "http_status": None, "latency_ms": round((time.perf_counter() - started) * 1000, 1), "error": str(error)}


def run_task(meta_model: str, task: Task) -> dict[str, Any]:
    payload = {"model": meta_model, **task["payload"]}
    pid_before = listener_pid()
    response = request_json("/v1/chat/completions", payload)
    pid_after = listener_pid()
    row: dict[str, Any] = {
        "meta_model": meta_model,
        "task": task["id"],
        "gateway_pid_before": pid_before,
        "gateway_pid_after": pid_after,
        "gateway_restarted_during_request": pid_before is not None and pid_after is not None and pid_before != pid_after,
        **{k: v for k, v in response.items() if k != "body"},
    }
    if not response["ok"]:
        row.update({"passed": False, "failure_kind": "transport"})
        return row
    body = response["body"]
    choices = body.get("choices") or [{}]
    choice = choices[0] if isinstance(choices[0], dict) else {}
    message = choice.get("message") or {}
    passed, check_detail = task["check"](message)
    content = str(message.get("content") or "")
    row.update(
        {
            "passed": passed,
            "failure_kind": None if passed else "functional",
            "check_detail": check_detail,
            "served_model": body.get("model"),
            "finish_reason": choice.get("finish_reason"),
            "content_chars": len(content),
            "content_preview": content[:600],
            "tool_calls": message.get("tool_calls") or [],
            "usage": body.get("usage"),
            "fallback": body.get("dmrx_fallback"),
        }
    )
    return row


def run_stream_probe(meta_model: str) -> dict[str, Any]:
    payload = {"model": meta_model, "messages": [{"role": "user", "content": "Count from 1 to 5, comma separated."}], "temperature": 0, "max_tokens": 128, "stream": True}
    request = urllib.request.Request(f"{BASE_URL}/v1/chat/completions", data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
    pid_before = listener_pid()
    started = time.perf_counter()
    first_chunk_ms: float | None = None
    chunks = 0
    data_fragments: list[str] = []
    status: int | None = None
    error: str | None = None
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            status = response.status
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    continue
                chunks += 1
                if first_chunk_ms is None:
                    first_chunk_ms = round((time.perf_counter() - started) * 1000, 1)
                try:
                    parsed = json.loads(data)
                    delta = ((parsed.get("choices") or [{}])[0].get("delta") or {}).get("content")
                    if delta:
                        data_fragments.append(str(delta))
                except json.JSONDecodeError:
                    pass
    except urllib.error.HTTPError as exc:
        status = exc.code
        error = exc.read().decode("utf-8", errors="replace")[:1000]
    except Exception as exc:
        error = str(exc)
    total_ms = round((time.perf_counter() - started) * 1000, 1)
    content = "".join(data_fragments)
    passed = status is not None and 200 <= status < 300 and chunks > 0 and all(n in content for n in ("1", "2", "3", "4", "5"))
    pid_after = listener_pid()
    return {"meta_model": meta_model, "task": "streaming", "http_status": status, "latency_ms": total_ms, "ttft_ms": first_chunk_ms, "chunks": chunks, "content_preview": content[:600], "passed": passed, "failure_kind": None if passed else "streaming", "error": error, "gateway_pid_before": pid_before, "gateway_pid_after": pid_after, "gateway_restarted_during_request": pid_before is not None and pid_after is not None and pid_before != pid_after}


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_model: dict[str, dict[str, Any]] = {}
    for meta_model in META_MODELS:
        model_rows = [row for row in rows if row["meta_model"] == meta_model]
        latencies = [float(row["latency_ms"]) for row in model_rows]
        passed = sum(1 for row in model_rows if row["passed"])
        routes = Counter(row.get("served_model") for row in model_rows if row.get("served_model"))
        failures = Counter(row.get("failure_kind") for row in model_rows if row.get("failure_kind"))
        by_model[meta_model] = {
            "passed": passed,
            "total": len(model_rows),
            "pass_rate": round(passed / len(model_rows), 3) if model_rows else 0,
            "latency_ms": {"p50": percentile(latencies, 0.50), "p95": percentile(latencies, 0.95), "mean": round(statistics.mean(latencies), 1) if latencies else None},
            "served_models": dict(routes),
            "failure_kinds": dict(failures),
        }
    total_passed = sum(1 for row in rows if row["passed"])
    return {"passed": total_passed, "total": len(rows), "pass_rate": round(total_passed / len(rows), 3), "by_meta_model": by_model}


def main() -> int:
    run_started = datetime.now(timezone.utc)
    health_request = urllib.request.Request(f"{BASE_URL}/health", method="GET")
    try:
        with urllib.request.urlopen(health_request, timeout=15) as response:
            health = {"http_status": response.status, "body": json.loads(response.read().decode("utf-8"))}
    except Exception as error:
        print(f"Gateway health check failed: {error}", file=sys.stderr)
        return 2

    rows: list[dict[str, Any]] = []
    for meta_model in META_MODELS:
        for task in TASKS:
            row = run_task(meta_model, task)
            rows.append(row)
            print(f"{meta_model:14} {task['id']:18} {'PASS' if row['passed'] else 'FAIL'} {row['latency_ms']:>8}ms {row.get('served_model') or row.get('http_status')}")

    # Streaming is last: a streaming defect cannot invalidate non-streaming data.
    for meta_model in META_MODELS:
        stream = run_stream_probe(meta_model)
        rows.append(stream)
        print(f"{meta_model:14} {'streaming':18} {'PASS' if stream['passed'] else 'FAIL'} {stream['latency_ms']:>8}ms ttft={stream.get('ttft_ms')}ms")

    report = {
        "schema_version": 2,
        "run_started_utc": run_started.isoformat(),
        "base_url": BASE_URL,
        "health": health,
        "meta_models": list(META_MODELS),
        "task_count_per_meta_model": len(TASKS) + 1,
        "results": rows,
        "summary": summarize(rows),
    }
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"live-baseline-{run_started.strftime('%Y%m%dT%H%M%SZ')}.json"
    output_path = OUTPUT_DIR / filename
    output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("\nSummary:")
    print(json.dumps(report["summary"], indent=2))
    print(f"Report: {output_path}")
    return 0 if report["summary"]["passed"] == report["summary"]["total"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
