"""Bounded free-only live check using the existing deterministic baseline.

Does not modify gateway configuration. Every request explicitly carries the
free-only cost constraint. Persists after each case, so failures survive a stop.
Provider inference is real; a functional pass does not establish an SLA.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
import urllib.request

os.environ.setdefault("DMRX_BASELINE_TIMEOUT", "45")
import run_live_baseline as baseline


def main() -> int:
    opener = urllib.request.build_opener()
    opener.addheaders = [("x-cost-filter", "free")]
    urllib.request.install_opener(opener)
    target = Path(os.environ.get("DMRX_PRODUCTION_REPORT", "reports/production-2026-09-28-free-live.json"))
    report = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "base_url": baseline.BASE_URL,
        "request_headers": {"x-cost-filter": "free"},
        "expected_cases": len(baseline.META_MODELS) * (len(baseline.TASKS) + 1),
        "results": [],
        "limitations": ["Single sequential sample, not a load/SLA test", "Uses existing baseline scorers", "Live listener may differ from current checkout"],
    }
    target.parent.mkdir(parents=True, exist_ok=True)

    def save(row: dict) -> None:
        report["results"].append(row)
        report["summary"] = baseline.summarize(report["results"])
        target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({k: row.get(k) for k in ("meta_model", "task", "passed", "http_status", "latency_ms", "served_model", "error")}), flush=True)

    for model in baseline.META_MODELS:
        for task in baseline.TASKS:
            save(baseline.run_task(model, task))
    for model in baseline.META_MODELS:
        save(baseline.run_stream_probe(model))
    print(json.dumps(report["summary"], indent=2))
    return 0 if all(r["passed"] for r in report["results"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
