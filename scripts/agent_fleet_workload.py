#!/usr/bin/env python3
"""Delegate realistic work to DMR-X agents and measure how the gateway performs.

Purpose is DIAGNOSIS, not a green tick. Every run records per-request latency,
routed model, fallback reason, error class, and gateway RSS so we can see WHERE
DMR-X spends time and WHAT breaks under real agentic load.

Design decisions worth knowing:
  * Work is matched to the agent's actual specialty (a "Test Automation
    Engineer" gets a test-design task, not a generic ping) — a uniform prompt
    would not exercise the routing/classification path the way real use does.
  * Each agent definition needs a deployed INSTANCE before /chat works; the
    harness reuses existing instances and deploys only what is missing.
  * maxSteps is kept low by default: we are measuring dispatch and routing
    behaviour, not paying for deep tool loops on every one of 271 agents.
  * Latency is recorded even for failures — a 60s timeout is the single most
    valuable datapoint here, so failures must never be silently dropped.

Usage:
  python scripts/agent_fleet_workload.py --agents 20 --concurrency 4
  python scripts/agent_fleet_workload.py --agents 271 --concurrency 8 --out fleet.json
"""
import argparse
import json
import re
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

GW = "http://127.0.0.1:47113"

# --- work templates keyed by role signal in the agent name -------------------
# Ordered: first matching keyword wins, so put specific before generic.
WORK = [
    (("test automation", "api tester", "qa"),
     "Design a test plan for a POST /login endpoint that rate-limits after 5 "
     "attempts. List the 4 highest-value cases and the exact assertion for each."),
    (("test results", "benchmark", "performance"),
     "A service went from 5 req/s to 15 req/s after a fix, but p99 latency rose "
     "from 800ms to 2700ms. State the most likely cause and the one metric to check next."),
    (("security", "vulnerability", "threat", "penetration"),
     "An API accepts `?sort=name` and interpolates it into SQL. Name the vulnerability, "
     "its severity, and the single correct fix."),
    (("legal", "compliance", "privacy", "gdpr"),
     "We log full request bodies including customer emails, retained 3 years. "
     "Name the specific compliance risk and the minimum change to resolve it."),
    (("accessibility",),
     "A button is a <div> with an onclick and no text, only an icon. List every "
     "accessibility failure and the corrected markup."),
    (("workflow", "process", "optimizer", "efficiency"),
     "A deploy needs 6 manual approvals averaging 4 hours each. Identify which to "
     "automate first and the risk that introduces."),
    (("support", "customer", "responder"),
     "A customer says 'your API returned 403 and I changed nothing.' Write the first "
     "reply: acknowledge, state the most likely cause, and ask for exactly one datum."),
    (("infrastructure", "devops", "deploy", "sre", "reliability"),
     "A health endpoint returns 200 while serving stale code from a previous build. "
     "Explain how that happens and the check that would have caught it."),
    (("data", "analyst", "analytics", "sql"),
     "Daily active users dropped 40% overnight but revenue is flat. Give the two most "
     "likely explanations and the query you would run first."),
    (("code", "review", "refactor", "engineer", "developer"),
     "A retry loop treats HTTP 403 as retryable and walks a 7-key pool, each attempt "
     "with backoff. Explain the user-visible failure and the fix."),
    (("doc", "technical writer", "content"),
     "Write two sentences explaining a memory leak caused by never closing per-session "
     "server objects, for a non-technical reader."),
    (("evidence", "reality", "fact", "verif", "audit"),
     "A report claims 'all tests pass' but the run finished before the last commit. "
     "State why the claim is unsupported and what evidence would settle it."),
    (("tool evaluat", "research", "compare"),
     "Compare polling vs webhooks for delivering completion of a 10-minute job. "
     "One paragraph, state which you would choose and why."),
]
FALLBACK_WORK = ("Summarise, in 3 bullets, what you are specialised to do and the first "
                 "question you would ask a new client.")


def pick_work(name: str, description: str) -> str:
    hay = (name + " " + (description or "")).lower()
    for keys, prompt in WORK:
        if any(k in hay for k in keys):
            return prompt
    return FALLBACK_WORK


def http(method, path, payload=None, timeout=180):
    url = GW + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode(errors="replace")
    return json.loads(raw) if raw.strip() else {}


