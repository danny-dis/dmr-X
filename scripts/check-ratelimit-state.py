#!/usr/bin/env python3
"""Check current rate-limit cooldown state in the gateway DB."""
import sqlite3, json, time, os, sys

# Find the encrypted DB
db_path = None
for root, dirs, files in os.walk('apps/gateway'):
    for f in files:
        if f == 'data.db.enc':
            db_path = os.path.join(root, f)
            break
    if db_path:
        break

if not db_path:
    # Try the standard location
    for candidate in ['.dmrx-data/data.db.enc', 'apps/gateway/.dmrx-data/data.db.enc']:
        if os.path.exists(candidate):
            db_path = candidate
            break

print(f"DB: {db_path}")
if not db_path:
    print("No encrypted DB found")
    sys.exit(1)

# We can't decrypt without the key, but we can check if there's a decrypted copy
# or use the admin API instead
print("Using admin API to check rate-limit state...")
import urllib.request
try:
    req = urllib.request.Request("http://127.0.0.1:47113/v1/admin/rate-limits")
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode())
        print(json.dumps(data, indent=2)[:3000])
except Exception as e:
    print(f"rate-limits endpoint: {e}")

# Check providers for cooldown info
try:
    req = urllib.request.Request("http://127.0.0.1:47113/v1/admin/providers")
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode())
        providers = data if isinstance(data, list) else data.get("data", [])
        print(f"\nProviders: {len(providers)} total")
        # Show first few with their keys count
        for p in providers[:5]:
            keys = p.get("keys", [])
            active = sum(1 for k in keys if k.get("is_active") == 1 and k.get("has_api_key"))
            print(f"  {p['name']}: healthy={p.get('is_healthy')}, hasKey={p.get('config',{}).get('hasKey')}, keys={len(keys)}, active={active}")
except Exception as e:
    print(f"providers endpoint: {e}")
