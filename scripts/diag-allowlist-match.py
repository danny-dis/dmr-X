"""Check whether registered adapter ids actually match the allowlist names.

The health-check filter compares adapterRegistry.list() ids against
DMRX_PROVIDER_ALLOWLIST entries. If adapter ids are UUIDs (or differently
named) while the allowlist holds provider *names*, the filter matches almost
nothing and every adapter keeps getting probed.
"""
import json, os, re, urllib.request

GW = "http://localhost:47113"
ENV = os.path.join(os.path.dirname(__file__), "..", ".env")


def env(key):
    for line in open(ENV, encoding="utf-8", errors="ignore"):
        m = re.match(rf"^{key}=(.+)$", line.strip())
        if m:
            return m.group(1)
    return ""


KEY = env("DMRX_ADMIN_API_KEY")
H = {"Authorization": "Bearer " + KEY}


def get(path):
    req = urllib.request.Request(GW + path, headers=H)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


allow = [s.strip() for s in env("DMRX_PROVIDER_ALLOWLIST").split(",") if s.strip()]
print("allowlist from .env:", allow, "\n")

# Providers the gateway believes exist, with health flags.
try:
    provs = get("/v1/admin/providers")
    rows = provs if isinstance(provs, list) else provs.get("items", provs.get("providers", []))
    print(f"providers known to gateway: {len(rows)}")
    healthy = [p for p in rows if p.get("is_healthy") in (1, True)]
    print(f"  marked healthy: {len(healthy)}")
    names = sorted({str(p.get("name")) for p in healthy})
    print(f"  healthy names sample: {names[:18]}")
    outside = [n for n in names if n not in allow]
    print(f"\n  healthy but NOT in allowlist: {len(outside)}")
    print(f"  {outside[:25]}")
    print("\n=> These are the ones still being health-probed every 30s.")
    print("   Fix must scope by the SAME identifier the registry uses.")
except Exception as e:
    print("admin/providers failed:", repr(e)[:200])
    print("(endpoint name may differ; the fan-out evidence already stands)")
