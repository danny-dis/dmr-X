"""Benchmark Needle depth rungs on this machine.

Answers one question: for each available rung, how fast is it and how often
does it pick the right tool?

Methodology notes that matter:

* Every call uses UNIQUE query text. server.py keeps a 60s TTL cache on
  (query, tools); repeating a query returns in ~0.01s and would make any rung
  look instantaneous.
* Each rung gets one throwaway warmup call before timing, so the first-call
  agent-construction cost (~7-48s) is not charged to the first measured case.
* `stateless=True` because the real service routes independent queries.
* `under_budget` counts calls that beat DMRX_NEEDLE_TIMEOUT_MS. That is the
  number that decides whether the gateway pre-filter actually engages.

Usage:
    python bench.py                                  # every rung found
    python bench.py --rungs needle3-4L.cact          # one rung
    python bench.py --rungs needle3-4L.cact --json   # machine-readable
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from typing import Any

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_BUDGET_MS = 1500

# A 24-tool catalogue shaped like a real agent surface. Needle routes on tool
# descriptions, so these are written the way the docs recommend: one action per
# tool, in words a user would actually say.
TOOL_CATALOGUE: list[tuple[str, str]] = [
    ("search_files", "Search file contents for a query string. Use when the user wants to find where a word or symbol appears in the codebase."),
    ("read_file", "Read the contents of a file from disk. Use when the user asks to see, open, or show a file."),
    ("write_file", "Write content to a file. Use when the user wants to create or save a file."),
    ("list_dir", "List the files in a directory. Use when the user asks what files exist somewhere."),
    ("delete_file", "Delete a file from disk. Use when the user wants to remove a file."),
    ("move_file", "Move or rename a file. Use when the user wants to relocate or rename a file."),
    ("grep_repo", "Search a git repository for a code pattern. Use for finding definitions across a repo."),
    ("git_commit", "Commit staged changes to git. Use when the user wants to commit or save changes to version control."),
    ("git_push", "Push commits to the remote repository. Use when the user wants to upload or push commits."),
    ("git_status", "Show the git working tree status. Use when the user asks what has changed."),
    ("run_tests", "Run the project test suite. Use when the user wants to run or execute tests."),
    ("run_build", "Build the project. Use when the user wants to compile or build."),
    ("start_server", "Start a background server process. Use when the user wants to launch or start a server."),
    ("stop_server", "Stop a running server process. Use when the user wants to kill or stop a server."),
    ("http_get", "Fetch a URL over HTTP GET. Use when the user wants to download or fetch a web page."),
    ("http_post", "Send an HTTP POST request. Use when the user wants to submit data to a URL."),
    ("send_email", "Send an email message. Use when the user wants to email someone."),
    ("send_slack", "Post a message to Slack. Use when the user wants to notify a Slack channel."),
    ("create_issue", "Create a GitHub issue. Use when the user wants to file or open an issue."),
    ("list_issues", "List open GitHub issues. Use when the user wants to see open issues."),
    ("query_db", "Run a read-only SQL query. Use when the user wants to query the database."),
    ("get_weather", "Get the current weather for a city. Use when the user asks about weather or temperature."),
    ("set_lights", "Turn a room's lights on or off. Use when the user wants to control lighting."),
    ("screenshot", "Capture a screenshot of the desktop. Use when the user wants to take a screenshot."),
]

# (query, expected tool). Query text is suffixed with the run index at call
# time so the response cache can never serve a repeat.
CASES: list[tuple[str, str]] = [
    ("search for files containing the word hello", "search_files"),
    ("read the file config.json", "read_file"),
    ("commit my staged changes", "git_commit"),
    ("run the test suite", "run_tests"),
    ("what's the weather in Lagos", "get_weather"),
    ("post a message to slack saying deploy done", "send_slack"),
    ("turn off the living room lights", "set_lights"),
    ("open an issue about the crash on startup", "create_issue"),
    ("take a screenshot of my desktop", "screenshot"),
    ("fetch https://example.com over http", "http_get"),
    ("email the team about the release", "send_email"),
    ("build the project", "run_build"),
]


def _tools() -> list[dict]:
    return [
        {
            "name": name,
            "description": desc,
            "parameters": {"type": "object", "properties": {"q": {"type": "string"}}},
        }
        for name, desc in TOOL_CATALOGUE
    ]


def _discover_rungs() -> list[str]:
    names = []
    for name in os.listdir(SERVICE_DIR):
        if re.match(r"^needle3(-\d+L)?\.cact$", name):
            names.append(name)
    # Shallowest first: cheapest, so an interrupted run still yields the
    # rungs most likely to be usable on a slow host.
    return sorted(names, key=lambda n: int(re.search(r"-(\d+)L", n).group(1)) if re.search(r"-(\d+)L", n) else 20)


def _bench_rung(needle: Any, rung: str | None, budget_ms: int, progress) -> dict:
    """Time and score one rung. `rung=None` means the full base model."""
    label = rung or "needle3.cact (full)"
    weights = os.path.join(SERVICE_DIR, rung) if rung else None

    progress(f"constructing agent for {label}…")
    started = time.time()
    try:
        agent = needle.Needle(tools=_tools(), weights=weights, stateless=True)
    except Exception as exc:  # noqa: BLE001 - report, don't kill the sweep
        return {"rung": label, "error": f"{type(exc).__name__}: {exc}"}
    construct_s = time.time() - started

    # Throwaway call so the first measured case isn't paying engine warmup.
    progress(f"warming {label}…")
    try:
        agent.complete("warmup probe alpha", max_new_tokens=8)
    except Exception as exc:  # noqa: BLE001
        return {"rung": label, "error": f"warmup failed: {type(exc).__name__}: {exc}"}

    times: list[float] = []
    correct = 0
    misses: list[dict] = []

    for i, (query, expected) in enumerate(CASES):
        # Unique text per call defeats the 60s response cache.
        unique = f"{query} [bench {i}]"
        t0 = time.time()
        try:
            resp = agent.complete(unique, max_new_tokens=48)
            calls = [c.get("name") for c in (resp.get("function_calls") or [])]
            conf = resp.get("confidence")
        except Exception as exc:  # noqa: BLE001
            calls, conf = [], None
            progress(f"  case {i} errored: {type(exc).__name__}")
        dt = time.time() - t0
        times.append(dt)

        hit = expected in calls
        correct += hit
        if not hit:
            misses.append({"query": query, "expected": expected,
                           "got": calls, "confidence": conf})
        progress(f"  {label} {i + 1}/{len(CASES)} {dt:.2f}s "
                 f"{'ok' if hit else 'miss'} want={expected} got={calls}")

    n = len(times)
    return {
        "rung": label,
        "layers": None if rung is None else int(re.search(r"-(\d+)L", rung).group(1)),
        "constructSeconds": round(construct_s, 2),
        "meanSeconds": round(sum(times) / n, 2),
        "minSeconds": round(min(times), 2),
        "maxSeconds": round(max(times), 2),
        "accuracy": round(correct / n, 3),
        "correct": correct,
        "cases": n,
        "underBudget": sum(1 for t in times if t * 1000 < budget_ms),
        "budgetMs": budget_ms,
        "misses": misses,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Benchmark Needle depth rungs.")
    ap.add_argument("--rungs", help="comma-separated rung filenames (default: all found)")
    ap.add_argument("--json", action="store_true", help="emit JSON only")
    ap.add_argument("--budget-ms", type=int,
                    default=int(os.environ.get("DMRX_NEEDLE_TIMEOUT_MS") or DEFAULT_BUDGET_MS),
                    help="gateway pre-filter budget to compare against")
    args = ap.parse_args()

    def progress(msg: str) -> None:
        # Progress goes to stderr so --json stdout stays parseable.
        print(msg, file=sys.stderr, flush=True)

    rungs = ([r.strip() for r in args.rungs.split(",") if r.strip()]
             if args.rungs else _discover_rungs())
    if not rungs:
        progress("No rungs found in " + SERVICE_DIR)
        return 2

    try:
        import needle
    except ImportError as exc:
        progress(f"cactus-needle not importable: {exc}")
        return 2

    progress(f"Benchmarking {len(rungs)} rung(s); budget {args.budget_ms}ms")
    results = [_bench_rung(needle, rung, args.budget_ms, progress) for rung in rungs]

    usable = [r for r in results if "error" not in r]
    summary: dict = {
        "host": {"budgetMs": args.budget_ms, "serviceDir": SERVICE_DIR},
        "rungs": results,
    }
    if usable:
        # A rung is only worth deploying if it is both accurate enough to be
        # useful AND fast enough to fit the budget. The 2-layer rung is the
        # fastest thing available and measures 0% accuracy, so ranking on speed
        # alone would recommend a model that refuses every request.
        MIN_ACCURACY = 0.25
        useful = [r for r in usable if r["accuracy"] >= MIN_ACCURACY]
        if not useful:
            best = max(usable, key=lambda r: r["accuracy"])
            summary["recommended"] = {
                "rung": best["rung"],
                "reason": (f"nothing reached {int(MIN_ACCURACY * 100)}% accuracy; "
                           "this is the most accurate available"),
                "accuracy": best["accuracy"],
                "meanSeconds": best["meanSeconds"],
            }
        else:
            within = [r for r in useful if r["underBudget"] > 0]
            if within:
                best = max(within, key=lambda r: (r["accuracy"], -r["meanSeconds"]))
                reason = "most accurate rung that still fits the latency budget"
            else:
                best = max(useful, key=lambda r: (r["accuracy"], -r["meanSeconds"]))
                reason = ("most accurate rung, but none fit the latency budget on "
                          "this host so the pre-filter cannot take effect")
            summary["recommended"] = {
                "rung": best["rung"],
                "reason": reason,
                "accuracy": best["accuracy"],
                "meanSeconds": best["meanSeconds"],
            }

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        for r in results:
            if "error" in r:
                print(f"  {r['rung']:28s} ERROR {r['error']}")
                continue
            print(f"  {r['rung']:28s} mean {r['meanSeconds']:6.2f}s  "
                  f"max {r['maxSeconds']:6.2f}s  acc {r['accuracy'] * 100:5.1f}%  "
                  f"in-budget {r['underBudget']}/{r['cases']}")
        if "recommended" in summary:
            rec = summary["recommended"]
            print(f"\n  recommended: {rec['rung']} — {rec['reason']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
