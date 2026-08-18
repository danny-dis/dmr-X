import json, urllib.request, time

GATEWAY = 'http://localhost:47116'
ADMIN_KEY = 'dmrx-local-admin-key-2026'

# 6 confirmed free models + 1 new one
free_models = [
    "deepseek-v4-flash-free",
    "hy3-free",
    "laguna-s-2.1-free",
    "mimo-v2.5-free",
    "nemotron-3-ultra-free",
    "nemotron-3.5-lightning-free",
]

print("=== Testing through DMR-X gateway (uses registered keys) ===")
for model in free_models:
    body = json.dumps({'model': f'opencode-zen/{model}', 'messages': [{'role':'user','content':'ping'}], 'max_tokens': 10, 'stream': False}).encode()
    req = urllib.request.Request(f'{GATEWAY}/v1/chat/completions', data=body, headers={'Authorization': f'Bearer {ADMIN_KEY}', 'Content-Type': 'application/json'})
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            d = json.loads(resp.read().decode())
            lat = (time.monotonic()-start)*1000
            content = d.get('choices',[{}])[0].get('message',{}).get('content','')[:60]
            print(f"  {model:35s} ✅ {lat:.0f}ms  {content}")
    except urllib.error.HTTPError as e:
        lat = (time.monotonic()-start)*1000
        err = e.read().decode() if e.fp else ""
        print(f"  {model:35s} ❌ HTTP {e.code} {lat:.0f}ms  {err[:80]}")
    except Exception as e:
        lat = (time.monotonic()-start)*1000
        print(f"  {model:35s} ❌ {lat:.0f}ms  {str(e)[:60]}")
    time.sleep(2)
