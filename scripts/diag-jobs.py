import json, os, urllib.request, re

GW = "http://localhost:47113"
KEY = ""
for line in open(os.path.join(os.path.dirname(__file__), "..", ".env"), encoding="utf-8", errors="ignore"):
    m = re.match(r"^DMRX_ADMIN_API_KEY=(.+)$", line.strip())
    if m:
        KEY = m.group(1)
        break

def get(path):
    req = urllib.request.Request(GW + path, headers={"Authorization": "Bearer " + KEY})
    return json.load(urllib.request.urlopen(req, timeout=30))

jobs = get("/v1/jobs?limit=10")
for j in jobs[:8]:
    print("=" * 78)
    print(f"{j['status']}  {j['id']}  budget={j['budgetUsd']} spent={j['spentUsd']}/{j['spentTokens']}")
    print(f"  brief: {j['brief'][:70]}")
    tasks = get(f"/v1/jobs/{j['id']}/tasks")
    if not tasks:
        print("  !! NO TASKS — plan never materialized")
    for t in tasks:
        err = ""
        if isinstance(t.get("output"), dict):
            err = str(t["output"].get("error", ""))[:100]
        print(f"    seq{t['seq']} {t['status']:<10} att={t['attempt']} "
              f"retryAfter={t.get('retryAfter')} inst={str(t.get('assignedInstanceId'))[:8]} {err}")
