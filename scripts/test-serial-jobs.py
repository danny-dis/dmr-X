"""Test whether job failures are caused by CONCURRENCY rather than providers.

Evidence so far: with 8 jobs running at once, tasks fail with "All providers
currently unavailable" after exhausting all 4 retries (att=4, 0 tokens) — yet a
direct single agent call to the SAME agent succeeds, and one job (code_simple)
delivered fine.

Hypothesis: the allowlist is only ~6 providers with free-tier keys. Eight
concurrent jobs x multi-step agent loops overwhelm that small pool (rate
limits / connection caps), so every candidate is momentarily exhausted.

This runs the SAME briefs strictly ONE AT A TIME. If serial jobs deliver while
concurrent ones fail, the bug is queue concurrency, not the providers.
"""
import json, os, re, time, urllib.request, urllib.error

GW = "http://localhost:47113"
ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
KEY = next(
    (m.group(1) for line in open(ENV, encoding="utf-8", errors="ignore")
     if (m := re.match(r"^DMRX_ADMIN_API_KEY=(.+)$", line.strip()))),
    "",
)
H = {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
TERMINAL = {"delivered", "failed", "cancelled"}

BRIEFS = [
    ("docs", "Write a concise README section explaining how to configure an API key via environment variable.", 0.02),
    ("sql", "Write a SQL query to find the top 5 customers by total order value, and explain the joins.", 0.02),
    ("debug", "A Python function returns None instead of a list. Explain the 3 most likely root causes.", 0.02),
]


def req(path, method="GET", body=None, timeout=240):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(H) if body is not None else {"Authorization": "Bearer " + KEY}
    r = urllib.request.Request(GW + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": repr(e)[:200]}


print("SERIAL job test — one job at a time, fully drained before the next\n")
results = []

for name, brief, budget in BRIEFS:
    print(f"--- {name} ---")
    code, job = req("/v1/jobs", "POST", {"brief": brief, "source": "api", "budgetUsd": budget})
    jid = job.get("id")
    if not jid:
        print(f"  submit failed: {code} {job}")
        continue

    code, plan = req(f"/v1/jobs/{jid}/plan", "POST", {})
    print(f"  planned: {code} tasks={plan.get('taskCount')}")

    code, _ = req(f"/v1/jobs/{jid}/run", "POST", {})
    print(f"  run: {code}")

    final, tokens = "?", 0
    for _ in range(30):
        time.sleep(20)
        _, cur = req(f"/v1/jobs/{jid}")
        final = cur.get("status", "?")
        tokens = cur.get("spentTokens", 0)
        print(f"    {final}/{tokens}")
        if final in TERMINAL:
            break

    _, tasks = req(f"/v1/jobs/{jid}/tasks")
    done = sum(1 for t in tasks if t["status"] == "completed")
    att = max((t.get("attempt", 0) for t in tasks), default=0)
    results.append((name, final, f"{done}/{len(tasks)}", tokens, att))
    print(f"  => {final} tasks={done}/{len(tasks)} tokens={tokens} maxAtt={att}\n")

print("=== SERIAL RESULTS ===")
for name, st, tasks, tok, att in results:
    print(f"  {name:<10} {st:<10} tasks={tasks:<6} tokens={tok:<7} maxAttempt={att}")
delivered = sum(1 for r in results if r[1] == "delivered")
print(f"\ndelivered {delivered}/{len(results)} run serially")
print("\nCompare to the concurrent suite (1/8 delivered). If serial is much")
print("higher, queue concurrency against a 6-provider pool is the bottleneck.")
