#!/usr/bin/env python3
"""
Vault health watchdog for DMR-X gateway.
Monitors provider_keys table and alerts when active_key_count drops to 0.
Designed to run as a cron job every 5 minutes.

Usage:
  python scripts/vault_watchdog.py          # one-shot check
  python scripts/vault_watchdog.py --json   # JSON output for cron
"""
import json
import sys
import urllib.request

GATEWAY_URL = "http://127.0.0.1:47113"

def get_provider_health():
    """Fetch provider health status from admin API."""
    try:
        req = urllib.request.Request(f"{GATEWAY_URL}/v1/admin/providers")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        return None, f"request failed: {e}"
    providers = data if isinstance(data, list) else data.get("data", data.get("providers", []))
    
    total = len(providers)
    healthy = sum(1 for p in providers if p.get("is_healthy") == 1)
    with_key = sum(1 for p in providers if p.get("config", {}).get("hasKey"))
    
    # Count active keys from the keys array (the API includes it per provider)
    active_keys = 0
    broken = []
    for p in providers:
        keys = p.get("keys", [])
        active_for_provider = sum(1 for k in keys if k.get("is_active") == 1 and k.get("has_api_key"))
        active_keys += active_for_provider
        # Flag providers with hasKey=True but no active keys with actual key material
        if p.get("config", {}).get("hasKey") and active_for_provider == 0:
            # Check if they have ANY key in the keys table (even inactive)
            has_any_key_row = len(keys) > 0
            if has_any_key_row:
                broken.append(p["name"])
    
    return {
        "total": total,
        "healthy": healthy,
        "with_key": with_key,
        "active_keys": active_keys,
        "broken": broken,
    }, None

def main():
    as_json = "--json" in sys.argv
    
    status, err = get_provider_health()
    
    if err:
        if as_json:
            print(json.dumps({"status": "error", "error": err}))
        else:
            print(f"ERROR: {err}")
        sys.exit(1)
    
    # Determine overall health
    if status["active_keys"] == 0:
        overall = "CRITICAL"
    elif status["broken"]:
        overall = "WARNING"
    elif status["healthy"] < status["with_key"]:
        overall = "DEGRADED"
    else:
        overall = "OK"
    
    if as_json:
        print(json.dumps({"status": overall, **status}))
    else:
        print(f"[{overall}] Providers: {status['total']} total, "
              f"{status['healthy']} healthy, {status['with_key']} with key, "
              f"{status['active_keys']} active keys")
        if status["broken"]:
            print(f"  WARNING: {len(status['broken'])} providers have hasKey=True but 0 active keys:")
            for name in status["broken"]:
                print(f"    - {name}")
    
    if overall == "CRITICAL":
        sys.exit(2)  # Nagios-style exit code
    elif overall == "WARNING":
        sys.exit(1)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()
