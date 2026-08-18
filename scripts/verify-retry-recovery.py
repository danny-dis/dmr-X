"""Re-run the blocked jobs and watch whether driveJob now survives a
retry-scheduled 'blocked' state instead of stranding the job.

Before the fix: a transient provider 500 parked tasks with a future
retryAfter, the scheduler reported 'blocked', driveJob returned, and nothing
ever re-queued the job -> permanently dead with 0 tokens spent.

After the fix: driveJob sleeps until the earliest retryAfter and runs another
pass, so the job either progresses or reports an honest terminal state.
"""
import json, os, re, sys, time, urllib.request, urllib.error

GW = "http://localhost:47113"
ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
KEY = next(
    (m.group(1) for line in open(ENV, encoding="utf-8", errors="ignore")
     if (m := re.match(r"^DMRX_ADMIN_API_KEY=(.+)$", line.strip()))),
    "",
)
H = {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
TERMINAL = {"delivered", "failed", "cancelled"}


def call(path, method="GET", body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(GW + path, data=data, headers=H, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


_, jobs = call("/v1/jobs?limit=10")
targets = [j for j in jobs if j["status"] == "blocked"][:8]
print(f"re-running {len(targets)} blocked jobs\n")

for j in targets:
    code, r = call(f"/v1/jobs/{j['id']}/run", "POST")
    print(f"  {j['id'][:8]} run -> {code} {r.get('status', r.get('error', {}).get('message', ''))}")

print("\npolling (retry backoff is ~2-4s, allow a few minutes)\n")
start = time.time()
for round_ in range(40):
    time.sleep(20)
    line, pending = [], 0
    for j in targets:
        _, cur = call(f"/v1/jobs/{j['id']}")
        st = cur.get("status", "?")
        tok = cur.get("spentTokens", 0)
        line.append(f"{j['id'][:6]}={st}/{tok}")
        if st not in TERMINAL:
            pending += 1
    print(f"[t+{int(time.time()-start)}s] " + " ".join(line))
    if pending == 0:
        print("\nall terminal")
        break

print("\n=== RESULT ===")
delivered = 0
for j in targets:
    _, cur = call(f"/v1/jobs/{j['id']}")
    _, tasks = call(f"/v1/jobs/{j['id']}/tasks")
    done = sum(1 for t in tasks if t["status"] == "completed")
    att = max((t.get("attempt", 0) for t in tasks), default=0)
    st = cur.get("status", "?")
    if st == "delivered":
        delivered += 1
    print(f"{st:<10} {done}/{len(tasks)} tasks  maxAttempt={att}  "
          f"tokens={cur.get('spentTokens', 0):<7} {cur.get('brief','')[:44]}")
print(f"\ndelivered {delivered}/{len(targets)}")
print("KEY SIGNAL: any task with attempt>1 or tokens>0 proves the retry "
      "actually fired (before the fix it was always attempt=1, tokens=0).")
