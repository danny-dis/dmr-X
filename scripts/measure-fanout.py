"""Measure provider-probe fan-out over a 90s window.

Before the allowlist fix the health checker probed every registered adapter
(40+), each retrying to attempt 4 -> 160+ concurrent outbound requests every
30s tick, which crashed the bun process.

With the fix only allowlisted providers are probed, so this count should be
near zero.
"""
import os, re, subprocess, time

LOG = os.path.join(".dmrx-data", "logs", "gateway-out.log")
PAT = re.compile(r"Retrying HTTP request")


def tail_size():
    return os.path.getsize(LOG)


def count_new(from_offset):
    hits, providers = 0, set()
    with open(LOG, "r", encoding="utf-8", errors="ignore") as f:
        f.seek(from_offset)
        for line in f:
            if PAT.search(line):
                hits += 1
                m = re.search(r'"providerId":"([^"]+)"', line)
                if m:
                    providers.add(m.group(1))
    return hits, providers


start = tail_size()
print(f"watching {LOG} from offset {start:,} for 90s "
      f"(health tick is every 30s, so ~3 ticks)...")
time.sleep(90)
hits, provs = count_new(start)

print(f"\nretry lines in window: {hits}")
print(f"distinct providers probed: {len(provs)}")
if provs:
    print("providers:", ", ".join(sorted(provs)[:25]))

allow = [s.strip() for s in os.environ.get("DMRX_PROVIDER_ALLOWLIST", "").split(",") if s.strip()]
print(f"\nallowlist ({len(allow)}): {allow}")
outside = sorted(p for p in provs if allow and p not in allow)
if outside:
    print(f"!! {len(outside)} providers OUTSIDE allowlist still probed: {outside[:20]}")
    print("   -> fan-out NOT contained")
else:
    print("OK: no out-of-allowlist provider probes -> fan-out contained")