def gateway_rss_mb():
    """Gateway RSS via PM2's pid file -> Get-Process. Best-effort."""
    ps = ("$p = Get-Process -Name bun -ErrorAction SilentlyContinue | "
          "Sort-Object WorkingSet64 -Descending | Select-Object -First 1; "
          "if ($p) { [math]::Round($p.WorkingSet64/1MB,1) }")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                             capture_output=True, text=True, timeout=30).stdout.strip()
        return float(out) if out else None
    except Exception:
        return None


def classify_error(exc) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        return "http_%d" % exc.code
    name = type(exc).__name__
    if "timeout" in name.lower() or isinstance(exc, TimeoutError):
        return "timeout"
    return name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agents", type=int, default=20)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--max-steps", type=int, default=2)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    print("[1/4] loading agent definitions + instances")
    defs = http("GET", "/v1/agents?limit=500", timeout=60).get("items", [])
    insts = http("GET", "/v1/agents/instances?limit=1000", timeout=60).get("items", [])
    by_def = {}
    for i in insts:
        if i.get("status") == "active":
            by_def.setdefault(i["agentDefinitionId"], i["id"])
    print("      %d definitions, %d active instances" % (len(defs), len(by_def)))

    targets = defs[: args.agents]

    # Deploy instances for definitions that lack one.
    need = [d for d in targets if d["id"] not in by_def]
    if need:
        print("[2/4] deploying %d missing instances" % len(need))
        for d in need:
            try:
                inst = http("POST", "/v1/agents/%s/deploy" % d["id"], {}, timeout=60)
                if inst.get("id"):
                    by_def[d["id"]] = inst["id"]
            except Exception as e:
                print("      deploy failed %-28s %s" % (d["name"][:28], classify_error(e)))
    else:
        print("[2/4] all target agents already have instances")

    runnable = [d for d in targets if d["id"] in by_def]
    print("[3/4] dispatching work to %d agents, concurrency=%d"
          % (len(runnable), args.concurrency))

    rss_start = gateway_rss_mb()
    results = []
    lock = threading.Lock()
    done = [0]

    def run(d):
        prompt = pick_work(d["name"], d.get("description", ""))
        t0 = time.time()
        rec = {"agent": d["name"], "instance": by_def[d["id"]],
               "prompt_kind": prompt[:40]}
        try:
            resp = http("POST", "/v1/agents/%s/chat" % by_def[d["id"]],
                        {"messages": [{"role": "user", "content": prompt}],
                         "maxSteps": args.max_steps},
                        timeout=args.timeout)
            rec["elapsed"] = round(time.time() - t0, 2)
            rec["ok"] = True
            rec["model"] = resp.get("model")
            # The agent-chat route returns the reply at TOP-LEVEL `content`
            # (plus per-turn copies under all_steps[].message.content). It is
            # NOT an OpenAI-shaped `choices[]` envelope — reading choices[]
            # made every successful call look like an empty reply.
            txt = resp.get("content") or ""
            if not txt:
                steps = resp.get("all_steps") or []
                if steps:
                    txt = ((steps[-1].get("message") or {}).get("content")) or ""
            rec["reply_len"] = len(txt)
            rec["empty_reply"] = not txt.strip()
            rec["steps"] = resp.get("steps_completed")
            rec["tokens"] = resp.get("totalTokens")
            rec["cost_usd"] = resp.get("costUsd")
            # Server-measured duration, vs our wall clock: the gap is queueing
            # + transport, which is what we actually want to see under load.
            rec["server_ms"] = resp.get("durationMs")
            if rec["server_ms"] is not None:
                rec["overhead_s"] = round(rec["elapsed"] - rec["server_ms"] / 1000.0, 2)
            fb = resp.get("dmrx_fallback") or {}
            rec["fallback_reason"] = fb.get("reason")
            rec["fallback_attempts"] = fb.get("attempts")
            tc = 0
            for s in resp.get("all_steps") or []:
                tc += len(s.get("tool_calls") or [])
            rec["tool_calls"] = tc
        except Exception as e:
            rec["elapsed"] = round(time.time() - t0, 2)
            rec["ok"] = False
            rec["error"] = classify_error(e)
            if isinstance(e, urllib.error.HTTPError):
                try:
                    rec["error_body"] = e.read().decode(errors="replace")[:200]
                except Exception:
                    pass
        with lock:
            done[0] += 1
            flag = "ok " if rec["ok"] else "ERR"
            print("      [%3d/%3d] %s %6.1fs  %-30s %s"
                  % (done[0], len(runnable), flag, rec["elapsed"],
                     rec["agent"][:30], rec.get("model") or rec.get("error", "")))
        return rec

    t_all = time.time()
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futs = [ex.submit(run, d) for d in runnable]
        for f in as_completed(futs):
            results.append(f.result())
    wall = time.time() - t_all
    rss_end = gateway_rss_mb()

    # ---------------- analysis ----------------
    print("\n[4/4] === RESULTS ===")
    ok = [r for r in results if r["ok"]]
    bad = [r for r in results if not r["ok"]]
    lat = sorted(r["elapsed"] for r in ok)

    print("dispatched      : %d" % len(results))
    print("succeeded       : %d (%.0f%%)" % (len(ok), 100.0 * len(ok) / max(1, len(results))))
    print("failed          : %d" % len(bad))
    print("wall clock      : %.1fs  (%.2f req/s)" % (wall, len(results) / wall if wall else 0))
    if lat:
        print("latency p50/p95 : %.1fs / %.1fs" % (
            statistics.median(lat), lat[min(len(lat) - 1, int(len(lat) * 0.95))]))
        print("latency min/max : %.1fs / %.1fs" % (lat[0], lat[-1]))
    if rss_start and rss_end:
        print("gateway RSS     : %.1fMB -> %.1fMB (%+.1fMB)"
              % (rss_start, rss_end, rss_end - rss_start))

    empties = [r for r in ok if r.get("empty_reply")]
    if empties:
        print("\nEMPTY REPLIES   : %d  (succeeded but produced nothing)" % len(empties))
        for r in empties[:8]:
            print("   - %s" % r["agent"][:60])

    if bad:
        print("\nERROR BREAKDOWN :")
        for k, v in Counter(r["error"] for r in bad).most_common():
            print("   %-14s %d" % (k, v))
        for r in bad[:5]:
            if r.get("error_body"):
                print("   e.g. %s -> %s" % (r["agent"][:28], r["error_body"][:110]))

    models = Counter(r.get("model") for r in ok if r.get("model"))
    if models:
        print("\nMODEL SPREAD    : (routing behaviour under load)")
        for k, v in models.most_common(10):
            print("   %-42s %d" % (str(k)[:42], v))

    fb = Counter(r["fallback_reason"] for r in ok if r.get("fallback_reason"))
    if fb:
        print("\nFALLBACKS       : (requests that did NOT get their first-choice provider)")
        for k, v in fb.most_common():
            print("   %-20s %d" % (k, v))

    slow = sorted(ok, key=lambda r: -r["elapsed"])[:5]
    if slow:
        print("\nSLOWEST         :")
        for r in slow:
            print("   %6.1fs  %-32s %s" % (r["elapsed"], r["agent"][:32], r.get("model")))

    # Queue/transport overhead: wall clock minus the server's own durationMs.
    # Large values mean requests are waiting, not computing — the signal that
    # concurrency, not model speed, is the bottleneck.
    ovh = sorted(r["overhead_s"] for r in ok if r.get("overhead_s") is not None)
    if ovh:
        print("\nQUEUE OVERHEAD  : (wall clock - server durationMs)")
        print("   p50 %.1fs | p95 %.1fs | max %.1fs"
              % (statistics.median(ovh),
                 ovh[min(len(ovh) - 1, int(len(ovh) * 0.95))], ovh[-1]))
        if ovh[-1] > 5:
            print("   -> requests are QUEUEING; gateway concurrency is the limit, "
                  "not model latency")

    toks = [r["tokens"] for r in ok if r.get("tokens")]
    if toks:
        print("\nTOKENS          : total %d | mean %d/req | max %d"
              % (sum(toks), int(statistics.mean(toks)), max(toks)))
        print("   NOTE: a large mean on trivial prompts implies a heavy system "
              "prompt is resent every call (prompt-cache opportunity).")

    steps = Counter(r.get("steps") for r in ok if r.get("steps") is not None)
    if steps:
        print("\nSTEPS COMPLETED : %s"
              % ", ".join("%s step(s): %d" % (k, v) for k, v in sorted(steps.items())))
    tcalls = sum(r.get("tool_calls") or 0 for r in ok)
    print("TOOL CALLS      : %d across %d successful runs" % (tcalls, len(ok)))

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"wall": wall, "rss_start": rss_start, "rss_end": rss_end,
                       "results": results}, f, indent=2)
        print("\nraw -> %s" % args.out)

    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
